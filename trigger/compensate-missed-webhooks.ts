import { schedules } from "@trigger.dev/sdk"
import { db } from "@/lib/db"
import { aiGenerationTasks } from "@/lib/schema"
import { and, eq, lt, asc } from "drizzle-orm"
import { settleStaleTask, zombieCutoff } from "@/lib/task-compensate"

/**
 * F10 漏回调补偿任务（系统设计 §3.2.M6.5 / 部署设计 §3.4.3）。
 * 结算语义的唯一实现在 lib/task-compensate.ts（管理后台 tasks 页手动补偿共用）。
 *
 * 定时扫描 ai_generation_tasks 中超过阈值仍未达终态（status='pending'）的任务，
 * 主动查询供应商终态并对"已完成未扣费"补扣、对"已失败"关闭。
 *
 * 定时配置：SDK scheduled task 部署即注册（每 10 分钟）。
 */

const STALE_MINUTES = 20 // 超过该时长未终态才进入补偿（webhook 正常送达窗口）
const BATCH_LIMIT = 50 // 单次运行处理上限，避免长事务

const RESULT_KEYS = [
  'compensated',
  'markedSuccess',
  'markedFailed',
  'stillProcessing',
  'skippedUnknown',
  'pollError',
  'settleError',
] as const

export const compensateMissedWebhooks = schedules.task({
  id: "compensate-missed-webhooks",
  // 每 10 分钟自动运行（scheduled task 部署即注册，无需控制台手动挂载）
  cron: "*/10 * * * *",
  run: async () => {
    const staleBefore = new Date(Date.now() - STALE_MINUTES * 60 * 1000)

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
      skippedUnknown: 0, // 未知 taskType
      pollError: 0, // 查询失败
      settleError: 0, // 补扣失败
    }

    console.log(`[compensate-missed-webhooks] 扫描到 ${staleTasks.length} 条超时未终态任务（阈值 ${STALE_MINUTES}min）`)

    for (const t of staleTasks) {
      const result = await settleStaleTask(t, zombieCutoff())
      if ((RESULT_KEYS as readonly string[]).includes(result)) {
        stats[result as (typeof RESULT_KEYS)[number]]++
      }
    }

    console.log(`[compensate-missed-webhooks] 完成`, stats)
    return stats
  },
})
