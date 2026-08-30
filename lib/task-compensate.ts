import { db } from "@/lib/db"
import { aiGenerationTasks } from "@/lib/schema"
import { eq } from "drizzle-orm"
import { deductPoints, PointsAction } from "@/lib/points"
import { claimTaskPointsDeduction, releaseTaskPointsClaim, markTaskSuccess } from "@/lib/task-points"
import { pollTask, isKnownTaskType } from "@/lib/providers"

/**
 * 补偿结算语义的唯一实现（docs/admin-plan.md tasks 页 + F10 漏回调补偿共用）。
 * 对单条 pending 任务主动查询供应商终态并对"已完成未扣费"补扣、对"已失败"关闭：
 *   - 供应商 success + 未扣分 → 原子认领后补扣（generate_final_video 的 pointsAmount
 *     存的是总时长，扣 0，与 webhook 逻辑一致）
 *   - 供应商 success + 已扣分 → 仅补状态
 *   - 供应商 fail → 标记 failed
 *   - 仍在处理 → 跳过；超过 zombieBefore 仍无法确认 → 标记 failed（僵尸任务清理）
 *
 * 范围边界：只补偿计费终态，不重放 projectData 写入 / Pusher 推送 / 资产迁移。
 */

const ZOMBIE_HOURS = 24 // 超过该时长仍无法确认状态 → 判定失败

export type SettleResult =
  | 'compensated'      // 补扣积分完成
  | 'markedSuccess'    // 仅补状态为 success
  | 'markedFailed'     // 供应商失败/僵尸关闭
  | 'stillProcessing'  // 供应商仍在处理，跳过
  | 'skippedUnknown'   // 未知 taskType，跳过
  | 'pollError'        // 查询供应商失败
  | 'settleError'      // 补扣/写库失败（已释放认领，待重试）

export function zombieCutoff(now = new Date()): Date {
  return new Date(now.getTime() - ZOMBIE_HOURS * 60 * 60 * 1000)
}

function pointsActionFor(taskType: string): PointsAction {
  if (taskType === 'generate_character') return PointsAction.GENERATE_CHARACTER
  if (taskType === 'generate_storyboard' || taskType === 'generate_storyboard_frame') {
    return PointsAction.GENERATE_STORYBOARD
  }
  if (taskType === 'generate_final_video') return PointsAction.GENERATE_FINAL_VIDEO
  return PointsAction.GENERATE_STORY_VIDEO
}

export async function settleStaleTask(
  t: typeof aiGenerationTasks.$inferSelect,
  cutoff: Date = zombieCutoff()
): Promise<SettleResult> {
  if (!isKnownTaskType(t.taskType)) {
    console.warn(`[task-compensate] 未知 taskType，跳过: ${t.taskType} (${t.taskId})`)
    return 'skippedUnknown'
  }

  let verdict: string
  try {
    verdict = (await pollTask(t.taskType, t.taskId)).verdict
  } catch (err) {
    console.error(`[task-compensate] 查询失败: ${t.taskType} ${t.taskId}`, err)
    return 'pollError'
  }

  // 僵尸任务：超长时限仍无终态 → 关闭，防止无限 pending（AL-04 告警口径）
  if (verdict === 'processing' || verdict === 'unknown') {
    if (t.createdAt && t.createdAt < cutoff) {
      await db.update(aiGenerationTasks)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(aiGenerationTasks.taskId, t.taskId))
      console.warn(`[task-compensate] 僵尸任务关闭（>${ZOMBIE_HOURS}h 无终态）: ${t.taskId}`)
      return 'markedFailed'
    }
    return 'stillProcessing'
  }

  if (verdict === 'fail') {
    await db.update(aiGenerationTasks)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(aiGenerationTasks.taskId, t.taskId))
    return 'markedFailed'
  }

  // verdict === 'success'
  if (!t.pointsDeducted) {
    const claimed = await claimTaskPointsDeduction(t.taskId)
    if (!claimed) {
      // 已被并发流程（webhook 迟到/其他补偿实例）认领，只补状态
      await markTaskSuccess(t.taskId)
      return 'markedSuccess'
    }
    try {
      // generate_final_video 的 pointsAmount 存总时长，合成本身 0 积分
      const amount = t.taskType === 'generate_final_video' ? 0 : (t.pointsAmount ?? 0)
      if (amount > 0) {
        await deductPoints(t.userId, amount, undefined, pointsActionFor(t.taskType))
      }
      await markTaskSuccess(t.taskId)
      console.log(`[task-compensate] 补扣完成: ${t.taskType} ${t.taskId} 扣 ${amount} 积分 (user=${t.userId})`)
      return 'compensated'
    } catch (err) {
      console.error(`[task-compensate] 补扣失败，释放认领待下次重试: ${t.taskId}`, err)
      await releaseTaskPointsClaim(t.taskId).catch(() => {})
      return 'settleError'
    }
  }

  await markTaskSuccess(t.taskId)
  return 'markedSuccess'
}
