import { adminAuditLogs } from '@/lib/schema'
import { v4 as uuidv4 } from 'uuid'

/**
 * 管理后台写操作审计（docs/admin-plan.md 制度②）。
 *
 * fail-closed 用法（neon-http 驱动不支持事务，靠调用顺序保证）：
 *   1. 先 await recordAdminAudit(...) —— 抛错则中止，业务写不发生
 *   2. 再执行业务写
 * before/after 只放白名单业务字段；SENSITIVE_KEYS 一律剥离，
 * 防止把 password 哈希 / resetToken / 卡指纹写进审计账本。
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'resetToken',
  'cardFingerprint',
  'stripeCustomerId',
])

export function sanitizeAuditSnapshot(
  snapshot: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!snapshot) return null
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(snapshot)) {
    if (!SENSITIVE_KEYS.has(key)) {
      clean[key] = value
    }
  }
  return clean
}

export type AdminAuditInput = {
  adminUserId: string
  action: string
  targetType: 'user' | 'task' | 'withdrawal'
  targetId: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  ip?: string | null
}

/** 审计先行：插入失败会抛出，调用方必须捕获并中止业务写 */
export async function recordAdminAudit(input: AdminAuditInput): Promise<void> {
  // db 走动态导入：lib/db 在模块顶层读取 DATABASE_URL，静态引入会让纯函数测试环境炸掉
  const { db } = await import('@/lib/db')
  await db.insert(adminAuditLogs).values({
    id: uuidv4(),
    adminUserId: input.adminUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    before: sanitizeAuditSnapshot(input.before),
    after: sanitizeAuditSnapshot(input.after),
    ip: input.ip ?? null,
    createdAt: new Date(),
  })
}
