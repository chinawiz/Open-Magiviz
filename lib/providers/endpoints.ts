import { eq } from 'drizzle-orm'
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
