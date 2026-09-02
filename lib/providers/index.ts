/**
 * 供应商适配层统一入口。
 *
 * submitTask：按 modelKey 提交生成任务并落 claim 行（见 ./submit）。
 * pollTask / pollTaskUntilVerdict：按业务 taskType 轮询供应商终态（见 ./poll）。
 * 调用方只认 modelKey / taskType，不感知各供应商端点与响应形状差异。
 */

export { isKnownTaskType } from './defaults'
export { resolveRoutes, invalidateRouteCache } from './router'
export { pollTask, pollTaskUntilVerdict } from './poll'
export { submitTask, resolveBillableSeconds, videoModelLabel } from './submit'
export type { SubmitInput, SubmitMeta, SubmitOutcome } from './submit'
export type { Capability, ProviderId, RouteEntry, PollResult, TaskVerdict } from './types'
