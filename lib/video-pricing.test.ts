import { describe, it, expect } from 'vitest'
import {
  VIDEO_MODEL_UNIT_POINTS,
  DEFAULT_VIDEO_UNIT_POINTS,
  getVideoUnitPoints,
  computeVideoPoints,
  getStyleFallbackModel,
} from './video-pricing'

describe('getVideoUnitPoints', () => {
  it('返回已知模型的单价', () => {
    expect(getVideoUnitPoints('veo31Lite')).toBe(1)
    expect(getVideoUnitPoints('veo31Fast')).toBe(2)
    expect(getVideoUnitPoints('veo31Quality')).toBe(3)
    expect(getVideoUnitPoints('seedance25')).toBe(9)
    expect(getVideoUnitPoints('seedance2Mini')).toBe(1.5)
    expect(getVideoUnitPoints('seedance2')).toBe(3)
    expect(getVideoUnitPoints('minimaxH3')).toBe(2.5)
    expect(getVideoUnitPoints('kling3')).toBe(2)
    expect(getVideoUnitPoints('happyHorse')).toBe(2)
    expect(getVideoUnitPoints('wan27')).toBe(2)
    expect(getVideoUnitPoints('geminiOmni')).toBe(1)
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
    expect(computeVideoPoints('seedance2Mini', 5)).toBe(8)
    // 2.5 × 5 = 12.5 → 13
    expect(computeVideoPoints('minimaxH3', 5)).toBe(13)
    // 1.5 × 3 = 4.5 → 5
    expect(computeVideoPoints('seedance2Mini', 3)).toBe(5)
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

describe('单价表完整性', () => {
  it('所有单价为正数', () => {
    for (const price of Object.values(VIDEO_MODEL_UNIT_POINTS)) {
      expect(price).toBeGreaterThan(0)
    }
  })
})
