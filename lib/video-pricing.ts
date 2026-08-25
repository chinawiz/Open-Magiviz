/**
 * 场景视频按秒计费单价的唯一事实源（F11 计费口径统一）。
 *
 * 此前单价只存在于 generate-story-video 路由的头部注释与散落各模型函数的
 * 内联三元表达式/魔法数字中（约 15 处），不可执行、不可测试、易漂移。
 * 所有视频积分计算必须引用本模块；调整价格只改这里，并跑 video-pricing.test.ts。
 */

/** 各模型每秒积分单价 */
export const VIDEO_MODEL_UNIT_POINTS: Record<string, number> = {
  veo31Lite: 1,
  veo31Fast: 2,
  veo31Quality: 3,
  seedance25: 9,
  seedance2Fast: 2,
  seedance2Mini: 1.5,
  seedance2: 3,
  kling3: 2,
  happyHorse: 2,
  wan27: 2,
  geminiOmni: 1,
  minimaxH3: 2.5,
}

/** 未知/新增模型的兜底单价（与历史行为一致） */
export const DEFAULT_VIDEO_UNIT_POINTS = 2

/** 获取模型每秒单价；未知模型回落默认值 */
export function getVideoUnitPoints(model: string | null | undefined): number {
  if (model && Object.prototype.hasOwnProperty.call(VIDEO_MODEL_UNIT_POINTS, model)) {
    return VIDEO_MODEL_UNIT_POINTS[model]
  }
  return DEFAULT_VIDEO_UNIT_POINTS
}

/** 计算一次视频生成的扣积分总额（四舍五入，与历史 Math.round 行为一致） */
export function computeVideoPoints(model: string | null | undefined, durationSeconds: number): number {
  return Math.round(durationSeconds * getVideoUnitPoints(model))
}

/**
 * videoModel 未指定（'auto'）时按 videoStyle 的回退路由。
 * 行为与 generate-story-video 历史实现一致：
 *   anime → seedance2Fast；ads → seedance2；其他非 auto 风格 → veo31Fast；
 *   auto/未传 → veo31Fast（由调用方默认）。
 */
export function getStyleFallbackModel(videoStyle?: string | null): string | null {
  if (videoStyle === 'anime') return 'seedance2Fast'
  if (videoStyle === 'ads') return 'seedance2'
  if (videoStyle && videoStyle !== 'auto') return 'veo31Fast'
  return null
}
