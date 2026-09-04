import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { providerRoutes, selfHostedEndpoints } from '@/lib/schema'
import { invalidateRouteCache } from './route-cache'
import type { Capability } from './types'

/**
 * 自建端点（self-hosted endpoint）数据访问与路由行同步（ADR-0001）。
 * endpoint 启用行是「该 capability 自建生效」的唯一事实源；
 * provider_routes 的 local 行（region='local', priority=0）是同步出的派生态，
 * 两者的启停由本模块的 sync 函数联动，任何变更都以 invalidateRouteCache 收尾。
 */

export type SelfHostedEndpoint = typeof selfHostedEndpoints.$inferSelect

/** provider_routes 里 local 行的确定性 id（每 capability 一行） */
const localRouteId = (capability: string) => `local_${capability}`

/** 该 capability 当前启用的自建端点（启用行唯一索引保证每 capability 至多一条）。
 * enabled 由 SQL 过滤，capability 在 JS 层过滤——行为可被单测的扁平 mock 忠实覆盖。 */
export async function getEnabledEndpoint(capability: Capability): Promise<SelfHostedEndpoint | null> {
  const rows = await db
    .select()
    .from(selfHostedEndpoints)
    .where(eq(selfHostedEndpoints.enabled, true))
  return rows.find(row => row.capability === capability) ?? null
}

/** 启用/更新端点时同步 local 路由行并失效缓存 */
export async function syncLocalRouteOnEnable(endpoint: SelfHostedEndpoint): Promise<void> {
  await db
    .insert(providerRoutes)
    .values({
      id: localRouteId(endpoint.capability),
      capability: endpoint.capability,
      provider: 'local',
      modelKey: endpoint.modelId,
      region: 'local',
      priority: 0,
      enabled: true,
    })
    .onConflictDoUpdate({
      target: providerRoutes.id,
      set: { modelKey: endpoint.modelId, enabled: true, updatedAt: new Date() },
    })
  invalidateRouteCache()
}

/** 禁用端点时下线 local 路由行并失效缓存 */
export async function syncLocalRouteOnDisable(capability: Capability): Promise<void> {
  await db
    .update(providerRoutes)
    .set({ enabled: false, updatedAt: new Date() })
    .where(eq(providerRoutes.id, localRouteId(capability)))
  invalidateRouteCache()
}

// ========== 管理端配置操作（ADR-0001：key 存 DB、掩码返回、更新即时热生效）==========

export type EndpointCapability = 'script' | 'storyboard_text' | 'image'
export type EndpointProtocol = 'openai-chat' | 'openai-images'

export const ENDPOINT_CAPABILITIES: EndpointCapability[] = ['script', 'storyboard_text', 'image']
export const ENDPOINT_PROTOCOLS: EndpointProtocol[] = ['openai-chat', 'openai-images']

export interface EndpointPayload {
  capability: EndpointCapability
  protocol: EndpointProtocol
  baseUrl: string
  modelId: string
  timeoutMs: number
  enabled: boolean
  note: string | null
  /** 创建必填；更新时为空表示保留原 key */
  apiKey?: string
}

/** key 只露末 4 位；长度 ≤4 时全掩码 */
export function maskApiKey(key: string): string {
  return key.length <= 4 ? '****' : `****${key.slice(-4)}`
}

/** API 响应的端点形态——apiKey 永不出现在此类型（契约测试守卫） */
export type PublicEndpoint = Omit<SelfHostedEndpoint, 'apiKey'> & { apiKeyMasked: string }

export function toPublicEndpoint(row: SelfHostedEndpoint): PublicEndpoint {
  const { apiKey: _apiKey, ...rest } = row
  return { ...rest, apiKeyMasked: maskApiKey(row.apiKey) }
}

export interface ValidationResult {
  ok: boolean
  error?: string
  value?: EndpointPayload
}

/** 入参校验 + 规整（timeoutMs 夹取到 1s–10min） */
export function validateEndpointPayload(
  payload: Record<string, unknown>,
  opts?: { requireApiKey?: boolean },
): ValidationResult {
  const capability = payload.capability
  if (typeof capability !== 'string' || !ENDPOINT_CAPABILITIES.includes(capability as EndpointCapability)) {
    return { ok: false, error: `capability 必须是 ${ENDPOINT_CAPABILITIES.join('/')}` }
  }
  const protocol = payload.protocol
  if (typeof protocol !== 'string' || !ENDPOINT_PROTOCOLS.includes(protocol as EndpointProtocol)) {
    return { ok: false, error: `protocol 必须是 ${ENDPOINT_PROTOCOLS.join('/')}` }
  }
  const baseUrl = typeof payload.baseUrl === 'string' ? payload.baseUrl.trim() : ''
  if (!/^https?:\/\//i.test(baseUrl)) {
    return { ok: false, error: 'baseUrl 必须是 http(s) 地址（含到 /v1，如 http://dgx:8000/v1）' }
  }
  const modelId = typeof payload.modelId === 'string' ? payload.modelId.trim() : ''
  if (!modelId) {
    return { ok: false, error: 'modelId 是必需的' }
  }
  const rawTimeout = typeof payload.timeoutMs === 'number'
    ? payload.timeoutMs
    : capability === 'image' ? 120_000 : 60_000 // spec 口径：图像 120s、文本 60s
  const timeoutMs = Math.min(600000, Math.max(1000, Math.round(rawTimeout)))

  const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : ''
  if (opts?.requireApiKey && !apiKey) {
    return { ok: false, error: 'apiKey 是必需的' }
  }

  return {
    ok: true,
    value: {
      capability: capability as EndpointCapability,
      protocol: protocol as EndpointProtocol,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      modelId,
      timeoutMs,
      enabled: payload.enabled !== false,
      note: typeof payload.note === 'string' && payload.note.trim() ? payload.note.trim() : null,
      apiKey: apiKey || undefined,
    },
  }
}

export async function listEndpoints(): Promise<SelfHostedEndpoint[]> {
  return db.select().from(selfHostedEndpoints).orderBy(selfHostedEndpoints.capability)
}

/** 创建端点；enabled 时联动 local 路由行。id 可由调用方预生成（审计先行需要真实 id） */
export async function createEndpoint(value: EndpointPayload, id?: string): Promise<SelfHostedEndpoint> {
  const [row] = await db
    .insert(selfHostedEndpoints)
    .values({
      id: id ?? uuidv4(),
      capability: value.capability,
      protocol: value.protocol,
      baseUrl: value.baseUrl,
      apiKey: value.apiKey!,
      modelId: value.modelId,
      timeoutMs: value.timeoutMs,
      enabled: value.enabled,
      note: value.note,
    })
    .returning()
  if (row.enabled) await syncLocalRouteOnEnable(row)
  return row
}

/** 更新端点：apiKey 为空 = 保留原 key；任何更新都重同步路由行（modelId 联动，防分叉）；
 * capability 变更时旧行必须下线，否则旧 capability 残留启用中的 local 路由行 */
export async function updateEndpoint(id: string, value: EndpointPayload): Promise<SelfHostedEndpoint | null> {
  const [existing] = await db.select().from(selfHostedEndpoints).where(eq(selfHostedEndpoints.id, id)).limit(1)
  if (!existing) return null

  const [row] = await db
    .update(selfHostedEndpoints)
    .set({
      capability: value.capability,
      protocol: value.protocol,
      baseUrl: value.baseUrl,
      apiKey: value.apiKey || existing.apiKey,
      modelId: value.modelId,
      timeoutMs: value.timeoutMs,
      enabled: value.enabled,
      note: value.note,
      updatedAt: new Date(),
    })
    .where(eq(selfHostedEndpoints.id, id))
    .returning()

  if (existing.capability !== row.capability) {
    await syncLocalRouteOnDisable(existing.capability as Capability)
  }
  if (row.enabled) await syncLocalRouteOnEnable(row)
  else await syncLocalRouteOnDisable(row.capability as Capability)
  return row
}

/** 该 capability 是否已有「其他」启用中的端点（唯一启用约束前置检查，避免撞唯一索引变 500） */
export function hasOtherEnabled(
  endpoints: SelfHostedEndpoint[],
  capability: string,
  excludeId?: string,
): boolean {
  return endpoints.some(e => e.capability === capability && e.enabled && e.id !== excludeId)
}

/** 启停切换（不删除配置） */
export async function setEndpointEnabled(id: string, enabled: boolean): Promise<SelfHostedEndpoint | null> {
  const [row] = await db
    .update(selfHostedEndpoints)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(selfHostedEndpoints.id, id))
    .returning()
  if (!row) return null
  if (enabled) await syncLocalRouteOnEnable(row)
  else await syncLocalRouteOnDisable(row.capability as Capability)
  return row
}

/** 删除端点并下线路由行 */
export async function deleteEndpoint(id: string): Promise<SelfHostedEndpoint | null> {
  const [row] = await db.delete(selfHostedEndpoints).where(eq(selfHostedEndpoints.id, id)).returning()
  if (!row) return null
  await syncLocalRouteOnDisable(row.capability as Capability)
  return row
}
