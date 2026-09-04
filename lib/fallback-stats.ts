import { and, eq, gte, max, count } from 'drizzle-orm'
import { db } from '@/lib/db'
import { funnelEvents } from '@/lib/schema'

/**
 * 自建回退统计（ADR-0001）：近 N 天按 stage 聚合 fallbackApplied 事件。
 * 数据源是 funnel_events 双通道的落库半边（lib/observability/track.ts 写入），
 * provider=实际命中方、fallbackApplied=发生过自建→云端回退。
 * 回退率抬升 = 自建容量/健康度的核心告警信号。
 */

export interface FallbackStatRow {
  stage: string
  /** stage → 一步能力的近似映射（funnel stage 粒度粗于 capability：storyboard 混合分镜文本与分镜图） */
  capability: string
  count: number
  lastAt: Date | null
}

const STAGE_CAPABILITY: Record<string, string> = {
  script: 'script',
  storyboard: 'storyboard_text / image',
  character: 'image',
  video: 'video',
  idea: '（流程前段，无自建）',
  final: '（合成，已自托管）',
}

export async function getFallbackStats(days = 7): Promise<FallbackStatRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const rows = await db
    .select({
      stage: funnelEvents.stage,
      count: count(),
      lastAt: max(funnelEvents.createdAt),
    })
    .from(funnelEvents)
    .where(and(eq(funnelEvents.fallbackApplied, true), gte(funnelEvents.createdAt, since)))
    .groupBy(funnelEvents.stage)
  return rows.map(row => ({
    stage: row.stage,
    capability: STAGE_CAPABILITY[row.stage] ?? '（未知 stage）',
    count: Number(row.count),
    lastAt: row.lastAt ?? null,
  }))
}
