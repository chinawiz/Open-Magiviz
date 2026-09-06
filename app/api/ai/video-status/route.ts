import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { getAuthedSession } from '@/lib/api'
import { deductPoints, PointsAction } from '@/lib/points'
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

export const maxDuration = 300

/**
 * GET /api/ai/video-status?taskId= —— 本地（自建 H3）视频任务状态轮询（P7 T2）。
 * 客户端在 generate-story-video 返回 provider=local 后定期轮询本路由：
 * succeeded 时服务端完成 funnel 下载 → R2 转存 → sceneVideoData 落库 → 积分结算 → funnel 事件，
 * 前端随后从项目态取到 R2 URL；failed 时如实结算标记（失败照扣，Kie 同语义）。
 * 网关/端点查询异常按「暂态」返回 pending——由客户端继续轮询，不误判失败。
 */
export async function GET(request: NextRequest) {
  const session = await getAuthedSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const taskId = request.nextUrl.searchParams.get('taskId') ?? ''
  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
  }

  const [row] = await db
    .select()
    .from(aiGenerationTasks)
    .where(and(eq(aiGenerationTasks.taskId, taskId), eq(aiGenerationTasks.userId, session.user.id)))
    .limit(1)
  if (!row || row.taskType !== 'generate_story_video_local') {
    return NextResponse.json({ error: 'task not found' }, { status: 404 })
  }
  if (row.status === 'success') {
    return NextResponse.json({ status: 'succeeded' })
  }
  if (row.status === 'failed') {
    return NextResponse.json({ status: 'failed', error: 'generation failed' })
  }

  const enabled = await getEnabledEndpoint('video').catch(() => null)
  if (!enabled) {
    // 端点被停用：无法查询网关。保持 pending 由补偿 cron/人工收尾，不误判失败。
    return NextResponse.json({ status: 'pending', error: '本地视频端点已停用，暂无法查询' })
  }

  let gatewayStatus: string
  let gatewayVideoUrl: string | undefined
  let gatewayError: string | undefined
  try {
    const st = await localVideoStatus(
      toEndpointConfig({ provider: 'local', modelKey: enabled.modelId, priority: 0, endpoint: enabled }),
      taskId)
    gatewayStatus = st.status
    gatewayVideoUrl = st.videoUrl
    gatewayError = st.error
  } catch (err) {
    // 网关/隧道暂态不可达：按 pending 处理，客户端继续轮询（不误判失败）
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ status: 'pending', error: message })
  }

  const startedAt = Date.now()
  if (gatewayStatus === 'failed') {
    await db.update(aiGenerationTasks)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(aiGenerationTasks.taskId, taskId))
    trackFunnelEvent({
      stage: 'video', userId: session.user.id, projectId: row.projectId, success: false,
      provider: 'local', model: row.model ?? 'minimaxH3', fallbackApplied: false, taskId,
      error: gatewayError, durationMs: Date.now() - startedAt,
    })
    return NextResponse.json({ status: 'failed', error: gatewayError })
  }

  if (gatewayStatus !== 'succeeded' || !gatewayVideoUrl) {
    return NextResponse.json({ status: 'pending' })
  }

  // succeeded：funnel 下载 → R2 转存（铁律 D1：funnel URL 不交给 Trigger/外部服务）
  let r2Url: string
  try {
    let lastErr: unknown
    let buf: Buffer | null = null
    for (let i = 0; i < 2 && !buf; i++) {
      try {
        const res = await fetch(gatewayVideoUrl, { signal: AbortSignal.timeout(120_000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        buf = Buffer.from(await res.arrayBuffer())
      } catch (e) {
        lastErr = e
        await new Promise(r => setTimeout(r, 3000))
      }
    }
    if (!buf) throw new Error(`下载失败: ${String(lastErr).slice(0, 200)}`)
    r2Url = await uploadImageBufferToR2(buf, `generated/local-videos/${Date.now()}-${uuidv4().slice(0, 8)}.mp4`, 'video/mp4')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.update(aiGenerationTasks)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(aiGenerationTasks.taskId, taskId))
    trackFunnelEvent({
      stage: 'video', userId: session.user.id, projectId: row.projectId, success: false,
      provider: 'local', model: row.model ?? 'minimaxH3', fallbackApplied: true, taskId,
      error: `R2 转存失败: ${message}`, durationMs: Date.now() - startedAt,
    })
    // R2 转存失败按自建失败回退语义：任务标记失败（积分照扣，Kie 同语义）
    return NextResponse.json({ status: 'failed', error: 'R2 转存失败' })
  }

  await persistLocalVideoUrl({
    projectId: row.projectId,
    versionId: row.versionId,
    sceneIndex: row.itemId ? Number(row.itemId) : null,
    videoUrl: r2Url,
  })
  await db.update(aiGenerationTasks)
    .set({ status: 'success', updatedAt: new Date() })
    .where(eq(aiGenerationTasks.taskId, taskId))
  const claimed = await claimTaskPointsDeduction(taskId)
  if (claimed && row.pointsAmount > 0) {
    await deductPoints(session.user.id, row.pointsAmount, undefined, PointsAction.GENERATE_STORY_VIDEO)
  }
  await markTaskSuccess(taskId)
  trackFunnelEvent({
    stage: 'video', userId: session.user.id, projectId: row.projectId, success: true,
    provider: 'local', model: row.model ?? 'minimaxH3', fallbackApplied: false, taskId,
    durationMs: Date.now() - startedAt,
  })

  return NextResponse.json({ status: 'succeeded', videoUrl: r2Url })
}
