import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { getAuthedSession, jsonError } from '@/lib/api'
import { authOptions } from '@/lib/auth'
import { isPaidPlan } from '@/lib/plan-limits'
import { users as usersTable } from '@/lib/schema'
import { fal } from "@fal-ai/client"
import { db } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { aiGenerationTasks } from '@/lib/schema'
import { v4 as uuidv4 } from 'uuid'
import { withFalWebhookToken } from '@/lib/webhook-security'
import { composeFinalVideo } from '@/trigger/compose-final-video'

// 配置 FAL API Key（支持两个环境变量）
const falApiKey = process.env.FAL_KEY || process.env.FAL_API_KEY!

fal.config({
  credentials: falApiKey
})

// FAL Compose Webhook URL
const FAL_COMPOSE_WEBHOOK_URL = process.env.FAL_COMPOSE_WEBHOOK_URL

/**
 * POST /api/ai/fal/compose-story-video
 * 
 * 使用 FAL AI FFmpeg API 将多个剧情视频合成为一部完整视频
 * 文档: https://fal.ai/models/fal-ai/ffmpeg-api/compose/api
 * 
 * 请求体:
 * {
 *   tracks: [
 *     {
 *       id: string,              // 必需：轨道唯一标识
 *       type: "video" | "audio", // 必需：轨道类型
 *       keyframes: [
 *         {
 *           timestamp: number,   // 必需：开始时间（毫秒）
 *           duration: number,    // 必需：持续时间（毫秒）
 *           url: string          // 必需：媒体文件URL
 *         }
 *       ]
 *     }
 *   ],
 *   outputFormat?: {
 *     width?: number,            // 可选：输出宽度，默认 1920
 *     height?: number,           // 可选：输出高度，默认 1080
 *     fps?: number,              // 可选：帧率，默认 30
 *   }
 * }
 * 
 * 返回:
 * {
 *   success: boolean,
 *   videoUrl: string,            // 合成后的视频URL
 *   thumbnailUrl: string,        // 视频缩略图URL
 *   requestId: string            // 请求ID
 * }
 */

// 默认输出格式
const DEFAULT_OUTPUT_FORMAT = {
  width: 1920,
  height: 1080,
  fps: 30
}

/**
 * 验证 tracks 数据格式
 */
interface ComposeTrack {
  id: string
  type: 'video' | 'audio'
  keyframes: { timestamp: number; duration: number; url: string }[]
}
interface ComposeOutputFormat {
  width?: number
  height?: number
  fps?: number
}

function validateTracks(tracks: ComposeTrack[]): { valid: boolean; error?: string } {
  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return { valid: false, error: "Tracks must be a non-empty array" }
  }

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]
    
    if (!track.id || typeof track.id !== 'string') {
      return { valid: false, error: `Track[${i}]: id is required and must be a string` }
    }
    
    if (!track.type || !['video', 'audio'].includes(track.type)) {
      return { valid: false, error: `Track[${i}]: type must be 'video' or 'audio'` }
    }
    
    if (!track.keyframes || !Array.isArray(track.keyframes) || track.keyframes.length === 0) {
      return { valid: false, error: `Track[${i}]: keyframes must be a non-empty array` }
    }
    
    for (let j = 0; j < track.keyframes.length; j++) {
      const keyframe = track.keyframes[j]
      
      if (typeof keyframe.timestamp !== 'number' || keyframe.timestamp < 0) {
        return { valid: false, error: `Track[${i}].keyframe[${j}]: timestamp must be a non-negative number` }
      }
      
      if (typeof keyframe.duration !== 'number' || keyframe.duration <= 0) {
        return { valid: false, error: `Track[${i}].keyframe[${j}]: duration must be a positive number` }
      }
      
      if (!keyframe.url || typeof keyframe.url !== 'string') {
        return { valid: false, error: `Track[${i}].keyframe[${j}]: url is required and must be a string` }
      }
    }
  }

  return { valid: true }
}

/**
 * 计算视频总时长（毫秒）
 * 根据所有 keyframes 的 timestamp + duration 计算
 */
function calculateTotalDuration(tracks: ComposeTrack[]): number {
  let maxEndTime = 0

  tracks.forEach((track) => {
    if (track.type === 'video' || track.type === 'audio') {
      track.keyframes.forEach((kf: { timestamp: number; duration: number; url: string }) => {
        const endTime = kf.timestamp + kf.duration
        if (endTime > maxEndTime) {
          maxEndTime = endTime
        }
      })
    }
  })

  return Math.round(maxEndTime / 1000) // 转换为秒
}

/**
 * 获取文件大小（字节）
 */
async function getFileSize(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    if (response.ok) {
      const contentLength = response.headers.get('Content-Length')
      if (contentLength) {
        return parseInt(contentLength, 10)
      }
    }
    return null
  } catch (error) {
    return null
  }
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '未知'
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * 构建 FFmpeg API 输入格式
 * 注意：FAL API 只支持一个视频轨道和一个音频轨道
 * 需要将所有视频合并到一个轨道中
 */
function buildFfmpegInput(tracks: ComposeTrack[], outputFormat: ComposeOutputFormat) {
  // 分离视频和音频轨道
  const videoKeyframes: { timestamp: number; duration: number; url: string }[] = []
  const audioKeyframes: { timestamp: number; duration: number; url: string }[] = []

  tracks.forEach((track) => {
    if (track.type === 'video') {
      videoKeyframes.push(...track.keyframes.map((kf: { timestamp: number; duration: number; url: string }) => ({
        timestamp: kf.timestamp,
        duration: kf.duration,
        url: kf.url
      })))
    } else if (track.type === 'audio') {
      audioKeyframes.push(...track.keyframes.map((kf: { timestamp: number; duration: number; url: string }) => ({
        timestamp: kf.timestamp,
        duration: kf.duration,
        url: kf.url
      })))
    }
  })

  // 按时间戳排序
  videoKeyframes.sort((a, b) => a.timestamp - b.timestamp)
  audioKeyframes.sort((a, b) => a.timestamp - b.timestamp)

  const ffTracks: { id: string; type: 'video' | 'audio'; keyframes: { timestamp: number; duration: number; url: string }[] }[] = []

  // 添加视频轨道（只支持一个）
  if (videoKeyframes.length > 0) {
    ffTracks.push({
      id: 'main_video',
      type: 'video',
      keyframes: videoKeyframes
    })
  }

  // 添加音频轨道（只支持一个）
  if (audioKeyframes.length > 0) {
    ffTracks.push({
      id: 'main_audio',
      type: 'audio',
      keyframes: audioKeyframes
    })
  }

  return ffTracks
}

export async function POST(request: NextRequest) {
  try {
    // 验证用户登录
    const session = await getAuthedSession()
    if (!session) {
      // 临时诊断：区分「无会话」与「会话缺 user.id」（compose 401 定位用，定位后移除）
      const raw = await getServerSession(authOptions)
      console.error('[compose-story-video] 401 diagnose:', {
        hasRawSession: !!raw,
        rawUserId: (raw as { user?: { id?: string } } | null)?.user?.id ?? null,
      })
      return NextResponse.json({
        error: 'Unauthorized',
        diagnose: raw ? 'session_missing_user_id' : 'no_session',
      }, { status: 401 })
    }

    // 高成本步骤门控：合成仅对付费计划或已验卡用户开放（2026-08-30 定价重构 §4.2）
    const composeUserRows = await db
      .select({
        subscriptionPlan: usersTable.subscriptionPlan,
        cardVerifiedAt: usersTable.cardVerifiedAt,
      })
      .from(usersTable)
      .where(eq(usersTable.id, session.user.id))
      .limit(1)
    const composeUser = composeUserRows[0]
    if (!isPaidPlan(composeUser?.subscriptionPlan) && !composeUser?.cardVerifiedAt) {
      return jsonError(403, 'Final composition requires a paid plan or verified payment method', {
        errorKey: 'upgrade_required',
      })
    }

    const body = await request.json()
    const { tracks, outputFormat, projectId, versionId } = body

    // 验证 tracks
    const validation = validateTracks(tracks || [])
    if (!validation.valid) {
      console.error('[compose-story-video] 参数验证失败:', validation.error)
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      )
    }

    // 合并输出格式
    const format = {
      ...DEFAULT_OUTPUT_FORMAT,
      ...outputFormat
    }

    console.log('[compose-story-video] 收到合成请求:', {
      trackCount: tracks.length,
      outputFormat: format,
      projectId,
      versionId,
    })

    // 构建 FFmpeg API 输入
    const ffTracks = buildFfmpegInput(tracks, format)

    // 构建 FAL FFmpeg API 请求
    const input = {
      tracks: ffTracks
    }

    // 计算总时长（秒）
    const totalDuration = calculateTotalDuration(tracks)

    // 合成供应商选择：默认自托管（Trigger.dev + ffmpeg，直传 R2）；
    // COMPOSE_PROVIDER=fal 回退旧云端路径（含独立音频轨时也自动回退 FAL）
    const useLocalCompose = process.env.COMPOSE_PROVIDER !== 'fal'
    const hasAudioTrack = ffTracks.some(t => t.type === 'audio')

    if (useLocalCompose && !hasAudioTrack) {
      // 自托管合成：按时间戳顺序提取视频轨 URL
      const videoTrack = ffTracks.find(t => t.type === 'video')
      const videoUrls = (videoTrack?.keyframes || []).map(kf => kf.url)
      if (videoUrls.length === 0) {
        return NextResponse.json({ error: 'No video keyframes' }, { status: 400 })
      }

      const taskId = `compose_${uuidv4().replace(/-/g, '').slice(0, 20)}`
      try {
        await db.insert(aiGenerationTasks).values({
          id: uuidv4(),
          taskId,
          userId: session.user.id,
          taskType: 'generate_final_video',
          pointsAmount: totalDuration, // 临时存储总时长（秒），合成 0 积分
          pointsDeducted: false,
          status: 'pending',
          projectId: projectId || null,
          versionId: versionId || null,
          itemId: null,
          versionGroupId: body.versionGroupId || null,
          newVersionId: null,
        })
      } catch (dbError) {
        console.error('[compose-story-video] 存储任务映射失败:', dbError)
      }

      await composeFinalVideo.trigger({
        taskId,
        userId: session.user.id,
        projectId: projectId || null,
        versionId: versionId || null,
        versionGroupId: body.versionGroupId || null,
        videoUrls,
        totalDurationSec: totalDuration,
        outputFormat: format,
      })

      console.log('[compose-story-video] 自托管合成任务已触发:', { taskId, projectId, clips: videoUrls.length })
      return NextResponse.json({ success: true, requestId: taskId })
    }

    if (hasAudioTrack) {
      console.warn('[compose-story-video] 含独立音频轨，回退 FAL 合成路径（本地合成暂不支持混音）')
    }

    console.log('[compose-story-video] 调用 FAL FFmpeg API (webhook 模式):', { projectId, totalDuration })

    // 调用 FAL FFmpeg Compose API（webhook 模式）
    try {
      const { request_id } = await fal.queue.submit('fal-ai/ffmpeg-api/compose', {
        input,
        webhookUrl: withFalWebhookToken(FAL_COMPOSE_WEBHOOK_URL),
      })

      console.log('[compose-story-video] 任务已提交:', { request_id, projectId })

      // 存储任务映射（用于 webhook 回调）
      // 注意：totalDuration 暂存在 pointsAmount 字段（generate_final_video 任务的积分本来就是 0）
      try {
        await db.insert(aiGenerationTasks).values({
          id: uuidv4(),
          taskId: request_id,
          userId: session.user.id,
          taskType: 'generate_final_video',
          pointsAmount: totalDuration, // 临时存储总时长（秒）
          pointsDeducted: false,
          status: 'pending',
          projectId: projectId || null,
          versionId: versionId || null,
          itemId: null,
          versionGroupId: body.versionGroupId || null,
          newVersionId: null,
        })
        console.log('[compose-story-video] 任务映射已存储:', { request_id, userId: session.user.id, projectId, versionId, versionGroupId: body.versionGroupId, totalDuration })
      } catch (dbError) {
        console.error('[compose-story-video] 存储任务映射失败:', dbError)
      }

      return NextResponse.json({
        success: true,
        requestId: request_id,
      })
    } catch (apiError: unknown) {
      const err = apiError as { status?: number; body?: { message?: string }; message?: string; requestId?: string }
      console.error('[compose-story-video] FAL API 错误:', {
        status: err.status,
        body: err.body,
        message: err.message,
        requestId: err.requestId
      })
      return NextResponse.json(
        { error: err.body?.message || err.message || 'FAL API error' },
        { status: err.status || 500 }
      )
    }

  } catch (error: any) {
    console.error('[compose-story-video] 处理请求错误:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

