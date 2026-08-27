import { schedules } from "@trigger.dev/sdk"
import { db } from "@/lib/db"
import { aiGenerationTasks } from "@/lib/schema"
import { and, eq, lt, asc } from "drizzle-orm"
import { deductPoints, PointsAction } from "@/lib/points"
import { claimTaskPointsDeduction, releaseTaskPointsClaim, markTaskSuccess } from "@/lib/task-points"
import { pollTask, isKnownTaskType } from "@/lib/providers"

/**
 * F10 漏回调补偿任务（系统设计 §3.2.M6.5 / 部署设计 §3.4.3）。
 * 供应商查询经 lib/providers 适配层（F2）归一，本任务只处理业务语义。
 *
 * 定时扫描 ai_generation_tasks 中超过阈值仍未达终态（status='pending'）的任务，
 * 主动查询供应商终态并对"已完成未扣费"补扣、对"已失败"关闭：
 *   - 供应商 success + 未扣分 → 原子认领后补扣（generate_final_video 的 pointsAmount
 *     存的是总时长，扣 0，与 webhook 逻辑一致）
 *   - 供应商 success + 已扣分 → 仅补状态
 *   - 供应商 fail → 标记 failed
 *   - 仍在处理 → 跳过；超过 ZOMBIE_HOURS 仍无法确认 → 标记 failed（僵尸任务清理）
 *
 * 范围边界：本任务只补偿计费终态，不重放 projectData 写入 / Pusher 推送 / 资产迁移
 * （完整重放需先把各 webhook 的处理逻辑抽取为共享服务，属后续项）。
 *
 * 定时配置（一次性）：Trigger.dev 控制台 → Schedules → 为任务
 * `compensate-missed-webhooks` 添加 cron（建议每 10 分钟一次），
 * 或用 SDK 的 schedules.create 以编程方式挂载。
 */

const STALE_MINUTES = 20 // 超过该时长未终态才进入补偿（webhook 正常送达窗口）
const ZOMBIE_HOURS = 24 // 超过该时长仍无法确认状态 → 判定失败
const BATCH_LIMIT = 50 // 单次运行处理上限，避免长事务

type ProviderVerdict = 'success' | 'fail' | 'processing' | 'unknown'

function pointsActionFor(taskType: string): PointsAction {
  if (taskType === 'generate_character') return PointsAction.GENERATE_CHARACTER
  if (taskType === 'generate_storyboard' || taskType === 'generate_storyboard_frame') {
    return PointsAction.GENERATE_STORYBOARD
  }
  if (taskType === 'generate_final_video') return PointsAction.GENERATE_FINAL_VIDEO
  return PointsAction.GENERATE_STORY_VIDEO
}

export const compensateMissedWebhooks = schedules.task({
  id: "compensate-missed-webhooks",
  // 每 10 分钟自动运行（scheduled task 部署即注册，无需控制台手动挂载）
  cron: "*/10 * * * *",
  run: async () => {
    const staleBefore = new Date(Date.now() - STALE_MINUTES * 60 * 1000)
    const zombieBefore = new Date(Date.now() - ZOMBIE_HOURS * 60 * 60 * 1000)

    const staleTasks = await db
      .select()
      .from(aiGenerationTasks)
      .where(and(
        eq(aiGenerationTasks.status, 'pending'),
        lt(aiGenerationTasks.createdAt, staleBefore),
      ))
      .orderBy(asc(aiGenerationTasks.createdAt))
      .limit(BATCH_LIMIT)

    const stats = {
      scanned: staleTasks.length,
      compensated: 0, // 补扣积分
      markedSuccess: 0, // 仅补状态
      markedFailed: 0,
      stillProcessing: 0,
      skipped: 0, // 未知 taskType / 查询失败
      errors: 0,
    }

    console.log(`[compensate-missed-webhooks] 扫描到 ${staleTasks.length} 条超时未终态任务（阈值 ${STALE_MINUTES}min）`)

    for (const t of staleTasks) {
      if (!isKnownTaskType(t.taskType)) {
        console.warn(`[compensate-missed-webhooks] 未知 taskType，跳过: ${t.taskType} (${t.taskId})`)
        stats.skipped++
        continue
      }

      let verdict: ProviderVerdict
      try {
        verdict = (await pollTask(t.taskType, t.taskId)).verdict
      } catch (err) {
        console.error(`[compensate-missed-webhooks] 查询失败: ${t.taskType} ${t.taskId}`, err)
        stats.errors++
        continue
      }

      // 僵尸任务：超长时限仍无终态 → 关闭，防止无限 pending（AL-04 告警口径）
      if (verdict === 'processing' || verdict === 'unknown') {
        if (t.createdAt && t.createdAt < zombieBefore) {
          await db.update(aiGenerationTasks)
            .set({ status: 'failed', updatedAt: new Date() })
            .where(eq(aiGenerationTasks.taskId, t.taskId))
          stats.markedFailed++
          console.warn(`[compensate-missed-webhooks] 僵尸任务关闭（>${ZOMBIE_HOURS}h 无终态）: ${t.taskId}`)
        } else {
          stats.stillProcessing++
        }
        continue
      }

      if (verdict === 'fail') {
        await db.update(aiGenerationTasks)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(aiGenerationTasks.taskId, t.taskId))
        stats.markedFailed++
        continue
      }

      // verdict === 'success'
      if (!t.pointsDeducted) {
        const claimed = await claimTaskPointsDeduction(t.taskId)
        if (!claimed) {
          // 已被并发流程（webhook 迟到/其他补偿实例）认领，只补状态
          await markTaskSuccess(t.taskId)
          stats.markedSuccess++
          continue
        }
        try {
          // generate_final_video 的 pointsAmount 存总时长，合成本身 0 积分
          const amount = t.taskType === 'generate_final_video' ? 0 : (t.pointsAmount ?? 0)
          if (amount > 0) {
            await deductPoints(t.userId, amount, undefined, pointsActionFor(t.taskType))
          }
          await markTaskSuccess(t.taskId)
          stats.compensated++
          console.log(`[compensate-missed-webhooks] 补扣完成: ${t.taskType} ${t.taskId} 扣 ${amount} 积分 (user=${t.userId})`)
        } catch (err) {
          console.error(`[compensate-missed-webhooks] 补扣失败，释放认领待下次重试: ${t.taskId}`, err)
          await releaseTaskPointsClaim(t.taskId).catch(() => {})
          stats.errors++
        }
      } else {
        await markTaskSuccess(t.taskId)
        stats.markedSuccess++
      }
    }

    console.log(`[compensate-missed-webhooks] 完成`, stats)
    return stats
  },
})
