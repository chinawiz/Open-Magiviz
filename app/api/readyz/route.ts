import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Readiness 就绪检查：探依赖（数据库），失败返回 503 供外部拨测摘流。
 *
 * DB 探测缓存（2026-11-16，Neon 免费档 CU-hour 治理）：
 * 外部拨测（Better Stack）每 3 分钟打一次本端点，若每次都真连 DB，
 * Neon 免费档最小 300s 的自动挂起永远等不到，compute 全月常驻
 * ≈ 180 CU-h，单独就超出免费档 100 CU-h/月（超限即挂起到下个账期）。
 * 缓存窗口必须大于 300s 挂起延迟，取 60 分钟：拨测几乎全部命中缓存，
 * DB 每小时最多被本端点唤醒一次（每次活跃 ~5 分钟）。
 * DB 故障检测延迟由 Trigger 补偿 cron 的 healthchecks.io /fail 告警兜底（≤30 分钟）。
 * 注：serverless 下模块级缓存按 lambda 实例隔离，多实例只是每小时多几次探测，量级无碍。
 */
const DB_PROBE_CACHE_MS = 60 * 60 * 1000

let cachedOk: { checkedAt: number } | null = null

export async function GET() {
  const cacheFresh = cachedOk !== null && Date.now() - cachedOk.checkedAt < DB_PROBE_CACHE_MS
  if (cacheFresh && cachedOk) {
    return NextResponse.json({
      status: 'ok',
      checks: { database: 'ok' },
      checkedAt: new Date(cachedOk.checkedAt).toISOString(),
      cached: true,
    })
  }
  try {
    await db.execute(sql`SELECT 1`)
    cachedOk = { checkedAt: Date.now() }
    return NextResponse.json({
      status: 'ok',
      checks: { database: 'ok' },
      checkedAt: new Date(cachedOk.checkedAt).toISOString(),
      cached: false,
    })
  } catch (error) {
    // 失败不缓存：摘流信号必须实时；DB 挂起/宕机状态下重试探测也不消耗 CU-hour
    console.error('[readyz] 依赖检查失败:', error)
    return NextResponse.json(
      { status: 'unavailable', checks: { database: 'fail' } },
      { status: 503 },
    )
  }
}
