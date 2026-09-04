import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { providerRoutes } from '@/lib/schema'

/**
 * provider_routes 路由行的 60s 内存缓存——从 router 抽出为独立模块，
 * 使端点管理（endpoints.ts）能失效缓存而不与 router 形成循环依赖。
 */

export interface RouteRow {
  capability: string
  region: string
  provider: string
  modelKey: string | null
  priority: number
}

const CACHE_TTL_MS = 60_000

let cache: { at: number; rows: RouteRow[] } | null = null

export async function loadRoutes(): Promise<RouteRow[]> {
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

/** 供配置变更后主动失效缓存（管理端更新路由表/自建端点时调用） */
export function invalidateRouteCache(): void {
  cache = null
}
