import { db } from './db'
import { aiGenerationTasks } from './schema'
import { and, eq } from 'drizzle-orm'

/**
 * 生成任务积分扣减的幂等认领（F10）。
 *
 * 此前 webhook 采用"读 pointsDeducted → 扣分 → 回写 true"的先查后改模式，
 * 供应商重复投递回调在并发窗口内会双扣。改为数据库条件更新原子认领：
 * 只有一个请求能把 pointsDeducted 从 false 置为 true，赢家负责扣分。
 */

/** 原子认领扣分权；返回 true 表示当前请求是首次处理，应执行扣分 */
export async function claimTaskPointsDeduction(taskId: string): Promise<boolean> {
  const rows = await db
    .update(aiGenerationTasks)
    .set({ pointsDeducted: true, updatedAt: new Date() })
    .where(and(
      eq(aiGenerationTasks.taskId, taskId),
      eq(aiGenerationTasks.pointsDeducted, false),
    ))
    .returning({ id: aiGenerationTasks.id })
  return rows.length > 0
}

/** 扣分失败时释放认领，允许后续回调/补偿任务重试 */
export async function releaseTaskPointsClaim(taskId: string): Promise<void> {
  await db
    .update(aiGenerationTasks)
    .set({ pointsDeducted: false, updatedAt: new Date() })
    .where(eq(aiGenerationTasks.taskId, taskId))
}

/** 标记任务成功（幂等，可重复调用） */
export async function markTaskSuccess(taskId: string): Promise<void> {
  await db
    .update(aiGenerationTasks)
    .set({ status: 'success', updatedAt: new Date() })
    .where(eq(aiGenerationTasks.taskId, taskId))
}
