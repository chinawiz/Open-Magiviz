import { NextRequest, NextResponse } from "next/server"

// 导入 Pusher 工具
import { notifyVideoSuccess, notifyTaskFail } from '@/lib/pusher'
import { db } from '@/lib/db'
import { aiGenerationTasks, projectData, videoProjects } from '@/lib/schema'
import { deductPoints, PointsAction } from '@/lib/points'
import { resolveTargetVersion } from '@/lib/versionMapper'
import { claimTaskPointsDeduction, releaseTaskPointsClaim, markTaskSuccess } from '@/lib/task-points'
import { verifyKieWebhook } from '@/lib/webhook-security'
import { eq } from 'drizzle-orm'
import { triggerSceneVideoMigration } from '@/trigger/migrate-assets'
import type { KieApiResponse } from '@/lib/ai-types'
import { safeJsonCopy } from '@/lib/ai-types'
import type { SceneVideoItem } from '@/lib/types'

// Webhook/轻量快速路径：显式声明函数时长上限（U-04，生产纪律 10s 红线）
export const maxDuration = 10

// Webhook HMAC Key - 从环境变量获取
const WEBHOOK_HMAC_KEY = process.env.KIE_VEO_WEBHOOK_HMAC_KEY!

/**
 * 从请求体获取原始 JSON（不解析）
 */
async function getRawBody(req: NextRequest): Promise<string> {
  const arrayBuffer = await req.arrayBuffer()
  const decoder = new TextDecoder('utf-8')
  return decoder.decode(arrayBuffer)
}

/**
 * POST /api/ai/kie/veo-webhook
 * 
 * Kie.ai VEO 视频生成回调处理（适配官方文档格式）
 * 官方文档: https://docs.kie.ai/cn/veo3-api/generate-veo-3-video-callbacks
 * 
 * 回调格式（官方）:
 * {
 *   "code": 200,
 *   "msg": "Veo3.1 视频生成成功。",
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
      console.error('[VEO Webhook] 解析失败:', parseError)
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    console.log('[VEO Webhook] 收到原始回调:', JSON.stringify(bodyData, null, 2))

    // 3. 解析回调数据 - 适配官方文档格式
    const code = bodyData?.code          // 状态码: 200=成功, 400=失败, 422=托底失败等
    const msg = bodyData?.msg            // 消息
    const data = bodyData?.data          // 数据对象
    
    // 获取 taskId
    const taskId = data?.taskId
    if (!taskId) {
      console.error('[VEO Webhook] 缺少 taskId')
      return NextResponse.json({ error: 'Missing taskId' }, { status: 400 })
    }

    // 4. 验证签名（生产环境 fail-closed，统一策略见 lib/webhook-security.ts）
    const signatureRejection = verifyKieWebhook({
      taskId,
      timestamp,
      signature: receivedSignature,
      secret: WEBHOOK_HMAC_KEY,
      label: 'VEO Webhook',
    })
    if (signatureRejection) {
      return NextResponse.json({ error: signatureRejection.error }, { status: signatureRejection.status })
    }

    // 5. 根据官方文档的 code 判断状态
    // 200 = 成功
    // 400 = 客户端错误（内容政策等）
    // 422 = 托底失败
    // 500 = 内部错误
    // 501 = 失败
    
    console.log('[VEO Webhook] 回调状态:', { 
      taskId, 
      code, 
      msg,
      duration: Date.now() - startTime
    })

    if (code === 200) {
      return handleSuccessCallback(taskId, data, startTime)
    } else if (code === 400) {
      return handleFailCallback(taskId, msg || '提示词违反内容政策', 'CONTENT_POLICY', startTime)
    } else if (code === 422) {
      // 托底失败
      return handleFailCallback(taskId, msg || '托底失败', 'FALLBACK_FAILED', startTime)
    } else if (code === 500) {
      return handleFailCallback(taskId, msg || '内部错误', 'INTERNAL_ERROR', startTime)
    } else if (code === 501) {
      return handleFailCallback(taskId, msg || '视频生成失败', 'GENERATION_FAILED', startTime)
    }

    console.warn('[VEO Webhook] 未知状态码:', code)
    return NextResponse.json({ status: 'received', taskId, code }, { status: 200 })

  } catch (error) {
    console.error('[VEO Webhook] 处理错误:', error)
    return NextResponse.json({ status: 'received' }, { status: 200 })
  }
}

/**
 * 处理成功回调
 * 
 * 官方格式:
 * {
 *   "data": {
 *     "taskId": "...",
 *     "info": {
 *       "resultUrls": ["video1.mp4", ...],
 *       "originUrls": ["original_video1.mp4", ...],
 *       "resolution": "1080p"
 *     },
 *     "fallbackFlag": false
 *   }
 * }
 */
async function handleSuccessCallback(taskId: string, data: KieApiResponse, startTime: number) {
  const info = data?.info
  if (!info) {
    console.error('[VEO Webhook] info 为空:', { taskId })
    return NextResponse.json({ error: 'Empty info' }, { status: 400 })
  }

  // 提取视频 URL（官方格式是直接数组）
  const resultUrls = info?.resultUrls || []
  const originUrls = info?.originUrls || []
  const resolution = info?.resolution

  const fallbackFlag = data?.fallbackFlag || false

  const videoInfo = {
    taskId,
    resultUrls,        // 生成的视频 URL 数组
    originUrls,        // 原始视频 URL 数组（仅非16:9时）
    resolution,        // 视频分辨率
    fallbackFlag,      // 是否使用托底模型
  }

  console.log('[VEO Webhook] ✅ 视频生成成功:', {
    taskId,
    resultUrlCount: resultUrls.length,
    originUrlCount: originUrls.length,
    resolution,
    fallbackFlag,
    duration_ms: Date.now() - startTime
  })

  if (resultUrls.length > 0) {
    console.log('[VEO Webhook] 视频地址示例:', resultUrls[0])
  }

  // 查询任务映射（扣除积分 + 获取 projectId/itemId 用于写入 projectData）
  let taskProjectId: string | undefined
  let taskItemId: string | undefined
  let taskUserId: string | undefined
  let taskVersionId: string | undefined
  let taskVersionGroupId: string | undefined
  try {
    const taskRecord = await db
      .select()
      .from(aiGenerationTasks)
      .where(eq(aiGenerationTasks.taskId, taskId))
      .limit(1)

    if (taskRecord.length === 0) {
      console.warn(`[VEO Webhook] 未找到任务映射记录: ${taskId}`)
      // 仍然尝试写入 projectData（使用 taskVersionId）
    } else {
      const task = taskRecord[0]
      taskProjectId = task.projectId || undefined
      taskItemId = task.itemId || undefined
      taskUserId = task.userId
      taskVersionId = task.versionId || undefined
      taskVersionGroupId = task.versionGroupId || undefined

      // 扣除积分（原子认领：并发重复回调只有一个赢家，杜绝双扣）
      if (!task.pointsDeducted) {
        const claimed = await claimTaskPointsDeduction(taskId)
        if (claimed) {
          try {
            await deductPoints(task.userId, task.pointsAmount, undefined, PointsAction.GENERATE_STORY_VIDEO)
            await markTaskSuccess(taskId)
            console.log(`[VEO Webhook] 用户 ${task.userId} 成功生成视频，扣除 ${task.pointsAmount} 积分`)
          } catch (pointsError) {
            console.error('[VEO Webhook] 扣除积分失败:', pointsError)
            await releaseTaskPointsClaim(taskId).catch(() => {})
          }
        }
      }
    }
  } catch (pointsError) {
    console.error('[VEO Webhook] 扣除积分失败:', pointsError)
  }

  // 确定目标版本（支持重新生成创建新版本）
  // veo-webhook 处理剧情视频生成，currentStep 为 scene_video
  let targetVersionId: string
  let newVersion: number
  if (taskProjectId) {
    try {
      const resolved = await resolveTargetVersion(taskProjectId, taskVersionGroupId, taskVersionId, 'scene_video')
      targetVersionId = resolved.targetVersionId
      newVersion = resolved.newVersion
      console.log(`[VEO Webhook] 确定目标版本: ${targetVersionId} (v${newVersion}), isNew=${resolved.isNewVersion}`)
    } catch (error) {
      console.error('[VEO Webhook] 确定目标版本失败:', error)
      return NextResponse.json({ error: 'Failed to resolve version' }, { status: 500 })
    }
  } else {
    // 没有 projectId，使用 taskVersionId 或返回错误
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
          videoUrl: resultUrls[0] || '',
          isTemporary: true,
        }
        newRecordIdForMigration = targetRecord.id
        // 只迁移当前刚生成的那一个剧情视频，而不是整个数组
        sceneVideosForMigration = [{
          ...sceneVideos[sceneIndex],
        }]
        console.log(`[VEO Webhook] 剧情视频迁移数据: sceneIndex=${sceneIndex}, sceneId=${sceneId}`)
        await db
          .update(projectData)
          .set({ sceneVideoData: sceneVideos, updatedAt: new Date() })
          .where(eq(projectData.id, targetRecord.id))
        console.log(`[VEO Webhook] 剧情视频 ${sceneIndex} videoUrl 已写入 projectData(v${targetRecord.version}):`, { projectId: taskProjectId, videoUrl: resultUrls[0] })
        // 更新 videoProjects.currentStep
        await db.update(videoProjects)
          .set({ currentStep: 'scene_video', updatedAt: new Date() })
          .where(eq(videoProjects.id, taskProjectId))
      }
    } catch (dbError) {
      console.error('[VEO Webhook] 写入 projectData 失败:', dbError)
    }
  }

  // 通过 Pusher 推送到前端（前端用此刷新 UI）
  const pusherSuccess = await notifyVideoSuccess({
    taskId,
    videoUrl: resultUrls[0] || '',
    resultUrls,
    originUrls,
    resolution,
    sceneIndex: !isNaN(sceneIndex) ? sceneIndex : undefined,
    projectId: taskProjectId,
    versionId: targetVersionId,
    version: newVersion,
    versionGroupId: taskVersionGroupId,
  })

  if (!pusherSuccess) {
    console.warn('[VEO Webhook] Pusher 推送失败，但回调仍会返回成功:', { taskId })
  }

  // 异步触发 R2 搬运（等 Pusher 推送后再开始，前端先用第三方临时链接展示）
  if (newRecordIdForMigration && resultUrls[0]) {
    triggerSceneVideoMigration(taskProjectId!, newRecordIdForMigration, sceneVideosForMigration!).catch((err) => {
      console.error('[VEO Webhook] 触发剧情视频搬运失败:', err)
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
  console.error('[VEO Webhook] ❌ 视频生成失败:', {
    taskId,
    failMsg,
    errorCode,
    duration_ms: Date.now() - startTime
  })

  // 内容审核错误提示
  const isContentPolicyError = errorCode.includes('content_policy') ||
    errorCode.includes('CONTENT_POLICY') ||
    failMsg.toLowerCase().includes('content policy') ||
    failMsg.includes('内容政策')

  if (isContentPolicyError) {
    console.warn('[VEO Webhook] 内容审核失败 - 请修改提示词:', { taskId, failMsg })
  }

  // 托底失败
  const isFallbackError = errorCode === 'FALLBACK_FAILED'
  if (isFallbackError) {
    console.warn('[VEO Webhook] 托底失败:', { taskId, failMsg })
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

    if (taskRecord.length === 0) {
      console.warn(`[VEO Webhook] 失败处理：未找到任务映射记录: ${taskId}`)
    } else {
      const task = taskRecord[0]
      taskProjectId = task.projectId || undefined
      taskItemId = task.itemId || undefined
      taskVersionId = task.versionId || undefined
      taskVersionGroupId = task.versionGroupId || undefined
    }
  } catch (queryError) {
    console.error('[VEO Webhook] 查询任务映射失败:', queryError)
  }

  // 失败时也要写入 projectData（清空视频URL，避免残留无效数据）
  if (taskProjectId) {
    try {
      // 使用 resolveTargetVersion 确定目标版本
      const resolved = await resolveTargetVersion(taskProjectId, taskVersionGroupId, taskVersionId, 'scene_video')
      const targetVersionId = resolved.targetVersionId
      
      const [targetRecord] = await db
        .select()
        .from(projectData)
        .where(eq(projectData.id, targetVersionId))
        .limit(1)

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
        console.log(`[VEO Webhook] 失败写入 projectData(v${targetRecord.version}): projectId=${taskProjectId}, itemId=${taskItemId}`)
      }
    } catch (dbError) {
      console.error('[VEO Webhook] 失败时写入 projectData 失败:', dbError)
    }
  }

  // 更新任务状态为失败
  try {
    await db.update(aiGenerationTasks)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(aiGenerationTasks.taskId, taskId))
  } catch (updateError) {
    console.error('[VEO Webhook] 更新任务状态失败:', updateError)
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
 * GET /api/ai/kie/veo-webhook
 * 
 * 健康检查端点
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'VEO Webhook',
    timestamp: new Date().toISOString()
  }, { status: 200 })
}
