import { describe, it, expect } from 'vitest'
import {
  VIDEO_MODEL_UNIT_POINTS,
  MODEL_COST_BASIS_USD_PER_SECOND,
  IMAGE_UNIT_POINTS,
  IMAGE_COST_BASIS_USD,
  DEFAULT_VIDEO_UNIT_POINTS,
  PRICING_FLOOR,
  minUnitPoints,
  getVideoUnitPoints,
  computeVideoPoints,
  computeImagePoints,
  getStyleFallbackModel,
} from './video-pricing'

describe('getVideoUnitPoints', () => {
  it('返回已知模型的单价', () => {
    expect(getVideoUnitPoints('veo31Lite')).toBe(1.5)
    expect(getVideoUnitPoints('veo31Fast')).toBe(2)
    expect(getVideoUnitPoints('veo31Quality')).toBe(9)
    expect(getVideoUnitPoints('seedance25')).toBe(9)
    expect(getVideoUnitPoints('seedance2Mini')).toBe(1.5)
    expect(getVideoUnitPoints('seedance2')).toBe(3.5)
    expect(getVideoUnitPoints('minimaxH3')).toBe(2.5)
    expect(getVideoUnitPoints('kling3')).toBe(2.5)
    expect(getVideoUnitPoints('happyHorse')).toBe(2.5)
    expect(getVideoUnitPoints('wan27')).toBe(2)
    expect(getVideoUnitPoints('geminiOmni')).toBe(2.5)
  })

  it('未知模型回落默认单价', () => {
    expect(getVideoUnitPoints('unknown-model')).toBe(DEFAULT_VIDEO_UNIT_POINTS)
    expect(getVideoUnitPoints(null)).toBe(DEFAULT_VIDEO_UNIT_POINTS)
    expect(getVideoUnitPoints(undefined)).toBe(DEFAULT_VIDEO_UNIT_POINTS)
  })
})

describe('computeVideoPoints', () => {
  it('整数单价精确相乘', () => {
    expect(computeVideoPoints('veo31Fast', 8)).toBe(16)
    expect(computeVideoPoints('seedance25', 4)).toBe(36)
  })

  it('小数单价四舍五入（与历史 Math.round 行为一致）', () => {
    // 1.5 × 5 = 7.5 → 8
    expect(computeVideoPoints('veo31Lite', 5)).toBe(8)
    // 2.5 × 5 = 12.5 → 13
    expect(computeVideoPoints('minimaxH3', 5)).toBe(13)
    // 1.5 × 3 = 4.5 → 5
    expect(computeVideoPoints('seedance2Mini', 3)).toBe(5)
  })
})

describe('computeImagePoints', () => {
  it('单张 2 分、首尾帧两张合计 3 分（积分流水为整数）', () => {
    expect(computeImagePoints(1)).toBe(2)
    expect(computeImagePoints(2)).toBe(3)
  })
})

describe('getStyleFallbackModel', () => {
  it('风格回退路由与历史行为一致', () => {
    expect(getStyleFallbackModel('anime')).toBe('seedance2Fast')
    expect(getStyleFallbackModel('ads')).toBe('seedance2')
    expect(getStyleFallbackModel('hollywood')).toBe('veo31Fast')
    expect(getStyleFallbackModel('auto')).toBeNull()
    expect(getStyleFallbackModel(undefined)).toBeNull()
  })
})

describe('定价底线守卫（用户规则：利润率 ≥100%）', () => {
  it('每个已登记模型的单价 ≥ 成本底线 minUnitPoints(cost)', () => {
    for (const [model, basis] of Object.entries(MODEL_COST_BASIS_USD_PER_SECOND)) {
      expect(VIDEO_MODEL_UNIT_POINTS[model], `${model} 单价击穿底线`).toBeGreaterThanOrEqual(
        minUnitPoints(basis.cost)
      )
    }
  })

  it('成本表与单价表一一对应，不允许只改一边', () => {
    expect(Object.keys(MODEL_COST_BASIS_USD_PER_SECOND).sort()).toEqual(
      Object.keys(VIDEO_MODEL_UNIT_POINTS).sort()
    )
  })

  it('图片单价满足底线且按次取整为整数', () => {
    expect(IMAGE_UNIT_POINTS).toBeGreaterThanOrEqual(minUnitPoints(IMAGE_COST_BASIS_USD.cost))
    for (const frames of [1, 2, 3]) {
      expect(Number.isInteger(computeImagePoints(frames))).toBe(true)
    }
  })

  it('兜底单价覆盖的成本上限须 ≥ 表中最便宜模型的底线', () => {
    // 未知模型回落 DEFAULT：其隐含成本上限（DEFAULT × POINT_USD ÷ 各系数）
    // 不能低于单价表中最便宜模型的底线，否则漏登记的模型会击穿底线。
    const impliedMaxCost =
      (DEFAULT_VIDEO_UNIT_POINTS * PRICING_FLOOR.POINT_USD) /
      (PRICING_FLOOR.FAILURE_LOSS * PRICING_FLOOR.TARGET_PROFIT * PRICING_FLOOR.PAYMENT_BUFFER)
    const cheapestFloor = Math.min(
      ...Object.values(MODEL_COST_BASIS_USD_PER_SECOND).map((b) => minUnitPoints(b.cost))
    )
    expect(DEFAULT_VIDEO_UNIT_POINTS).toBeGreaterThanOrEqual(cheapestFloor)
    expect(impliedMaxCost).toBeGreaterThan(0)
  })
})
