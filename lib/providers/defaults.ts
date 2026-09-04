import type { KieQueryKind } from './kie'
import type { Capability, RouteEntry } from './types'

/**
 * 供应商适配层——纯静态配置（无 DB 依赖，可单测）。
 */

/** 静态默认路由（与 drizzle/0011 seed 一致；DB 不可用/为空时的兜底） */
export function getStaticDefaultRoutes(): Record<Capability, RouteEntry[]> {
  return {
    script: [{ provider: 'zenmux', modelKey: 'google/gemini-3-flash-preview', priority: 0 }],
    // 分镜剧情文本（ADR-0001 新增 capability；云端默认与路由表 script seed 同源）
    storyboard_text: [{ provider: 'zenmux', modelKey: 'google/gemini-3-flash-preview', priority: 0 }],
    image: [{ provider: 'kieai', modelKey: 'nano-banana-2', priority: 0 }],
    // video 的模型级选择（veo3_lite/seedance 等）由调用方经 lib/video-pricing 决定，
    // 路由表只决定供应商级 primary/降级
    video: [{ provider: 'kieai', modelKey: null, priority: 0 }],
    compose: [{ provider: 'fal', modelKey: null, priority: 0 }],
  }
}

// taskType → 供应商查询方式（与各生成路由实际提交的端点一一对应）
export const TASK_PROVIDER: Record<string, { provider: 'kieai' | 'fal'; queryKind?: KieQueryKind }> = {
  // 图片（generate-character-image / generate-storyboard-image）
  generate_character: { provider: 'kieai', queryKind: 'jobsRecordInfo' },
  generate_storyboard: { provider: 'kieai', queryKind: 'jobsRecordInfo' },
  generate_storyboard_frame: { provider: 'kieai', queryKind: 'jobsRecordInfo' },
  // Veo 系视频
  generate_story_video_veo: { provider: 'kieai', queryKind: 'veoRecordInfo' },
  veo_3_1_lite_video: { provider: 'kieai', queryKind: 'veoRecordInfo' },
  veo_3_1_quality_video: { provider: 'kieai', queryKind: 'veoRecordInfo' },
  // jobs/get 系视频
  seedance_2_5_video: { provider: 'kieai', queryKind: 'jobsGet' },
  seedance_2_0_video: { provider: 'kieai', queryKind: 'jobsGet' },
  seedance_2_0_fast_video: { provider: 'kieai', queryKind: 'jobsGet' },
  seedance_2_0_mini_video: { provider: 'kieai', queryKind: 'jobsGet' },
  kling_3_0_video: { provider: 'kieai', queryKind: 'jobsGet' },
  wan_2_7_video: { provider: 'kieai', queryKind: 'jobsGet' },
  happyhorse_video: { provider: 'kieai', queryKind: 'jobsGet' },
  gemini_omni_video: { provider: 'kieai', queryKind: 'jobsGet' },
  minimax_h3_video: { provider: 'kieai', queryKind: 'jobsGet' },
  // FAL 合成
  generate_final_video: { provider: 'fal' },
}

/** 该 taskType 是否已被适配层认识 */
export function isKnownTaskType(taskType: string): boolean {
  return taskType in TASK_PROVIDER
}

// ========== 视频模型级降级链（F2 基础降级）==========
// 供应商级降级由 provider_routes 路由表决定（当前仅 kieai 一家）；
// 模型级降级链是代码知识（受输入形态/时长约束），按单价与可用性排序。

/** 各主模型的降级顺序（候补按价格从低到高、优先同族） */
export const VIDEO_MODEL_FALLBACKS: Record<string, string[]> = {
  veo31Lite: ['veo31Fast', 'wan27', 'happyHorse'],
  veo31Fast: ['veo31Lite', 'wan27', 'happyHorse'],
  veo31Quality: ['veo31Fast', 'veo31Lite', 'wan27'],
  seedance25: ['seedance2', 'kling3', 'wan27'],
  seedance2: ['kling3', 'wan27', 'happyHorse'],
  seedance2Fast: ['seedance2', 'kling3', 'wan27'],
  seedance2Mini: ['seedance2Fast', 'seedance2', 'wan27'],
  kling3: ['wan27', 'happyHorse', 'seedance2'],
  wan27: ['happyHorse', 'kling3', 'seedance2'],
  happyHorse: ['wan27', 'kling3', 'seedance2'],
  geminiOmni: ['veo31Fast', 'wan27'],
  minimaxH3: ['seedance2', 'kling3', 'wan27'],
}

/** 仅 Veo 系支持纯文生视频；其余模型都要求 imageUrl（图生视频） */
const TEXT_ONLY_CAPABLE = new Set(['veo31Lite', 'veo31Fast', 'veo31Quality'])

/** 已知硬性时长约束（与各提交函数内部的校验一致） */
const MODEL_DURATION_CONSTRAINTS: Record<string, (sec: number) => boolean> = {
  geminiOmni: sec => [4, 6, 8, 10].includes(sec),
  minimaxH3: sec => sec >= 4 && sec <= 15,
}

/**
 * 生成含主模型在内的降级链（按序尝试）。
 * 依输入形态（是否有图）与时长约束过滤不可用候补；未知主模型返回仅含主模型。
 */
export function getVideoFallbackChain(
  primary: string,
  opts?: { hasImage?: boolean; durationSec?: number },
): string[] {
  const candidates = [primary, ...(VIDEO_MODEL_FALLBACKS[primary] || [])]
  const seen = new Set<string>()
  const chain: string[] = []
  for (const model of candidates) {
    if (seen.has(model)) continue
    seen.add(model)
    if (opts?.hasImage === false && !TEXT_ONLY_CAPABLE.has(model)) continue
    const constraint = MODEL_DURATION_CONSTRAINTS[model]
    if (constraint && opts?.durationSec != null && !constraint(opts.durationSec)) continue
    chain.push(model)
  }
  return chain.length > 0 ? chain : [primary]
}
