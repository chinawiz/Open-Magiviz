import { describe, it, expect } from 'vitest'
import { computeModelHealth, type HealthTaskRow } from './pricing-health'

function row(partial: Partial<HealthTaskRow>): HealthTaskRow {
  return {
    model: 'veo31Fast',
    status: 'success',
    pointsDeducted: true,
    pointsAmount: 16, // 8s × 2分/秒
    ...partial,
  }
}

describe('computeModelHealth', () => {
  it('正常损耗：Fast 8/10 成功，毛利 220%，无成本/毛利告警', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ status: i < 8 ? 'success' : 'failed', pointsDeducted: i < 8 })
    )
    const { models, overall } = computeModelHealth(rows)

    expect(models).toHaveLength(1)
    const m = models[0]
    expect(m.model).toBe('veo31Fast')
    expect(m.successRate).toBe(0.8)
    expect(m.failureLossMultiplier).toBeCloseTo(1.25)
    // 成本 = 10 任务 × 16分 ÷ 2分/秒 × $0.05/s = $4.00（失败任务也烧钱）
    expect(m.estCostUsd).toBeCloseTo(4.0)
    // 收入 = 8 成功 × 16分 × $0.10 = $12.80
    expect(m.estRevenueUsd).toBeCloseTo(12.8)
    expect(m.estMarginRatio).toBeCloseTo(2.2)
    expect(overall.estMarginRatio).toBeCloseTo(2.2)
    expect(m.warning).toContain('成本为估计值')
    expect(m.warning).not.toContain('失败损耗')
    expect(m.warning).not.toContain('预估毛利')
  })

  it('失败率超红线：3/10 成功触发失败损耗告警', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ model: 'veo31Quality', pointsAmount: 72, status: i < 3 ? 'success' : 'failed', pointsDeducted: i < 3 })
    )
    const { models } = computeModelHealth(rows)
    expect(models[0].failureLossMultiplier).toBeCloseTo(10 / 3)
    expect(models[0].warning).toContain('失败损耗')
  })

  it('毛利不足 100% 触发告警', () => {
    // wan27：10 任务只成功 2 个 → 成本 $25、收入 $20 → 毛利率 -20%
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ model: 'wan27', pointsAmount: 100, status: i < 2 ? 'success' : 'failed', pointsDeducted: i < 2 })
    )
    const { models } = computeModelHealth(rows)
    expect(models[0].estMarginRatio).toBeCloseTo(-0.2)
    expect(models[0].warning).toContain('预估毛利')
  })

  it('历史行（无 model）归入 unknown：只计收入不计成本', () => {
    const rows = [row({ model: null, pointsAmount: 20 })]
    const { models, overall } = computeModelHealth(rows)
    expect(models[0].model).toBe('unknown')
    expect(models[0].costVerified).toBeNull()
    expect(models[0].estCostUsd).toBeNull()
    expect(models[0].estMarginRatio).toBeNull()
    expect(models[0].estRevenueUsd).toBeCloseTo(2.0)
    expect(overall.estMarginRatio).toBeNull()
  })

  it('图片模型 nanoBanana2 按张折算成本且不触发估计值告警', () => {
    const rows = [row({ model: 'nanoBanana2', pointsAmount: 2 }), row({ model: 'nanoBanana2', pointsAmount: 2 })]
    const { models } = computeModelHealth(rows)
    const m = models[0]
    expect(m.costVerified).toBe(true)
    // 成本 = 4分 ÷ 2分/张 × $0.04 = $0.08；收入 = 4分 × $0.10 = $0.40
    expect(m.estCostUsd).toBeCloseTo(0.08)
    expect(m.estRevenueUsd).toBeCloseTo(0.4)
    expect(m.estMarginRatio).toBeCloseTo(4.0)
    expect(m.warning).toBeNull()
  })

  it('多模型混排按任务量降序排列', () => {
    const rows = [row({ model: 'veo31Fast' }), row({ model: 'kling3', pointsAmount: 20 }), row({ model: 'kling3', pointsAmount: 20 })]
    const { models } = computeModelHealth(rows)
    expect(models.map((m) => m.model)).toEqual(['kling3', 'veo31Fast'])
  })
})
