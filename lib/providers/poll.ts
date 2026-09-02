import { pollKieTask } from './kie'
import { pollFalTask } from './fal'
import { TASK_PROVIDER } from './defaults'
import type { PollResult } from './types'

/**
 * 供应商适配层——轮询半边：按业务 taskType 查询供应商终态（归一化）。
 * 调用方（webhook 补偿任务、生成路由的兜底轮询）只认 taskType，
 * 不感知各供应商端点与响应形状差异。
 */

/** 按业务 taskType 轮询供应商任务终态（单次查询） */
export async function pollTask(taskType: string, taskId: string, timeoutMs = 15000): Promise<PollResult> {
  const target = TASK_PROVIDER[taskType]
  if (!target) return { verdict: 'unknown', resultUrls: [] }

  if (target.provider === 'fal') {
    return pollFalTask(taskId, timeoutMs)
  }
  return pollKieTask(target.queryKind!, taskId, timeoutMs)
}

/** 轮询直至终态；单次查询失败不中断，耗尽次数返回 unknown（调用方决定超时语义） */
export async function pollTaskUntilVerdict(
  taskType: string,
  taskId: string,
  opts: { maxAttempts?: number; intervalMs?: number; timeoutMs?: number } = {},
): Promise<PollResult> {
  const maxAttempts = opts.maxAttempts ?? 180
  const intervalMs = opts.intervalMs ?? 5000
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const r = await pollTask(taskType, taskId, opts.timeoutMs)
      if (r.verdict === 'success' || r.verdict === 'fail') return r
    } catch (err) {
      console.error('[providers/poll] 查询出错:', err)
    }
    if (attempt < maxAttempts - 1) await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  console.error('[providers/poll] 轮询超时:', { taskType, taskId })
  return { verdict: 'unknown', resultUrls: [] }
}
