import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { getAuthedSession } from '@/lib/api'
import { db } from '@/lib/db'
import { aiGenerationTasks } from '@/lib/schema'
import { pollAndSettleLocalVideo } from '@/lib/local-video-settle'

export const maxDuration = 300

/**
 * GET /api/ai/video-status?taskId= —— 本地（自建 H3）视频任务状态轮询（P7 T2/T4）。
 * 客户端在 generate-story-video 返回 provider=local 后定期轮询本路由；
 * 结算副作用（funnel 下载→R2 转存→sceneVideoData 落库→积分结算→funnel 事件）
 * 统一收敛在 lib/local-video-settle（补偿 cron 共用同一实现）。
 * 网关/端点暂态异常按 pending 返回——由客户端继续轮询，不误判失败。
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

  const result = await pollAndSettleLocalVideo(row)
  if (result.state === 'endpoint_disabled') {
    return NextResponse.json({ status: 'pending', error: result.error }, { status: 409 })
  }
  if (result.state === 'failed') {
    return NextResponse.json({ status: 'failed', error: result.error })
  }
  if (result.state === 'succeeded') {
    return NextResponse.json({ status: 'succeeded', videoUrl: result.videoUrl })
  }
  return NextResponse.json({ status: 'pending', error: result.error })
}
