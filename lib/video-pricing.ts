/**
 * AI 生成积分单价的唯一事实源（F11 计费口径统一）。
 *
 * 此前单价只存在于 generate-story-video 路由的头部注释与散落各模型函数的
 * 内联三元表达式/魔法数字中（约 15 处），不可执行、不可测试、易漂移。
 * 所有视频/图片积分计算必须引用本模块；调整价格只改这里，并跑 video-pricing.test.ts。
 *
 * 定价底线（2026-08-28 起，用户规则：利润率 ≥100%）：
 *   unit ≥ ceil0.5( cost_per_second × 3.5 / 0.10 )
 *   3.5 = 失败损耗倍率 1.7（Kie 失败任务也计费、实测 ~40% 损耗，我方仅在成功时向
 *   用户扣费）× 目标利润 2×（利润率 100%）× 支付费缓冲 1.04。
 *   成本依据分两档：calibrated = Kie 账单实测；estimated = 官方/市场价上限估计，
 *   实测后应回填并允许下调售价。接入新模型必须先登记成本，再在表中定价。
 */

/**
 * 各模型成本依据（$/秒）。
 * verified: true  = Kie 账单实测校准；false = 官方/市场价上限估计，实测后回填。
 * video-pricing.test.ts 据此守卫定价底线；改价必须先改这里并注明依据。
 */
export const MODEL_COST_BASIS_USD_PER_SECOND: Record<string, { cost: number; verified: boolean; source: string }> = {
  veo31Lite: { cost: 0.0375, verified: true, source: 'Kie 账单实测：veo-3-1 按次 30cr/4s（2026-08-27）；8s 档待实测' },
  veo31Fast: { cost: 0.05, verified: false, source: 'Kie 官方定价页：$0.4/条 Fast' },
  veo31Quality: { cost: 0.25, verified: false, source: 'Kie 官方定价页：$2/条 Quality' },
  seedance25: { cost: 0.23, verified: false, source: '市场价上限 $0.13–0.23/s，实测后可下调售价' },
  seedance2Fast: { cost: 0.05, verified: false, source: 'Seedance 2.x 价格梯 $0.04–0.353/s fast 档' },
  seedance2Mini: { cost: 0.04, verified: false, source: 'Seedance 2.x 价格梯 mini 档' },
  seedance2: { cost: 0.09, verified: false, source: 'Seedance 2.x 价格梯标准档上沿' },
  kling3: { cost: 0.06, verified: false, source: '市场价估计，未验证' },
  happyHorse: { cost: 0.06, verified: false, source: '完全未验证' },
  wan27: { cost: 0.05, verified: false, source: '开源档，市场 ~$0.03–0.05/s' },
  geminiOmni: { cost: 0.06, verified: false, source: '完全未验证；Gemini 系不宜按 1 分/秒定价' },
  minimaxH3: { cost: 0.07, verified: false, source: '官方 $6/min，Kie 3–5 折 → $0.03–0.07/s' },
}

/** 图片单张成本依据：nano-banana-2，Kie 账单实测 8cr = $0.040/张（2026-08-27） */
export const IMAGE_COST_BASIS_USD = { cost: 0.04, verified: true, source: 'Kie 账单实测 8cr/张' }

/** 定价底线参数：unit_min = ceil0.5( cost × FAILURE_LOSS × TARGET_PROFIT × PAYMENT_BUFFER ÷ POINT_USD ) */
export const PRICING_FLOOR = {
  FAILURE_LOSS: 1.7, // Kie 失败任务也计费，实测 ~40% 损耗；我方仅成功时扣用户积分
  TARGET_PROFIT: 2, // 利润率 ≥100%（售价 ≥ 2× 含损耗成本）
  PAYMENT_BUFFER: 1.04, // 支付通道费缓冲
  POINT_USD: 0.10, // 积分包单点售价
} as const

/** 按成本算出最低允许单价（0.5 步进向上取整） */
export function minUnitPoints(costPerSecondUsd: number): number {
  const raw =
    (costPerSecondUsd * PRICING_FLOOR.FAILURE_LOSS * PRICING_FLOOR.TARGET_PROFIT * PRICING_FLOOR.PAYMENT_BUFFER) /
    PRICING_FLOOR.POINT_USD
  return Math.ceil(raw * 2) / 2
}

/**
 * 各模型每秒积分单价（由 MODEL_COST_BASIS_USD_PER_SECOND 按底线公式导出，见下）。
 */
export const VIDEO_MODEL_UNIT_POINTS: Record<string, number> = {
  veo31Lite: 1.5,
  veo31Fast: 2,
  veo31Quality: 9,
  seedance25: 9,
  seedance2Fast: 2,
  seedance2Mini: 1.5,
  seedance2: 3.5,
  kling3: 2.5,
  happyHorse: 2.5,
  wan27: 2,
  geminiOmni: 2.5,
  minimaxH3: 2.5,
}

/**
 * 图片积分：nano-banana-2 校准成本 $0.040/张 → 底线 1.5 分/张。
 * 积分流水为整数字段，故按次取整：单张 2 分，首尾帧两张合计 3 分。
 */
export const IMAGE_UNIT_POINTS = 1.5

/** 未知/新增模型的兜底单价（与历史行为一致）。仅覆盖成本 ≤ $0.056/s 的档位——
 *  接入更贵的新模型前必须先在 VIDEO_MODEL_UNIT_POINTS 显式登记，否则会击穿底线。 */
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

/** 计算图片生成扣积分（frames 张，按次取整：单张 2 分、两张 3 分） */
export function computeImagePoints(frames: number): number {
  return Math.round(frames * IMAGE_UNIT_POINTS)
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
