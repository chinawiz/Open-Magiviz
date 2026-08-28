import { NextRequest,  NextResponse } from "next/server"

// 导入 Pusher 工具
import { notifyVideoSuccess, notifyTaskFail } from '@/lib/pusher'
import { db } from '@/lib/db'
import { aiGenerationTasks, projectData, videoProjects } from '@/lib/schema'
import { deductPoints, PointsAction } from '@/lib/points'
import { eq, desc } from 'drizzle-orm'
import { triggerSceneVideoMigration } from '@/trigger/migrate-assets'
import { resolveTargetVersion, getActiveVersionIdForFail } from '@/lib/versionMapper'
import { claimTaskPointsDeduction, releaseTaskPointsClaim, markTaskSuccess } from '@/lib/task-points'
import { verifyKieWebhook } from '@/lib/webhook-security'
import type { KieApiResponse } from '@/lib/ai-types'
import { safeJsonCopy } from '@/lib/ai-types'
import type { SceneVideoItem } from '@/lib/types'

// Webhook/轻量快速路径：显式声明函数时长上限（U-04，生产纪律 10s 红线）
export const maxDuration = 10

// Webhook HMAC Key - 通用视频回调
const WEBHOOK_HMAC_KEY = process.env.KIE_WEBHOOK_HMAC_KEY!

/**
 * 从请求体获取原始 JSON（不解析）
 */
async function getRawBody(req: NextRequest): Promise<string> {
  const arrayBuffer = await req.arrayBuffer()
  const decoder = new TextDecoder('utf-8')
  return decoder.decode(arrayBuffer)
}

/**
 * POST /api/ai/kie/video-webhook
 *
 * 通用视频生成回调处理 - 支持多种视频模型
 *
 * Webhook 配置：
 * - Veo 3.1: 使用 KIE_VEO_WEBHOOK_URL（专用）
 * - Kling 3.0 / Seedance 2.5 / Seedance 2.0 Fast / Seedance 2.0 Mini / Wan 2.7 / HappyHorse / Gemini Omni: 使用 KIE_VIDEO_WEBHOOK_URL 或 KIE_KLING_WEBHOOK_URL（共用）
 *
 * 支持的模型：
 * 1. Veo 3.1 - https://docs.kie.ai/cn/veo3-api/generate-veo-3-video-callbacks（使用专用 webhook）
 * 2. Seedance 2.5 - bytedance/seedance-2-5（9积分/s，audio on，720p，4-30s）
 * 3. Seedance 2.0 - bytedance/seedance-2（3积分/s，audio off，480p）
 * 4. Seedance 2.0 Fast - bytedance/seedance-2-fast（2积分/s，audio on，720p）
 * 5. Seedance 2.0 Mini - bytedance/seedance-2-mini（1.5积分/s，audio on，720p）
 * 6. Kling 3.0 - kling-3.0/video（2积分/s，audio on）
 * 7. Veo 3.1 - veo3_fast（2积分/s）
 * 8. Wan 2.7 - wan/2-7-image-to-video（2积分/s，720p，audio on）
 * 9. HappyHorse - happyhorse-1-1/image-to-video（2积分/s，默认 720p，API 调用 HappyHorse 1.1 接口）
 * 10. Gemini Omni - gemini-omni-video（1积分/s，4/6/8/10s，1080p）
 *
 * 回调格式 (Veo 3.1):
 * {
 *   "code": 200,
 *   "msg": "Veo3.1 视频生成成功",
 *   "data": {
 *     "taskId": "veo_task_...",
 *     "info": {
 *       "resultUrls": ["..."],
 *       "originUrls": ["..."],
 *       "resolution": "1080p"
 *     },
 *     "fallbackFlag": false
 *   }
 * }
 *
 * 回调格式 (Kling 3.0 / Seedance 2.5 / Seedance 2.0 Fast / HappyHorse):
 * {
 *   "code": 200,
 *   "msg": "视频生成成功",
 *   "data": {
 *     "taskId": "task_...",
 *     "status": "success",
 *     "result": {
 *       "videoUrl": "...",
 *       "duration": "5"
 *     }
 *   }
 * }
 *
 * 回调格式 (Gemini Omni):
 * {
 *   "code": 200,
 *   "msg": "视频生成成功",
 *   "data": {
 *     "taskId": "task_...",
 *     "status": "success",
 *     "result": {
 *       "videoUrl": "..."
 *     }
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    // 1. 获取 header 字段
    const timestamp = request.headers.get('X-Webhook-Timestamp')
    const receivedSignature = request.headers.get('X-Webhook-Signature')
    
    // 2. 获取原始请求体用于验证
    const rawBody = await getRawBody(request)
    let bodyData: KieApiResponse

    try {
      bodyData = JSON.parse(rawBody)
    } catch (parseError) {
      console.error('[Video Webhook] 解析失败:', parseError)
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    console.log('[Video Webhook] 收到原始回调:', JSON.stringify(bodyData, null, 2))

    // 3. 解析回调数据
    const code = bodyData?.code
    const msg = bodyData?.msg
    const data = bodyData?.data
    
    // 获取 taskId - 兼容不同格式
    const taskId = data?.taskId || data?.task_id
    if (!taskId) {
      console.error('[Video Webhook] 缺少 taskId')
      return NextResponse.json({ error: 'Missing taskId' }, { status: 400 })
    }

    // 4. 验证签名（生产环境 fail-closed，统一策略见 lib/webhook-security.ts）
    const signatureRejection = verifyKieWebhook({
      taskId,
      timestamp,
      signature: receivedSignature,
      secret: WEBHOOK_HMAC_KEY,
      label: 'Video Webhook',
    })
    if (signatureRejection) {
      return NextResponse.json({ error: signatureRejection.error }, { status: signatureRejection.status })
    }

    // 5. 根据 code 判断状态
    // 200 = 成功
    // 400 = 客户端错误
    // 422 = 托底失败 (Veo)
    // 500 = 内部错误
    // 501 = 失败
    
    console.log('[Video Webhook] 回调状态:', { 
      taskId, 
      code, 
      msg,
      duration: Date.now() - startTime
    })

    if (code === 200) {
      return handleSuccessCallback(taskId, data, startTime)
    } else if (code === 400) {
      return handleFailCallback(taskId, msg || '客户端错误', 'CLIENT_ERROR', startTime)
    } else if (code === 422) {
      // 托底失败 (Veo)
      return handleFailCallback(taskId, msg || '托底失败', 'FALLBACK_FAILED', startTime)
    } else if (code === 500) {
      return handleFailCallback(taskId, msg || '内部错误', 'INTERNAL_ERROR', startTime)
    } else if (code === 501) {
      return handleFailCallback(taskId, msg || '视频生成失败', 'GENERATION_FAILED', startTime)
    }

    console.warn('[Video Webhook] 未知状态码:', code)
    return NextResponse.json({ status: 'received', taskId, code }, { status: 200 })

  } catch (error) {
    console.error('[Video Webhook] 处理错误:', error)
    return NextResponse.json({ status: 'received' }, { status: 200 })
  }
}

/**
 * 处理成功回调 - 兼容多种格式
 */
async function handleSuccessCallback(taskId: string, data: KieApiResponse, startTime: number) {
  // 解析 resultJson（Kie.ai 实际返回的 resultUrls 在这个 JSON 字符串里）
  let parsedResult: KieApiResponse = {}
  if (data?.resultJson) {
    try {
      parsedResult = JSON.parse(data.resultJson)
    } catch (e) {
      console.warn('[Video Webhook] 解析 resultJson 失败:', e)
    }
  }

  // Kling 3.0 格式（resultJson 里的字段）
  let resultUrls: string[] = parsedResult?.resultUrls || []
  let originUrls: string[] = parsedResult?.originUrls || []
  let duration: string | undefined = parsedResult?.duration || data?.result?.duration
  let aspectRatio: string | undefined = parsedResult?.aspectRatio || data?.result?.aspectRatio
  let resolution: string | undefined = data?.info?.resolution

  // Veo 格式 (兼容)
  if (data?.info) {
    resultUrls = data.info?.resultUrls || resultUrls
    originUrls = data.info?.originUrls || originUrls
    resolution = data.info?.resolution || resolution
  }

  // HappyHorse 格式: data.result.videoUrl (单个 URL)
  if (data?.result?.videoUrl && resultUrls.length === 0) {
    resultUrls = [data.result.videoUrl]
  }

  const videoUrl = resultUrls[0] || ''

  const videoInfo = {
    taskId,
    resultUrls,
    originUrls,
    duration,
    aspectRatio,
    resolution,
  }

  console.log('[Video Webhook] ✅ 视频生成成功:', {
    taskId,
    resultUrlCount: resultUrls.length,
    duration,
    aspectRatio,
    resolution,
    duration_ms: Date.now() - startTime
  })

  if (resultUrls.length > 0) {
    console.log('[Video Webhook] 视频地址示例:', resultUrls[0])
  }

  // 查询任务映射（扣除积分 + 获取 projectId/itemId 用于写入 projectData）
  let taskProjectId: string | undefined
  let taskItemId: string | undefined
  let taskVersionId: string | undefined
  let taskVersionGroupId: string | undefined
  try {
    const taskRecord = await db
      .select()
      .from(aiGenerationTasks)
      .where(eq(aiGenerationTasks.taskId, taskId))
      .limit(1)

    if (taskRecord.length === 0) {
      console.warn(`[Video Webhook] 未找到任务映射记录: ${taskId}`)
    } else {
      const task = taskRecord[0]
      taskProjectId = task.projectId || undefined
      taskItemId = task.itemId || undefined
      taskVersionId = task.versionId || undefined
      taskVersionGroupId = task.versionGroupId || undefined

      // 扣除积分（原子认领：并发重复回调只有一个赢家，杜绝双扣）
      if (!task.pointsDeducted) {
        const claimed = await claimTaskPointsDeduction(taskId)
        if (claimed) {
          try {
            await deductPoints(task.userId, task.pointsAmount, undefined, PointsAction.GENERATE_STORY_VIDEO)
            await markTaskSuccess(taskId)
            console.log(`[Video Webhook] 用户 ${task.userId} 成功生成视频，扣除 ${task.pointsAmount} 积分`)
          } catch (pointsError) {
            console.error('[Video Webhook] 扣除积分失败:', pointsError)
            await releaseTaskPointsClaim(taskId).catch(() => {})
          }
        }
      }
    }
  } catch (pointsError) {
    console.error('[Video Webhook] 扣除积分失败:', pointsError)
  }

  // 确定目标版本（支持重新生成创建新版本）
  // video-webhook 处理剧情视频生成，currentStep 为 scene_video
  let targetVersionId: string
  let newVersion: number
  if (taskProjectId) {
    try {
      const resolved = await resolveTargetVersion(taskProjectId, taskVersionGroupId, taskVersionId, 'scene_video')
      targetVersionId = resolved.targetVersionId
      newVersion = resolved.newVersion
      console.log(`[Video Webhook] 确定目标版本: ${targetVersionId} (v${newVersion}), isNew=${resolved.isNewVersion}`)
    } catch (error) {
      console.error('[Video Webhook] 确定目标版本失败:', error)
      return NextResponse.json({ error: 'Failed to resolve version' }, { status: 500 })
    }
  } else {
    // 没有 projectId，使用 taskVersionId 或最新版本
    if (taskVersionId) {
      targetVersionId = taskVersionId
      const [record] = await db.select().from(projectData).where(eq(projectData.id, taskVersionId)).limit(1)
      newVersion = record?.version ?? 1
    } else {
      return NextResponse.json({ error: 'Missing projectId and versionId' }, { status: 400 })
    }
  }

  // 写入 projectData.sceneVideoData（通过 targetVersionId 精确定位版本）
  let newRecordIdForMigration: string | undefined
  let sceneVideosForMigration: SceneVideoItem[] | undefined
  const sceneIndex = taskItemId ? parseInt(taskItemId, 10) : NaN
  if (taskProjectId && !isNaN(sceneIndex)) {
    try {
      const [targetRecord] = await db
        .select()
        .from(projectData)
        .where(eq(projectData.id, targetVersionId))
        .limit(1)

      if (targetRecord) {
        const sceneVideos: SceneVideoItem[] = safeJsonCopy<SceneVideoItem[]>(targetRecord.sceneVideoData) || []
        // 确保数组预分配到 sceneIndex 位置，避免索引越界
        while (sceneVideos.length <= sceneIndex) {
          sceneVideos.push({})
        }
        // 从 scriptScenes 中获取 sceneId
        const scriptScenes = safeJsonCopy<{ id?: string; sceneId?: string }[]>(targetRecord.scriptScenes) || []
        const scene = scriptScenes[sceneIndex] || {}
        const sceneId = scene.id || scene.sceneId || undefined
        sceneVideos[sceneIndex] = {
          ...(sceneVideos[sceneIndex] || {}),
          sceneId,  // 写入 sceneId 以便后续迁移时匹配
          videoUrl: videoUrl,
          isTemporary: true,
        }
        newRecordIdForMigration = targetRecord.id
        // 只迁移当前刚生成的那一个剧情视频，而不是整个数组
        sceneVideosForMigration = [{
          ...sceneVideos[sceneIndex],
        }]
        console.log(`[Video Webhook] 剧情视频迁移数据: sceneIndex=${sceneIndex}, sceneId=${sceneId}`)
        await db
          .update(projectData)
          .set({ sceneVideoData: sceneVideos, updatedAt: new Date() })
          .where(eq(projectData.id, targetRecord.id))
        console.log(`[Video Webhook] 剧情视频 ${sceneIndex} videoUrl 已写入 projectData(v${targetRecord.version}):`, { projectId: taskProjectId, videoUrl })
        // 更新 videoProjects.currentStep
        await db.update(videoProjects)
          .set({ currentStep: 'scene_video', updatedAt: new Date() })
          .where(eq(videoProjects.id, taskProjectId))
      }
    } catch (dbError) {
      console.error('[Video Webhook] 写入 projectData 失败:', dbError)
    }
  }

  // 通过 Pusher 推送到前端
  const pusherSuccess = await notifyVideoSuccess({
    taskId,
    videoUrl,
    resultUrls,
    originUrls,
    resolution,
    duration,
    sceneIndex: !isNaN(sceneIndex) ? sceneIndex : undefined,
    projectId: taskProjectId,
    versionId: targetVersionId,
    version: newVersion,
    versionGroupId: taskVersionGroupId,
  })

  if (!pusherSuccess) {
    console.warn('[Video Webhook] Pusher 推送失败，但回调仍会返回成功:', { taskId })
  }

  // 异步触发 R2 搬运（等 Pusher 推送后再开始，前端先用第三方临时链接展示）
  if (newRecordIdForMigration && videoUrl) {
    triggerSceneVideoMigration(taskProjectId!, newRecordIdForMigration, sceneVideosForMigration!).catch((err) => {
      console.error('[Video Webhook] 触发剧情视频搬运失败:', err)
    })
  }

  return NextResponse.json({
    status: 'received',
    taskId,
    success: true,
    videoInfo,
    duration_ms: Date.now() - startTime
  }, { status: 200 })
}

/**
 * 处理失败回调
 */
async function handleFailCallback(taskId: string, failMsg: string, errorCode: string, startTime: number) {
  console.error('[Video Webhook] ❌ 视频生成失败:', {
    taskId,
    failMsg,
    errorCode,
    duration_ms: Date.now() - startTime
  })

  // 内容审核错误提示
  const isContentPolicyError = errorCode.includes('CONTENT_POLICY') ||
    errorCode.includes('CLIENT_ERROR') ||
    failMsg.toLowerCase().includes('content policy') ||
    failMsg.includes('内容政策')

  if (isContentPolicyError) {
    console.warn('[Video Webhook] 内容审核失败 - 请修改提示词:', { taskId, failMsg })
  }

  // 托底失败
  const isFallbackError = errorCode === 'FALLBACK_FAILED'
  if (isFallbackError) {
    console.warn('[Video Webhook] 托底失败:', { taskId, failMsg })
  }

  // 查询任务映射，获取 projectId/itemId
  let taskProjectId: string | undefined
  let taskItemId: string | undefined
  let taskVersionId: string | undefined
  let taskVersionGroupId: string | undefined
  try {
    const taskRecord = await db
      .select()
      .from(aiGenerationTasks)
      .where(eq(aiGenerationTasks.taskId, taskId))
      .limit(1)

    const task = taskRecord[0]
    if (task) {
      taskProjectId = task.projectId || undefined
      taskItemId = task.itemId || undefined
      taskVersionId = task.versionId || undefined
      taskVersionGroupId = task.versionGroupId || undefined
    }

    // 失败时也要写入 projectData（清空视频URL，避免残留无效数据）
    if (taskProjectId) {
      try {
        let targetVersionId: string
        if (taskVersionGroupId) {
          const activeVersionId = await getActiveVersionIdForFail(taskProjectId, taskVersionGroupId, taskVersionId)
          targetVersionId = activeVersionId || taskVersionId || ''
        } else {
          targetVersionId = taskVersionId || ''
        }

        let targetRecord: { id: string; version: number; sceneVideoData?: unknown } | null = null
        if (targetVersionId) {
          const [record] = await db
            .select()
            .from(projectData)
            .where(eq(projectData.id, targetVersionId))
            .limit(1)
          targetRecord = record
        }
        if (!targetRecord) {
          const [record] = await db
            .select()
            .from(projectData)
            .where(eq(projectData.projectId, taskProjectId!))
            .orderBy(desc(projectData.version))
            .limit(1)
          targetRecord = record
        }

        if (targetRecord) {
          // 尝试解析 sceneIndex（itemId 可能是 sceneIndex）
          let sceneIndex = NaN
          if (taskItemId) {
            sceneIndex = parseInt(taskItemId, 10)
          }
          const sceneVideos: SceneVideoItem[] = safeJsonCopy<SceneVideoItem[]>(targetRecord.sceneVideoData) || []
          if (!isNaN(sceneIndex)) {
            // 确保数组预分配到 sceneIndex 位置
            while (sceneVideos.length <= sceneIndex) {
              sceneVideos.push({})
            }
            sceneVideos[sceneIndex] = { ...(sceneVideos[sceneIndex] || {}), videoUrl: '', generationError: failMsg }
          } else {
            // 无有效 sceneIndex 时写入所有（兼容逻辑）
            for (let i = 0; i < sceneVideos.length; i++) {
              if (!sceneVideos[i].videoUrl) {
                sceneVideos[i] = { ...sceneVideos[i], videoUrl: '', generationError: failMsg }
                break
              }
            }
          }
          await db.update(projectData).set({ sceneVideoData: sceneVideos, updatedAt: new Date() }).where(eq(projectData.id, targetRecord.id))
          console.log(`[Video Webhook] 失败写入 projectData(v${targetRecord.version}): projectId=${taskProjectId}, itemId=${taskItemId}`)
        }
      } catch (dbError) {
        console.error('[Video Webhook] 失败时写入 projectData 失败:', dbError)
      }
    }

    // 更新任务状态为失败
    await db.update(aiGenerationTasks)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(aiGenerationTasks.taskId, taskId))
  } catch (updateError) {
    console.error('[Video Webhook] 更新任务状态失败:', updateError)
  }

  // 通过 Pusher 推送失败事件到前端
  await notifyTaskFail({
    taskId,
    error: failMsg || '视频生成失败',
    errorCode
  })

  return NextResponse.json({
    status: 'received',
    taskId,
    success: false,
    failMsg,
    errorCode,
    duration_ms: Date.now() - startTime
  }, { status: 200 })
}

/**
 * GET /api/ai/kie/video-webhook
 * 
 * 健康检查端点
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'Video Webhook (Universal)',
    supportedModels: ['kling-3.0', 'veo-3.1', 'seedance-2', 'seedance-2-fast', 'seedance-2-mini', 'wan-2.7', 'happyhorse-1-1'],
    timestamp: new Date().toISOString()
  }, { status: 200 })
}
