import { pollKieTask } from './kie'
import { pollFalTask } from './fal'
import { TASK_PROVIDER } from './defaults'
import type { PollResult } from './types'

/**
 * 供应商适配层统一入口。
 *
 * pollTask：按业务 taskType 轮询供应商终态（归一化）。
 * 调用方（webhook 补偿任务、后续的统一生成入口）只认 taskType，
 * 不感知各供应商端点与响应形状差异。
 */

/** 按业务 taskType 轮询供应商任务终态（归一化） */
export async function pollTask(taskType: string, taskId: string, timeoutMs = 15000): Promise<PollResult> {
  const target = TASK_PROVIDER[taskType]
  if (!target) return { verdict: 'unknown', resultUrls: [] }

  if (target.provider === 'fal') {
    return pollFalTask(taskId, timeoutMs)
  }
  return pollKieTask(target.queryKind!, taskId, timeoutMs)
}

export { isKnownTaskType } from './defaults'
export { resolveRoutes, invalidateRouteCache } from './router'
export type { Capability, ProviderId, RouteEntry, PollResult, TaskVerdict } from './types'
