import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { providerRoutes } from '@/lib/schema'
import { getStaticDefaultRoutes } from './defaults'
import type { Capability, RouteEntry } from './types'

/**
 * F2/M2 路由器：按 capability 解析有序供应商列表（primary 在前，降级顺序在后）。
 *
 * 数据来源优先级：provider_routes 表（60s 内存缓存，热更新）
 *   → 表为空或读取失败时回落静态默认（保证无迁移也能跑）。
 * modelKey 匹配规则：指定 modelKey 时，匹配该模型的条目排在通用条目（modelKey=NULL）之前。
 */

const CACHE_TTL_MS = 60_000

interface RouteRow {
  capability: string
  region: string
  provider: string
  modelKey: string | null
  priority: number
}

let cache: { at: number; rows: RouteRow[] } | null = null

async function loadRoutes(): Promise<RouteRow[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows
  const rows = await db
    .select({
      capability: providerRoutes.capability,
      region: providerRoutes.region,
      provider: providerRoutes.provider,
      modelKey: providerRoutes.modelKey,
      priority: providerRoutes.priority,
    })
    .from(providerRoutes)
    .where(eq(providerRoutes.enabled, true))
  cache = { at: Date.now(), rows }
  return rows
}

export async function resolveRoutes(
  capability: Capability,
  opts?: { modelKey?: string | null; region?: string },
): Promise<RouteEntry[]> {
  const region = opts?.region || 'overseas'
  let rows: RouteRow[] = []
  try {
    rows = await loadRoutes()
  } catch (err) {
    console.error('[providers/router] 读取 provider_routes 失败，回落静态默认:', err)
  }

  const entries: RouteEntry[] = rows
    .filter(r => r.capability === capability && r.region === region)
    .map(({ provider, modelKey, priority }) => ({
      provider: provider as RouteEntry['provider'],
      modelKey,
      priority,
    }))
    .sort((a, b) => a.priority - b.priority)

  const resolved = entries.length > 0 ? entries : getStaticDefaultRoutes()[capability]

  if (opts?.modelKey) {
    // 指定模型：精确匹配的条目优先，通用条目（modelKey=NULL）殿后
    const exact = resolved.filter(r => r.modelKey === opts.modelKey)
    const generic = resolved.filter(r => r.modelKey === null)
    const rest = resolved.filter(r => r.modelKey !== opts.modelKey && r.modelKey !== null)
    if (exact.length > 0 || generic.length > 0) return [...exact, ...generic, ...rest]
  }
  return resolved
}

/** 供配置变更后主动失效缓存（管理端更新路由表时调用） */
export function invalidateRouteCache(): void {
  cache = null
}
