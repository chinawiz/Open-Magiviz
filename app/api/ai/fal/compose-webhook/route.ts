import { NextRequest, NextResponse } from "next/server"

import { db } from '@/lib/db'
import { aiGenerationTasks, projectData, videoProjects } from '@/lib/schema'
import { deductPoints, PointsAction } from '@/lib/points'
import { eq, desc, sql } from 'drizzle-orm'
import { triggerFinalVideoMigration } from '@/trigger/migrate-assets'
import { pusherServer, notifyComposeSuccess, notifyTaskFail } from '@/lib/pusher'
import { resolveTargetVersion, clearVersionGroup } from '@/lib/versionMapper'
import { claimTaskPointsDeduction, releaseTaskPointsClaim, markTaskSuccess } from '@/lib/task-points'
import { verifyFalWebhookToken } from '@/lib/webhook-security'
import type { SceneVideoItem } from '@/lib/types'

// Webhook/轻量快速路径：显式声明函数时长上限（U-04，生产纪律 10s 红线）
export const maxDuration = 10

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
  } catch {
    return null
  }
}

/**
 * POST /api/ai/fal/compose-webhook
 *
 * FAL FFmpeg Compose API 回调处理
 *
 * FAL webhook 格式：
 * {
 *   "request_id": "abc123",
 *   "status": "OK" | "ERROR",
 *   "payload": {
 *     "video_url": "...",
 *     "thumbnail_url": "..."
 *   },
 *   "error"?: "..."
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // 回调 token 校验（生产环境 fail-closed；此前该端点完全无验证，可伪造回调注入任意视频 URL）
    const tokenRejection = verifyFalWebhookToken(request)
    if (tokenRejection) {
      return NextResponse.json({ error: tokenRejection.error }, { status: tokenRejection.status })
    }

    const body = await request.json()
    console.log('[FAL Compose Webhook] 收到回调:', JSON.stringify(body).substring(0, 300))

    const { request_id, status, payload, error } = body

    if (!request_id) {
      console.error('[FAL Compose Webhook] 缺少 request_id')
      return NextResponse.json({ error: 'Missing request_id' }, { status: 400 })
    }

    // 查询任务映射
    const taskRecord = await db
      .select()
      .from(aiGenerationTasks)
      .where(eq(aiGenerationTasks.taskId, request_id))
      .limit(1)

    if (taskRecord.length === 0) {
      console.warn(`[FAL Compose Webhook] 未找到任务映射记录: ${request_id}`)
      return NextResponse.json({ status: 'received' }, { status: 200 })
    }

    const task = taskRecord[0]
    const { projectId, userId, versionId: taskVersionId, versionGroupId } = task

    // 确定目标版本（支持重新生成创建新版本）
    // compose-webhook 处理完整视频合成，currentStep 为 final_video
    let targetVersionId: string
    let newVersion: number
    if (projectId) {
      try {
        const resolved = await resolveTargetVersion(projectId, versionGroupId, taskVersionId, 'final_video')
        targetVersionId = resolved.targetVersionId
        newVersion = resolved.newVersion
        console.log(`[FAL Compose Webhook] 确定目标版本: ${targetVersionId} (v${newVersion}), isNew=${resolved.isNewVersion}`)
      } catch (error) {
        console.error('[FAL Compose Webhook] 确定目标版本失败:', error)
        return NextResponse.json({ error: 'Failed to resolve version' }, { status: 500 })
      }
    } else {
      targetVersionId = taskVersionId || ''
      const [record] = await db.select().from(projectData).where(eq(projectData.id, targetVersionId)).limit(1)
      newVersion = record?.version ?? 1
    }

    // 失败处理
    if (status === 'ERROR' || error) {
      console.error('[FAL Compose Webhook] ❌ 合成失败:', { request_id, error })

      if (projectId) {
        try {
          let targetVersionId: string = taskVersionId || ''
          let targetRecord: { id: string; version: number } | null = null

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
              .where(eq(projectData.projectId, projectId))
              .orderBy(desc(projectData.version))
              .limit(1)
            targetRecord = record
            targetVersionId = record?.id || ''
          }

          if (targetRecord) {
            await db.update(projectData)
              .set({ finalVideoUrl: '', finalVideoThumbnail: '', updatedAt: new Date() })
              .where(eq(projectData.id, targetRecord.id))
            console.log(`[FAL Compose Webhook] 失败写入 projectData(v${targetRecord.version}): projectId=${projectId}`)
          }
        } catch (dbError) {
          console.error('[FAL Compose Webhook] 失败时写入 projectData 失败:', dbError)
        }
      }

      await db.update(aiGenerationTasks)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(aiGenerationTasks.taskId, request_id))

      // 通过 Pusher 推送失败事件到前端
      await notifyTaskFail({
        taskId: request_id,
        error: error || '视频合成失败',
      })

      return NextResponse.json({ status: 'received' }, { status: 200 })
    }

    // 成功处理
    const videoUrl: string = payload?.video_url || ''
    const thumbnailUrl: string = payload?.thumbnail_url || ''

    if (!videoUrl) {
      console.error('[FAL Compose Webhook] payload 缺少 video_url:', { request_id, payload })
      return NextResponse.json({ error: 'Missing video_url' }, { status: 400 })
    }

    console.log('[FAL Compose Webhook] ✅ 视频合成成功:', {
      request_id,
      videoUrl: videoUrl.substring(0, 80) + '...',
      thumbnailUrl: thumbnailUrl.substring(0, 80) + '...',
    })

    // 获取总时长和文件大小（供后续使用）
    const totalDuration = task.pointsAmount || null
    const fileSizeBytes = await getFileSize(videoUrl)
    const finalVideoSize = fileSizeBytes !== null ? `${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB` : null

    // 写入 projectData（通过 targetVersionId 精确定位版本）
    let newRecordIdForMigration: string | undefined
    if (projectId) {
      try {
        const [targetRecord] = await db
          .select()
          .from(projectData)
          .where(eq(projectData.id, targetVersionId))
          .limit(1)

        if (targetRecord) {
          newRecordIdForMigration = targetRecord.id
          await db.update(projectData)
            .set({ finalVideoUrl: videoUrl, finalVideoThumbnail: thumbnailUrl, finalVideoSize, finalVideoDuration: totalDuration, updatedAt: new Date() })
            .where(eq(projectData.id, targetRecord.id))
          console.log(`[FAL Compose Webhook] finalVideoUrl 已写入 projectData(v${targetRecord.version}):`, { projectId, finalVideoSize, finalVideoDuration: totalDuration })
          // 更新 videoProjects.currentStep, status, thumbnailUrl 和 completedAt
          await db.update(videoProjects)
            .set({ currentStep: 'final_video', status: 'completed', thumbnailUrl: thumbnailUrl || undefined, completedAt: new Date(), updatedAt: new Date() })
            .where(eq(videoProjects.id, projectId))
        } else {
          console.warn(`[FAL Compose Webhook] 未找到 projectData: targetVersionId=${targetVersionId}`)
        }
      } catch (dbError) {
        console.error('[FAL Compose Webhook] 写入 projectData 失败:', dbError)
      }
    }

    // 扣除积分（仅首次）
    // 注意：generate_final_video 任务的 pointsAmount 存储的是 totalDuration，不是积分
    // 所以扣除积分时使用 0
    if (!task.pointsDeducted) {
      const claimed = await claimTaskPointsDeduction(request_id)
      if (claimed) {
        try {
          await deductPoints(userId, 0, undefined, PointsAction.GENERATE_FINAL_VIDEO)
          await markTaskSuccess(request_id)
          console.log(`[FAL Compose Webhook] 用户 ${userId} 成功合成最终视频（总时长: ${task.pointsAmount || 0} 秒）`)
        } catch (pointsError) {
          console.error('[FAL Compose Webhook] 扣除积分失败:', pointsError)
          await releaseTaskPointsClaim(request_id).catch(() => {})
        }
      }
    }

    // 通过 Pusher 推送到前端（先推送，前端即可更新，后台继续搬运）
    const pusherSuccess = await notifyComposeSuccess({
      taskId: request_id,
      videoUrl,
      thumbnailUrl,
      duration: totalDuration || undefined,
      fileSize: finalVideoSize || undefined,
      projectId: projectId ?? undefined,
      versionId: targetVersionId,
      version: newVersion,
      versionGroupId: versionGroupId ?? undefined,
    })

    if (!pusherSuccess) {
      console.warn('[FAL Compose Webhook] Pusher 推送失败，但回调仍会返回成功:', { request_id })
    }

    // 清理版本组（所有步骤完成后）
    if (versionGroupId && projectId) {
      await clearVersionGroup(projectId, versionGroupId).catch((err) => {
        console.error('[FAL Compose Webhook] 清理版本组失败:', err)
      })
    }

    // 异步触发 R2 搬运（等 Pusher 推送后再开始，前端先用第三方临时链接展示）
    if (newRecordIdForMigration && projectId) {
      triggerFinalVideoMigration(projectId, newRecordIdForMigration, videoUrl || null, thumbnailUrl || null).catch((err) => {
        console.error('[FAL Compose Webhook] 触发最终视频搬运失败:', err)
      })
    }

    return NextResponse.json({ status: 'received', request_id }, { status: 200 })

  } catch (error) {
    console.error('[FAL Compose Webhook] 处理错误:', error)
    return NextResponse.json({ status: 'received' }, { status: 200 })
  }
}

/**
 * GET /api/ai/fal/compose-webhook
 *
 * 健康检查端点
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'FAL Compose Webhook',
    timestamp: new Date().toISOString()
  }, { status: 200 })
}
