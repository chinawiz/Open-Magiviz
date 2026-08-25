/**
 * 订阅计划配额唯一事实源（F11 计费口径统一）。
 *
 * 此前配额散落三处且互相矛盾：
 * - lib/stripe.ts 展示文案：Trial 10MB/1GB、Pro 20MB/10GB、Annual 50MB/150GB
 * - app/api/upload/route.ts 执行值：Trial 50GB、Pro 100GB、Annual 无限（存储）
 * - components/operate/format.ts 前端限制：Trial 50MB、Pro 100MB、Annual 500MB（单文件）
 *
 * 裁决：以实际执行口径为准（upload 路由 + format.ts + README 对外宣称一致），
 * 展示文案向执行值对齐。所有配额判断必须引用本模块，禁止再各处硬编码。
 *
 * 值语义：存储/文件大小上限字节数；-1 表示无限制。
 */

export type PlanKey = 'free' | 'trial' | 'pro' | 'annual'

const GB = 1024 * 1024 * 1024
const MB = 1024 * 1024

/** 各计划素材库存储总配额（字节，-1 无限制） */
export const PLAN_STORAGE_LIMITS: Record<PlanKey, number> = {
  free: 1 * GB,
  trial: 50 * GB,
  pro: 100 * GB,
  annual: -1,
}

/** 各计划单文件上传大小上限（字节） */
export const PLAN_FILE_SIZE_LIMITS: Record<PlanKey, number> = {
  free: 10 * MB,
  trial: 50 * MB,
  pro: 100 * MB,
  annual: 500 * MB,
}

function normalizePlan(plan: string | null | undefined): PlanKey {
  if (plan === 'trial' || plan === 'pro' || plan === 'annual') {
    return plan
  }
  return 'free'
}

/** 存储总配额（字节，-1 无限制）；未知/未登录计划回落 free */
export function getStorageLimit(plan: string | null | undefined): number {
  return PLAN_STORAGE_LIMITS[normalizePlan(plan)]
}

/** 单文件上传上限（字节）；未知/未登录计划回落 free */
export function getFileSizeLimit(plan: string | null | undefined): number {
  return PLAN_FILE_SIZE_LIMITS[normalizePlan(plan)]
}
