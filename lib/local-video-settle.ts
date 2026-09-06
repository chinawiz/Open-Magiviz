/**
 * 本地（自建 H3）视频任务的统一轮询+结算（P7 T2/T3 共用）。
 * 调用方：/api/ai/video-status（客户端轮询）与补偿 cron（generate_story_video_local）。
 *
 * 状态机（对齐网关 T1）：
 *   queued/running → 'pending'（客户端继续轮询 / 补偿跳过）
 *   succeeded      → funnel 下载 → R2 转存（铁律 D1：funnel URL 不出 app 边界）
 *                    → sceneVideoData 落库 → 积分结算 → funnel 事件 → 'succeeded'
 *   failed         → 任务行标 failed + funnel 事件 → 'failed'
 *   端点停用/网关暂态不可达 → 'pending'（不误判失败；补偿按 stillProcessing/僵尸规则收尾）
 */
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { aiGenerationTasks } from '@/lib/schema'
import { getEnabledEndpoint } from '@/lib/providers/endpoints'
import { toEndpointConfig } from '@/lib/providers/chat-active'
import { localVideoStatus } from '@/lib/providers/local'
import { uploadImageBufferToR2 } from '@/lib/r2-upload'
import { persistLocalVideoUrl } from '@/lib/local-persist'
import { claimTaskPointsDeduction, markTaskSuccess } from '@/lib/task-points'
import { trackFunnelEvent } from '@/lib/observability/track'
import { v4 as uuidv4 } from 'uuid'

export type LocalVideoSettleState = 'pending' | 'succeeded' | 'failed' | 'endpoint_disabled'

type LocalVideoTaskRow = typeof aiGenerationTasks.$inferSelect

async function downloadVideoWithRetry(url: string): Promise<Buffer> {
  let lastErr: unknown
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length === 0) throw new Error('empty body')
      return buf
    } catch (e) {
      lastErr = e
      await new Promise(r => setTimeout(r, 3000))
    }
  }
  throw new Error(`下载失败: ${String(lastErr).slice(0, 200)}`)
}

/** 轮询网关并推进单个本地视频任务的终态与副作用。幂等：终态行直接短路返回。 */
export async function pollAndSettleLocalVideo(row: LocalVideoTaskRow): Promise<{
  state: LocalVideoSettleState
  videoUrl?: string
  error?: string
}> {
  if (row.status === 'success') {
    return { state: 'succeeded' }
  }
  if (row.status === 'failed') {
    return { state: 'failed', error: 'generation failed' }
  }

  const enabled = await getEnabledEndpoint('video').catch(() => null)
  if (!enabled) {
    return { state: 'endpoint_disabled', error: '本地视频端点已停用' }
  }

  let gatewayStatus: string
  let gatewayVideoUrl: string | undefined
  let gatewayError: string | undefined
  try {
    const st = await localVideoStatus(
      toEndpointConfig({ provider: 'local', modelKey: enabled.modelId, priority: 0, endpoint: enabled }),
      row.taskId,
    )
    gatewayStatus = st.status
    gatewayVideoUrl = st.videoUrl
    gatewayError = st.error
  } catch (err) {
    // 网关/隧道暂态不可达（H3 采样期 ComfyUI HTTP 长时间不响应属常态）：按 pending 处理
    const message = err instanceof Error ? err.message : String(err)
    return { state: 'pending', error: message }
  }

  if (gatewayStatus === 'failed') {
    await db.update(aiGenerationTasks)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(aiGenerationTasks.taskId, row.taskId))
    trackFunnelEvent({
      stage: 'video', userId: row.userId, projectId: row.projectId, success: false,
      provider: 'local', model: row.model ?? 'minimaxH3', fallbackApplied: false,
      taskId: row.taskId, error: gatewayError,
    })
    return { state: 'failed', error: gatewayError }
  }

  if (gatewayStatus !== 'succeeded' || !gatewayVideoUrl) {
    return { state: 'pending' }
  }

  // succeeded：funnel 下载 → R2 转存（失败按自建失败回退语义：任务失败，积分照扣 Kie 同语义）
  let r2Url: string
  try {
    const buf = await downloadVideoWithRetry(gatewayVideoUrl)
    r2Url = await uploadImageBufferToR2(buf, `generated/local-videos/${Date.now()}-${uuidv4().slice(0, 8)}.mp4`, 'video/mp4')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.update(aiGenerationTasks)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(aiGenerationTasks.taskId, row.taskId))
    trackFunnelEvent({
      stage: 'video', userId: row.userId, projectId: row.projectId, success: false,
      provider: 'local', model: row.model ?? 'minimaxH3', fallbackApplied: true,
      taskId: row.taskId, error: `R2 转存失败: ${message}`,
    })
    return { state: 'failed', error: `R2 转存失败: ${message}` }
  }

  const persisted = await persistLocalVideoUrl({
    projectId: row.projectId,
    versionId: row.versionId,
    sceneIndex: row.itemId ? Number(row.itemId) : null,
    videoUrl: r2Url,
  })
  if (!persisted) {
    console.error('[local-video-settle] sceneVideoData 落库未命中（URL 已在 R2，客户端仍可取返回值）:', { taskId: row.taskId, r2Url })
  }

  const claimed = await claimTaskPointsDeduction(row.taskId)
  if (claimed && row.pointsAmount > 0) {
    await db.update(aiGenerationTasks)
      .set({ pointsDeducted: true, updatedAt: new Date() })
      .where(eq(aiGenerationTasks.taskId, row.taskId))
    const { deductPoints, PointsAction } = await import('@/lib/points')
    await deductPoints(row.userId, row.pointsAmount, undefined, PointsAction.GENERATE_STORY_VIDEO)
  }
  await db.update(aiGenerationTasks)
    .set({ status: 'success', updatedAt: new Date() })
    .where(eq(aiGenerationTasks.taskId, row.taskId))
  await markTaskSuccess(row.taskId)
  trackFunnelEvent({
    stage: 'video', userId: row.userId, projectId: row.projectId, success: true,
    provider: 'local', model: row.model ?? 'minimaxH3', fallbackApplied: false,
    taskId: row.taskId,
  })

  return { state: 'succeeded', videoUrl: r2Url }
}
