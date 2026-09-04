import { getStaticDefaultRoutes } from './defaults'
import { loadRoutes, invalidateRouteCache, type RouteRow } from './route-cache'
import { getEnabledEndpoint, type SelfHostedEndpoint } from './endpoints'
import type { Capability, RouteEntry } from './types'

/**
 * F2/M2 路由器：按 capability 解析有序供应商列表（primary 在前，降级顺序在后）。
 *
 * 数据来源优先级：provider_routes 表（60s 内存缓存，热更新）
 *   → 表为空或读取失败时回落静态默认（保证无迁移也能跑）。
 * modelKey 匹配规则：指定 modelKey 时，匹配该模型的条目排在通用条目（modelKey=NULL）之前。
 *
 * 生效模型解析（resolveActiveRoutes）：自建端点（ADR-0001）启用时 local 条目排首、
 * 云端殿后——首条失败即云端回退。endpoint 启用行是「自建生效」的唯一事实源，
 * provider_routes 的 region='local' 行由端点同步函数维护。
 */

export { invalidateRouteCache }

export interface ActiveRouteEntry extends RouteEntry {
  /** provider='local' 时携带的自建端点配置 */
  endpoint?: SelfHostedEndpoint
}

export async function resolveRoutes(
  capability: Capability,
  opts?: { modelKey?: string | null; region?: string },
): Promise<RouteEntry[]> {
  const region = opts?.region || 'overseas'
  let rows: RouteRow[]
  try {
    rows = await loadRoutes()
  } catch (err) {
    console.error('[providers/router] 读取 provider_routes 失败，回落静态默认:', err)
    rows = []
  }

  const entries = rows
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

/**
 * 生效模型解析：有序候选，local（自建）在首、云端在后。
 * 调用方语义：首条尝试失败/超时 → 取下一条（云端回退）。
 */
export async function resolveActiveRoutes(capability: Capability): Promise<ActiveRouteEntry[]> {
  const [endpoint, cloud] = await Promise.all([
    getEnabledEndpoint(capability).catch(err => {
      console.error(`[providers/router] 读取 ${capability} 自建端点失败，按未启用处理:`, err)
      return null
    }),
    resolveRoutes(capability),
  ])
  if (!endpoint) return cloud

  const localRows = (await resolveRoutes(capability, { region: 'local' })).filter(
    r => r.provider === 'local',
  )
  const primary: ActiveRouteEntry = localRows[0]
    ? { ...localRows[0], endpoint }
    : { provider: 'local', modelKey: endpoint.modelId, priority: 0, endpoint }
  return [primary, ...cloud]
}
