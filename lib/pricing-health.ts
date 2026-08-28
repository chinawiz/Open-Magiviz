/**
 * 定价健康统计（纯函数，可测试）。
 *
 * 制度化对账（AGENTS.md 经验库「定价改动后必须复算毛利」的日常化）：
 * 从 ai_generation_tasks 按模型聚合任务状态与扣费，用 lib/video-pricing.ts 的
 * 成本依据折算预估 Kie 成本，输出各模型失败率与预估毛利，供 /api/admin/pricing-health 消费。
 *
 * 口径：
 * - 预估成本 = Σ(全部任务，含失败) 估算时长 × 成本单价；估算时长 = pointsAmount ÷ 单价。
 *   失败任务也计费（Kie 实测），成功时才向用户扣积分，因此损耗天然进入成本侧。
 * - 预估收入 = Σ(成功且已扣费任务的 pointsAmount) × 单点售价。
 * - 毛利率 = (收入 − 成本) ÷ 成本，用户规则要求 ≥ 1（即利润率 ≥100%）。
 */
import {
  IMAGE_COST_BASIS_USD,
  MODEL_COST_BASIS_USD_PER_SECOND,
  PRICING_FLOOR,
  computeImagePoints,
  getVideoUnitPoints,
} from './video-pricing'

export interface HealthTaskRow {
  model: string | null
  status: string
  pointsDeducted: boolean
  pointsAmount: number
}

export interface ModelHealth {
  model: string
  costVerified: boolean | null // null = 历史行无模型信息，无法折算成本
  total: number
  success: number
  failed: number
  pending: number
  successRate: number | null // success / (success + failed)
  failureLossMultiplier: number | null // total / success（底线公式假设 ≤1.7）
  pointsCharged: number
  estCostUsd: number | null
  estRevenueUsd: number
  estMarginRatio: number | null // (收入−成本)/成本
  warning: string | null
}

export interface PricingHealthReport {
  overall: {
    total: number
    successRate: number | null
    pointsCharged: number
    estCostUsd: number
    estRevenueUsd: number
    estMarginRatio: number | null
  }
  models: ModelHealth[]
}

function modelCostPerPointUsd(model: string): number | null {
  // 图片模型按张计费：成本/每点 = 单张成本 ÷ 单张扣点
  if (model === 'nanoBanana2') return IMAGE_COST_BASIS_USD.cost / computeImagePoints(1)
  const basis = MODEL_COST_BASIS_USD_PER_SECOND[model]
  if (!basis) return null
  return basis.cost / getVideoUnitPoints(model)
}

function modelCostVerified(model: string): boolean | null {
  if (model === 'nanoBanana2') return IMAGE_COST_BASIS_USD.verified
  return MODEL_COST_BASIS_USD_PER_SECOND[model]?.verified ?? null
}

export function computeModelHealth(rows: HealthTaskRow[]): PricingHealthReport {
  const groups = new Map<string, HealthTaskRow[]>()
  for (const row of rows) {
    const key = row.model ?? 'unknown'
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  const models: ModelHealth[] = []
  let totalAll = 0
  let successAll = 0
  let pointsChargedAll = 0
  let costAll = 0
  let costKnown = false

  for (const [model, bucket] of groups) {
    const success = bucket.filter((r) => r.status === 'success').length
    const failed = bucket.filter((r) => r.status === 'failed').length
    const pending = bucket.filter((r) => r.status !== 'success' && r.status !== 'failed').length
    const finished = success + failed
    const pointsCharged = bucket
      .filter((r) => r.status === 'success' && r.pointsDeducted)
      .reduce((acc, r) => acc + (r.pointsAmount || 0), 0)

    const costPerPoint = model === 'unknown' ? null : modelCostPerPointUsd(model)
    // 失败任务没有扣费记录但仍烧供应商成本，故用全部任务的 pointsAmount 折算时长
    const estCostUsd =
      costPerPoint === null ? null : bucket.reduce((acc, r) => acc + (r.pointsAmount || 0), 0) * costPerPoint
    const estRevenueUsd = pointsCharged * PRICING_FLOOR.POINT_USD

    const estMarginRatio =
      estCostUsd !== null && estCostUsd > 0 ? (estRevenueUsd - estCostUsd) / estCostUsd : null

    let warning: string | null = null
    const failureLoss = finished > 0 && success > 0 ? bucket.length / success : null
    if (failureLoss !== null && failureLoss > PRICING_FLOOR.FAILURE_LOSS) {
      warning = `失败损耗 ${failureLoss.toFixed(2)}× 超过底线假设 ${PRICING_FLOOR.FAILURE_LOSS}×，考虑换模型或上调底线倍率`
    }
    if (estMarginRatio !== null && estMarginRatio < 1) {
      warning = `${warning ? warning + '；' : ''}预估毛利 ${(estMarginRatio * 100).toFixed(0)}% 低于 100% 规则，须重订单价或校准成本`
    }
    if (costPerPoint !== null && modelCostVerified(model) === false) {
      warning = `${warning ? warning + '；' : ''}成本为估计值，待 Kie 账单校准`
    }

    models.push({
      model,
      costVerified: costPerPoint === null ? null : modelCostVerified(model),
      total: bucket.length,
      success,
      failed,
      pending,
      successRate: finished > 0 ? success / finished : null,
      failureLossMultiplier: failureLoss,
      pointsCharged,
      estCostUsd,
      estRevenueUsd,
      estMarginRatio,
      warning,
    })

    totalAll += bucket.length
    successAll += success
    pointsChargedAll += pointsCharged
    if (estCostUsd !== null) {
      costAll += estCostUsd
      costKnown = true
    }
  }

  models.sort((a, b) => b.total - a.total)

  return {
    overall: {
      total: totalAll,
      successRate: totalAll > 0 ? successAll / totalAll : null,
      pointsCharged: pointsChargedAll,
      estCostUsd: costAll,
      estRevenueUsd: pointsChargedAll * PRICING_FLOOR.POINT_USD,
      estMarginRatio: costKnown && costAll > 0 ? (pointsChargedAll * PRICING_FLOOR.POINT_USD - costAll) / costAll : null,
    },
    models,
  }
}
