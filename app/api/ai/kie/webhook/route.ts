import { NextRequest, NextResponse } from "next/server"

// 导入 Pusher 工具
import { notifyImageSuccess, notifyTaskFail } from '@/lib/pusher'
import { db } from '@/lib/db'
import { aiGenerationTasks, projectData, videoProjects } from '@/lib/schema'
import { deductPoints, PointsAction } from '@/lib/points'
import { eq, desc } from 'drizzle-orm'
import {
  triggerCharacterImageMigration,
  triggerStoryboardImageMigration,
} from '@/trigger/migrate-assets'
import { resolveTargetVersion } from '@/lib/versionMapper'
import { claimTaskPointsDeduction, releaseTaskPointsClaim, markTaskSuccess } from '@/lib/task-points'
import { verifyKieWebhook } from '@/lib/webhook-security'
import type { KieApiResponse } from '@/lib/ai-types'
import { safeJsonCopy } from '@/lib/ai-types'
import type { CharacterItem, StoryboardItem, SceneVideoItem } from '@/lib/types'

// Webhook/轻量快速路径：显式声明函数时长上限（U-04，生产纪律 10s 红线）
export const maxDuration = 10

// Webhook HMAC Key - 从环境变量获取
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
 * POST /api/ai/kie/webhook
 * 
 * Kie.ai 回调处理 - 仅返回成功响应，不做其他处理
 */
export async function POST(request: NextRequest) {
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
      console.error('Kie.ai Webhook 解析失败:', parseError)
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    console.log('Kie.ai 收到回调:', JSON.stringify(bodyData).substring(0, 300))

    // 3. 解析回调数据
    const { data } = bodyData
    
    // 获取 taskId
    const taskId = data?.taskId || data?.task_id || bodyData.taskId
    if (!taskId) {
      console.error('Kie.ai Webhook: 缺少 taskId')
      return NextResponse.json({ error: 'Missing taskId' }, { status: 400 })
    }

    // 4. 验证签名（生产环境 fail-closed，统一策略见 lib/webhook-security.ts）
    const signatureRejection = verifyKieWebhook({
      taskId,
      timestamp,
      signature: receivedSignature,
      secret: WEBHOOK_HMAC_KEY,
      label: 'Kie Webhook',
    })
    if (signatureRejection) {
      return NextResponse.json({ error: signatureRejection.error }, { status: signatureRejection.status })
    }

    // 5. 检查任务状态
    const taskState = data?.state
    console.log('Kie.ai 任务状态:', { taskId, state: taskState })

    if (taskState !== 'success') {
      if (taskState === 'fail') {
        console.error('Kie.ai 任务失败:', { taskId, failMsg: data?.failMsg })

        // 查询任务映射，获取 projectId/itemId
        const failedTask = await db
          .select()
          .from(aiGenerationTasks)
          .where(eq(aiGenerationTasks.taskId, taskId))
          .limit(1)

        const failedRecord = failedTask[0]
        const failMsg = data?.failMsg || '生成失败'

        // 失败时也要写入 projectData（清空图片URL，避免残留无效数据）
        if (failedRecord?.projectId && failedRecord?.itemId) {
          try {
            const [latestData] = await db
              .select()
              .from(projectData)
              .where(eq(projectData.projectId, failedRecord.projectId))
              .orderBy(desc(projectData.version))
              .limit(1)

            if (latestData) {
              if (failedRecord.taskType === 'generate_character') {
                const characters: CharacterItem[] = safeJsonCopy<CharacterItem[]>(latestData.characterData) || []
                const charIdx = characters.findIndex((c: CharacterItem) => String(c.id) === String(failedRecord.itemId))
                if (charIdx >= 0) {
                  characters[charIdx] = { ...characters[charIdx], imageUrl: '', generationError: failMsg }
                }
                await db.update(projectData).set({ characterData: characters, updatedAt: new Date() }).where(eq(projectData.id, latestData.id))
              } else if (failedRecord.taskType === 'generate_storyboard') {
                const storyboards: StoryboardItem[] = safeJsonCopy<StoryboardItem[]>(latestData.storyboardData) || []
                let sbIdx = storyboards.findIndex((s: StoryboardItem) => String(s.id) === String(failedRecord.itemId) || String(s.sceneId) === String(failedRecord.itemId))
                if (sbIdx < 0) {
                  const itemIdNum = parseInt(String(failedRecord.itemId), 10)
                  if (!isNaN(itemIdNum) && itemIdNum >= 0 && itemIdNum < storyboards.length) {
                    sbIdx = itemIdNum
                  }
                }
                if (sbIdx >= 0 && sbIdx < storyboards.length) {
                  storyboards[sbIdx] = { ...storyboards[sbIdx], imageUrl: '', generationError: failMsg }
                }
                await db.update(projectData).set({ storyboardData: storyboards, updatedAt: new Date() }).where(eq(projectData.id, latestData.id))
              } else if (failedRecord.taskType === 'generate_storyboard_frame') {
                // 首尾帧模式失败处理
                const storyboards: StoryboardItem[] = safeJsonCopy<StoryboardItem[]>(latestData.storyboardData) || []
                
                // 新格式：itemId 直接作为 id 匹配
                let sbIdx = storyboards.findIndex((s: StoryboardItem) => String(s.id) === String(failedRecord.itemId))
                
                if (sbIdx < 0) {
                  // 降级：尝试旧格式的匹配方式
                  const originalItemId = failedRecord.itemId?.replace(/_first$|_last$/, '')
                  sbIdx = storyboards.findIndex((s: StoryboardItem) => String(s.id) === String(originalItemId) || String(s.sceneId) === String(originalItemId))
                  if (sbIdx < 0) {
                    const itemIdNum = parseInt(String(originalItemId), 10)
                    if (!isNaN(itemIdNum) && itemIdNum >= 0 && itemIdNum < storyboards.length) {
                      sbIdx = itemIdNum
                    }
                  }
                }
                
                if (sbIdx >= 0 && sbIdx < storyboards.length) {
                  storyboards[sbIdx] = { ...storyboards[sbIdx], imageUrl: '', url: '', generationError: failMsg }
                }
                await db.update(projectData).set({ storyboardData: storyboards, updatedAt: new Date() }).where(eq(projectData.id, latestData.id))
                console.log(`[Webhook] 首尾帧模式失败写入: itemId=${failedRecord.itemId}`)
              }
              console.log(`[Webhook] 失败写入 projectData: projectId=${failedRecord.projectId}, itemId=${failedRecord.itemId}`)
            }
          } catch (dbError) {
            console.error('[Webhook] 失败时写入 projectData 失败:', dbError)
          }
        }

        // 更新任务状态为失败
        try {
          await db.update(aiGenerationTasks)
            .set({
              status: 'failed',
              updatedAt: new Date()
            })
            .where(eq(aiGenerationTasks.taskId, taskId))
        } catch (updateError) {
          console.error('[Webhook] 更新任务状态失败:', updateError)
        }

        // 通过 Pusher 推送失败事件到前端
        // 添加小延迟避免多个 webhook 同时推送导致 Pusher 丢失消息
        await new Promise(resolve => setTimeout(resolve, 100))
        await notifyTaskFail({
          taskId,
          error: failMsg,
          errorCode: 'KIE_GENERATION_FAILED'
        })
      }
      // 即使失败也返回 200，避免重复回调
      return NextResponse.json({ status: 'received', taskId, state: taskState }, { status: 200 })
    }

    // 6. 解析结果（提前提取，后面多次使用）
    const resultJson = data?.resultJson
    if (!resultJson) {
      console.error('Kie.ai 返回结果为空:', { taskId })
      return NextResponse.json({ error: 'Empty result' }, { status: 400 })
    }

    let resultData: KieApiResponse
    try {
      resultData = JSON.parse(resultJson)
    } catch (parseError) {
      console.error('解析 resultJson 失败:', parseError)
      return NextResponse.json({ error: 'Invalid result format' }, { status: 400 })
    }

    const resultUrls = resultData?.resultUrls || []
    const imageUrl = resultUrls[0] || ''

    // 7. 查询任务映射（扣除积分 + 获取 projectId/itemId）
    const taskRecord = await db
      .select()
      .from(aiGenerationTasks)
      .where(eq(aiGenerationTasks.taskId, taskId))
      .limit(1)

    if (taskRecord.length === 0) {
      console.warn(`[Webhook] 未找到任务映射记录: ${taskId}`)
      return NextResponse.json({ status: 'received', taskId }, { status: 200 })
    }

    const task = taskRecord[0]
    const { projectId, itemId, userId, taskType, pointsAmount, pointsDeducted, versionId: taskVersionId, versionGroupId } = task
    console.log(`[Webhook] 任务信息: taskId=${taskId}, taskType=${taskType}, itemId=${itemId}, projectId=${projectId}, userId=${userId}, pointsDeducted=${pointsDeducted}`)

    // 根据 taskType 确定当前步骤，用于决定新版本复制哪些数据
    const currentStepMap: Record<string, 'character' | 'storyboard'> = {
      'generate_character': 'character',
      'generate_storyboard': 'storyboard',
      'generate_storyboard_frame': 'storyboard', // 首尾帧模式也是分镜图步骤
    }
    const currentStep = currentStepMap[taskType] || 'character'
    
    // 判断是首帧还是尾帧（通过 itemId 后缀）
    let frameType: 'first' | 'last' | null = null
    if (taskType === 'generate_storyboard_frame' && itemId) {
      if (itemId.endsWith('_first')) {
        frameType = 'first'
      } else if (itemId.endsWith('_last')) {
        frameType = 'last'
      }
      console.log(`[Webhook] 首尾帧回调: frameType=${frameType}, originalItemId=${itemId}`)
    }

    console.log(`[Webhook] 积分状态检查: taskId=${taskId}, pointsDeducted=${pointsDeducted}, userId=${userId}`)

    // 7.1 确定目标版本（支持重新生成创建新版本）
    let targetVersionId: string
    let newVersion: number
    try {
      const resolved = await resolveTargetVersion(projectId!, versionGroupId, taskVersionId, currentStep)
      targetVersionId = resolved.targetVersionId
      newVersion = resolved.newVersion
      console.log(`[Webhook] 确定目标版本: ${targetVersionId} (v${newVersion}), isNew=${resolved.isNewVersion}, currentStep=${currentStep}`)
    } catch (error) {
      console.error('[Webhook] 确定目标版本失败:', error)
      return NextResponse.json({ error: 'Failed to resolve version' }, { status: 500 })
    }

    // 7.2 直接写入 projectData（关键：前端关闭也不丢失数据）
    let newRecordIdForMigration: string | undefined
    let charactersForMigration: CharacterItem[] | undefined
    let storyboardsForMigration: StoryboardItem[] | undefined
    if (projectId) {
      try {
        const [targetRecord] = await db
          .select()
          .from(projectData)
          .where(eq(projectData.id, targetVersionId))
          .limit(1)

        if (targetRecord) {
          if (taskType === 'generate_character' && itemId) {
            const characters: CharacterItem[] = safeJsonCopy<CharacterItem[]>(targetRecord.characterData) || []
            const charIdx = characters.findIndex((c: CharacterItem) => String(c.id) === String(itemId))
            if (charIdx >= 0) {
              characters[charIdx] = { ...characters[charIdx], imageUrl }
              console.log(`[Webhook] 主角 ${itemId} 写入索引 ${charIdx}:`, { id: characters[charIdx].id })
            } else {
              console.warn(`[Webhook] 主角 ${itemId} 未匹配到任何记录，characters 长度: ${characters.length}`)
            }
            newRecordIdForMigration = targetRecord.id
            // 只迁移当前刚生成的那一个主角，而不是整个数组
            charactersForMigration = charIdx >= 0 ? [characters[charIdx]] : []
            await db
              .update(projectData)
              .set({ characterData: characters, updatedAt: new Date() })
              .where(eq(projectData.id, targetRecord.id))
            console.log(`[Webhook] 主角 ${itemId} imageUrl 已写入 projectData(v${targetRecord.version}):`, { projectId, imageUrl })
            // 更新 videoProjects.currentStep
            await db.update(videoProjects)
              .set({ currentStep: 'character', updatedAt: new Date() })
              .where(eq(videoProjects.id, projectId))
          } else if (taskType === 'generate_storyboard' && itemId) {
            // 普通分镜图模式：单个请求，无竞态问题
            const storyboards: StoryboardItem[] = safeJsonCopy<StoryboardItem[]>(targetRecord.storyboardData) || []

            // 查找匹配的索引
            let sbIdx = storyboards.findIndex((s: StoryboardItem) => String(s.id) === String(itemId) || String(s.sceneId) === String(itemId))

            // 如果没找到，尝试用数字索引
            if (sbIdx < 0) {
              const itemIdNum = parseInt(String(itemId), 10)
              if (!isNaN(itemIdNum) && itemIdNum >= 0 && itemIdNum < storyboards.length) {
                sbIdx = itemIdNum
              }
            }

            if (sbIdx >= 0 && sbIdx < storyboards.length) {
              storyboards[sbIdx] = { ...storyboards[sbIdx], imageUrl, url: imageUrl }
              newRecordIdForMigration = targetRecord.id
              storyboardsForMigration = [storyboards[sbIdx]]
              await db.update(projectData).set({ storyboardData: storyboards, updatedAt: new Date() }).where(eq(projectData.id, targetRecord.id))
              console.log(`[Webhook] 分镜图更新成功 ${itemId}:`, { sbIdx, imageUrl: imageUrl.substring(0, 50) + '...' })
            } else {
              console.warn(`[Webhook] 分镜图 ${itemId} 未匹配到任何记录，storyboards 长度: ${storyboards.length}`)
            }

            // 更新 videoProjects.currentStep
            await db.update(videoProjects)
              .set({ currentStep: 'storyboard', updatedAt: new Date() })
              .where(eq(videoProjects.id, projectId))
          } else if (taskType === 'generate_character' && !itemId) {
            // 无 itemId 时写入所有 characterData（兼容旧逻辑：主角可能不关联具体 ID）
            const characters: CharacterItem[] = safeJsonCopy<CharacterItem[]>(targetRecord.characterData) || []
            if (characters.length > 0) {
              // 尝试找到第一个没有 imageUrl 的主角写入
              const emptyCharIdx = characters.findIndex((c: CharacterItem) => !c.imageUrl)
              const writeIdx = emptyCharIdx >= 0 ? emptyCharIdx : 0
              characters[writeIdx] = { ...characters[writeIdx], imageUrl }
              newRecordIdForMigration = targetRecord.id
              // 只迁移当前刚生成的那一个主角，而不是整个数组
              charactersForMigration = [characters[writeIdx]]
              await db
                .update(projectData)
                .set({ characterData: characters, updatedAt: new Date() })
                .where(eq(projectData.id, targetRecord.id))
              console.log(`[Webhook] 主角(无itemId) imageUrl 已写入 projectData(v${targetRecord.version})[${writeIdx}]:`, { projectId, imageUrl })
              await db.update(videoProjects)
                .set({ currentStep: 'character', updatedAt: new Date() })
                .where(eq(videoProjects.id, projectId))
            }
          } else if (taskType === 'generate_storyboard' && !itemId) {
            // 无 itemId 时写入所有 storyboardData（兼容旧逻辑：分镜图可能不关联具体 ID）
            const storyboards: StoryboardItem[] = safeJsonCopy<StoryboardItem[]>(targetRecord.storyboardData) || []
            if (storyboards.length > 0) {
              const emptySbIdx = storyboards.findIndex((s: StoryboardItem) => !s.imageUrl)
              const writeIdx = emptySbIdx >= 0 ? emptySbIdx : 0
              storyboards[writeIdx] = { ...storyboards[writeIdx], imageUrl }
              newRecordIdForMigration = targetRecord.id
              // 只迁移当前刚生成的那一个分镜图，而不是整个数组
              storyboardsForMigration = [storyboards[writeIdx]]
              await db
                .update(projectData)
                .set({ storyboardData: storyboards, updatedAt: new Date() })
                .where(eq(projectData.id, targetRecord.id))
              console.log(`[Webhook] 分镜图(无itemId) imageUrl 已写入 projectData(v${targetRecord.version})[${writeIdx}]:`, { projectId, imageUrl })
              await db.update(videoProjects)
                .set({ currentStep: 'storyboard', updatedAt: new Date() })
                .where(eq(videoProjects.id, projectId))
            }
          } else if (taskType === 'generate_storyboard_frame' && itemId) {
            // 首尾帧模式：itemId 格式为 "1_first" 或 "1_last"
            // 直接将这个 itemId 作为独立分镜图写入（无竞态问题）
            const storyboards: StoryboardItem[] = safeJsonCopy<StoryboardItem[]>(targetRecord.storyboardData) || []

            // 查找是否已有相同 id 的记录
            const sbIdx = storyboards.findIndex((s: StoryboardItem) => String(s.id) === String(itemId))

            if (sbIdx >= 0) {
              // 已存在，更新 imageUrl
              storyboards[sbIdx] = { ...storyboards[sbIdx], imageUrl, url: imageUrl }
            } else {
              // 不存在，添加到数组
              // 从 itemId 提取场景索引（如 "1_first" -> 0）
              const baseIndex = parseInt(itemId.replace(/_first$|_last$/, '')) - 1
              const frameSuffix = itemId.includes('_first') ? '_first' : '_last'

              storyboards.push({
                id: itemId,
                sceneId: `scene_${baseIndex + 1}${frameSuffix}`,
                imageUrl: imageUrl,
                url: imageUrl,
                // 首尾帧模式的元数据
                isFrameOnly: true,
                frameType: itemId.includes('_first') ? 'first' : 'last',
                baseSceneIndex: baseIndex,
              })
            }

            newRecordIdForMigration = targetRecord.id
            storyboardsForMigration = storyboards.filter((s: StoryboardItem) => s.id === itemId)
            await db.update(projectData).set({ storyboardData: storyboards, updatedAt: new Date() }).where(eq(projectData.id, targetRecord.id))

            console.log(`[Webhook] 首尾帧 ${itemId} 已写入:`, { imageUrl: imageUrl.substring(0, 50) + '...' })

            // 更新 videoProjects.currentStep
            await db.update(videoProjects)
              .set({ currentStep: 'storyboard', updatedAt: new Date() })
              .where(eq(videoProjects.id, projectId))
          }
        } else {
          console.warn(`[Webhook] 未找到 projectData 记录: projectId=${projectId}, targetVersionId=${targetVersionId}`)
        }
      } catch (dbError) {
        console.error('[Webhook] 写入 projectData 失败:', dbError)
      }
    } else {
      console.warn(`[Webhook] 任务缺少 projectId 或 itemId，跳过直接写入: taskId=${taskId}`)
    }

    // 7.2 扣除积分（原子认领：并发重复回调只有一个赢家，杜绝双扣）
    console.log(`[Webhook] 积分检查: taskId=${taskId}, pointsDeducted=${pointsDeducted}, userId=${userId}`)
    if (!pointsDeducted) {
      const claimed = await claimTaskPointsDeduction(taskId)
      if (claimed) {
        try {
          let pointsAction: PointsAction
          if (taskType === 'generate_storyboard' || taskType === 'generate_storyboard_frame') {
            pointsAction = PointsAction.GENERATE_STORYBOARD
          } else {
            pointsAction = PointsAction.GENERATE_CHARACTER
          }

          const itemTypeLabel = taskType === 'generate_storyboard' ? '分镜图'
            : taskType === 'generate_storyboard_frame' ? '首尾帧图'
            : '主角'

          console.log(`[Webhook] 开始扣除积分: userId=${userId}, amount=${pointsAmount}, action=${pointsAction}`)
          await deductPoints(userId, pointsAmount, undefined, pointsAction)
          console.log(`[Webhook] 用户 ${userId} 成功生成${itemTypeLabel}，扣除 ${pointsAmount} 积分`)
        } catch (pointsError) {
          console.error('[Webhook] 扣除积分失败:', pointsError)
          await releaseTaskPointsClaim(taskId).catch((err) => {
            console.error('[Webhook] 释放积分认领失败:', err)
          })
        }
      } else {
        console.log(`[Webhook] 积分已被并发回调认领，跳过: taskId=${taskId}`)
      }
    } else {
      console.log(`[Webhook] 积分已扣除过，跳过: taskId=${taskId}`)
    }

    // 7.3 更新 aiGenerationTasks 状态（幂等）
    if (!pointsDeducted) {
      try {
        await markTaskSuccess(taskId)
      } catch (updateError) {
        console.error('[Webhook] 更新任务状态失败:', updateError)
      }
    }

    // 7. 通过 Pusher 推送到前端（前端用此刷新 UI）
    // 添加小延迟避免多个 webhook 同时推送导致 Pusher 丢失消息
    await new Promise(resolve => setTimeout(resolve, 100))
    console.log(`[Webhook] 开始 Pusher 推送: taskId=${taskId}, frameType=${frameType}`)
    const pusherSuccess = await notifyImageSuccess({
      taskId,
      imageUrl,
      resultUrls,
      characterId: taskType === 'generate_character' ? (itemId ?? undefined) : undefined,
      sceneId: taskType === 'generate_storyboard' || taskType === 'generate_storyboard_frame' ? (itemId?.replace(/_first$|_last$/, '') ?? undefined) : undefined,
      projectId: projectId ?? undefined,
      versionId: targetVersionId,
      version: newVersion,
      versionGroupId: versionGroupId ?? undefined,
      frameType: taskType === 'generate_storyboard_frame' ? (frameType ?? undefined) : undefined,
    })
    console.log(`[Webhook] Pusher 推送完成: taskId=${taskId}, success=${pusherSuccess}`)

    if (!pusherSuccess) {
      console.warn('[Pusher] 推送失败，但回调仍会返回成功:', { taskId })
    }

    // 7.4 异步触发搬运（等 Pusher 推送后再开始，前端先用第三方临时链接展示）
    console.log(`[Webhook] 检查是否触发迁移: newRecordIdForMigration=${!!newRecordIdForMigration}, imageUrl=${!!imageUrl}`)
    if (newRecordIdForMigration && imageUrl) {
      console.log(`[Webhook] 触发迁移: taskId=${taskId}, taskType=${taskType}`)
      if (taskType === 'generate_character') {
        triggerCharacterImageMigration(projectId!, newRecordIdForMigration, charactersForMigration || []).catch((err) => {
          console.error('[Webhook] 触发主角图片搬运失败:', err)
        })
      } else if (taskType === 'generate_storyboard' || taskType === 'generate_storyboard_frame') {
        triggerStoryboardImageMigration(projectId!, newRecordIdForMigration, storyboardsForMigration || []).catch((err) => {
          console.error('[Webhook] 触发分镜图搬运失败:', err)
        })
      }
    } else {
      console.log(`[Webhook] 不触发迁移: newRecordIdForMigration=${newRecordIdForMigration}, imageUrl=${imageUrl}`)
    }

    // 返回成功响应
    return NextResponse.json({
      status: 'received',
      taskId,
      imageUrl
    }, { status: 200 })

  } catch (error) {
    console.error('Kie.ai Webhook 处理错误:', error)
    return NextResponse.json({ status: 'received' }, { status: 200 })
  }
}
