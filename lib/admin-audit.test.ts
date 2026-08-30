import { describe, it, expect } from 'vitest'
import { sanitizeAuditSnapshot } from '@/lib/admin-audit'

// 审计快照脱敏守卫（docs/admin-plan.md 制度②）：
// 敏感列绝不进审计账本——审计表本身只允许白名单业务字段进 before/after。
describe('sanitizeAuditSnapshot', () => {
  it('剥离 password / resetToken / cardFingerprint 等敏感键', () => {
    const input = {
      points: 100,
      password: '$2a$10$secret',
      resetToken: 'tok_abc',
      cardFingerprint: 'fp_xyz',
      stripeCustomerId: 'cus_123',
      passwordHash: 'hash',
    }
    expect(sanitizeAuditSnapshot(input)).toEqual({ points: 100 })
  })

  it('保留普通业务字段', () => {
    const input = {
      points: 50,
      purchasedPoints: 30,
      giftedPoints: 20,
      role: 'admin',
      bannedReason: '同 IP 批量注册',
      signupIp: '1.2.3.4',
    }
    expect(sanitizeAuditSnapshot(input)).toEqual(input)
  })

  it('null / undefined 返回 null', () => {
    expect(sanitizeAuditSnapshot(null)).toBeNull()
    expect(sanitizeAuditSnapshot(undefined)).toBeNull()
  })

  it('空对象返回空对象', () => {
    expect(sanitizeAuditSnapshot({})).toEqual({})
  })
})
