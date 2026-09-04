/**
 * F2/M2 AI 供应商适配层——类型定义。
 *
 * 设计原则（承接系统设计 §3.2.M2 与 2026-08-24 修正）：
 * - 进程内模块边界，不暴露 /internal HTTP 端点；
 * - capability：script（剧本）/ storyboard_text（分镜剧情文本）/ image / video / compose；
 *   storyboard_text 为自建接入（ADR-0001）新增的文本细分——剧本与分镜可指向不同自建端点；
 * - 供应商侧差异（端点、响应形状）收敛在 provider 实现内，调用方只认
 *   capability / taskType / 归一化的 PollResult。
 */

export type Capability = 'script' | 'storyboard_text' | 'image' | 'video' | 'compose'

export type ProviderId = 'kieai' | 'zenmux' | 'fal' | 'local'

/** 供应商任务终态（归一化，与补偿任务的 ProviderVerdict 一致） */
export type TaskVerdict = 'success' | 'fail' | 'processing' | 'unknown'

/** 路由表条目：一个 capability 的候选供应商（按 priority 升序 = 降级顺序） */
export interface RouteEntry {
  provider: ProviderId
  modelKey: string | null
  priority: number
}

/** 轮询供应商任务的归一化结果 */
export interface PollResult {
  verdict: TaskVerdict
  resultUrls: string[]
}
