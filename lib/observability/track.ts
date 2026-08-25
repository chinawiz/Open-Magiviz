import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { funnelEvents } from '@/lib/schema'

/**
 * N1 基础漏斗埋点（创意 → 成片）。
 *
 * 设计（系统设计 §3.2.M7 的"基础级"落地）：
 * - 进程内模块，不暴露 /internal HTTP 端点；
 * - 双通道：结构化 JSON 日志（Vercel Logs / Log Drain 可消费）+ funnel_events 表
 *   异步落库（fire-and-forget，落库失败只记错误、不影响主流程）；
 * - 支撑度量：V1 降级成功率（provider/model/fallbackApplied 字段）、
 *   V4 漏斗转化（stage 序列 idea→script→character→storyboard→video→final）。
 *
 * 约定：stage 记录"该步骤的提交/完成结果"；provider 为实际命中的供应商。
 */

export type FunnelStage = 'idea' | 'script' | 'character' | 'storyboard' | 'video' | 'final'

export interface FunnelEventInput {
  stage: FunnelStage
  userId?: string | null
  projectId?: string | null
  success?: boolean
  durationMs?: number
  provider?: string
  model?: string
  fallbackApplied?: boolean
  taskId?: string
  error?: string
}

export function trackFunnelEvent(input: FunnelEventInput): void {
  const event = { success: true, ...input }

  console.log(JSON.stringify({
    type: 'funnel',
    ts: new Date().toISOString(),
    stage: event.stage,
    success: event.success,
    userId: event.userId ?? undefined,
    projectId: event.projectId ?? undefined,
    durationMs: event.durationMs,
    provider: event.provider,
    model: event.model,
    fallbackApplied: event.fallbackApplied,
    taskId: event.taskId,
    error: event.error,
  }))

  db.insert(funnelEvents).values({
    id: uuidv4(),
    userId: event.userId ?? null,
    projectId: event.projectId ?? null,
    stage: event.stage,
    success: event.success,
    durationMs: event.durationMs ?? null,
    provider: event.provider ?? null,
    model: event.model ?? null,
    fallbackApplied: event.fallbackApplied ?? false,
    taskId: event.taskId ?? null,
    error: event.error ? String(event.error).slice(0, 500) : null,
  }).catch((err) => {
    console.error('[track] funnel event 落库失败:', err)
  })
}
