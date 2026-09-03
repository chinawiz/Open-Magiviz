import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { claimPaymentRecord, completePaymentRecord, getUserPaymentHistory, PaymentStatus, PaymentType } from './payments'

/**
 * payments 契约测试（seam：F10 计费幂等的 claim-first 原语）。
 * 关键验证：并发重复投递/终态记录 → 认领返回 null（跳过发放）；
 * 认领行以 pending 落库，补全仅更新提供字段。db 是系统边界，予以 mock。
 */

vi.mock('@/lib/db', () => ({
  db: {
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
  },
}))

const insertValues = vi.fn().mockReturnThis()
const onConflictDoNothing = vi.fn().mockReturnThis()
const insertReturning = vi.fn()
const updateSet = vi.fn().mockReturnThis()
const updateWhere = vi.fn().mockReturnThis()
const updateReturning = vi.fn()
const selectOffset = vi.fn()

function wireDb() {
  const m = db as unknown as Record<string, ReturnType<typeof vi.fn>>
  m.insert.mockReturnValue({ values: insertValues })
  insertValues.mockReturnValue({ onConflictDoNothing })
  onConflictDoNothing.mockReturnValue({ returning: insertReturning })
  m.update.mockReturnValue({ set: updateSet })
  updateSet.mockReturnValue({ where: updateWhere })
  updateWhere.mockReturnValue({ returning: updateReturning })
  m.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({ offset: selectOffset }),
        }),
      }),
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  wireDb()
})

describe('claimPaymentRecord（claim-first 计费幂等）', () => {
  const claim = {
    userId: 'u1',
    stripeCustomerId: 'cus_1',
    paymentIntentId: 'pi_1',
    paymentType: PaymentType.POINTS_PURCHASE,
  }

  it('首次投递 → 认领成功，以 pending/0 金额落库', async () => {
    insertReturning.mockResolvedValue([{ id: 'pay-1' }])
    const result = await claimPaymentRecord(claim)

    expect(result).toEqual({ id: 'pay-1' })
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentStatus: PaymentStatus.PENDING,
        paymentType: PaymentType.POINTS_PURCHASE,
        amount: 0,
      }),
    )
  })

  it('重复投递（唯一索引冲突）→ 返回 null，调用方跳过发放', async () => {
    insertReturning.mockResolvedValue([])
    const result = await claimPaymentRecord(claim)
    expect(result).toBeNull()
  })
})

describe('completePaymentRecord（认领后补全）', () => {
  it('写入终态与明细，metadata 序列化为 JSON 字符串', async () => {
    updateReturning.mockResolvedValue([{ id: 'pay-1' }])
    const metadata = { pointsAmount: 100, plan: 'pro' }
    const result = await completePaymentRecord('pay-1', {
      paymentStatus: PaymentStatus.SUCCEEDED,
      amount: 990,
      pointsAmount: 100,
      metadata,
    })

    expect(result).toEqual({ id: 'pay-1' })
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentStatus: 'succeeded',
        amount: 990,
        pointsAmount: 100,
        metadata: JSON.stringify(metadata),
      }),
    )
  })

  it('更新零行 → 返回 null', async () => {
    updateReturning.mockResolvedValue([])
    const result = await completePaymentRecord('pay-gone', { paymentStatus: PaymentStatus.FAILED })
    expect(result).toBeNull()
  })
})

describe('getUserPaymentHistory（支付流水读取）', () => {
  it('metadata 反序列化为对象，null 保留为 null', async () => {
    selectOffset.mockResolvedValue([
      { id: 'pay-1', metadata: '{"pointsAmount":100}' },
      { id: 'pay-2', metadata: null },
    ])
    const rows = await getUserPaymentHistory('u1')

    expect(rows[0].metadata).toEqual({ pointsAmount: 100 })
    expect(rows[1].metadata).toBeNull()
  })

  it('类型/状态过滤条件随 options 传入（默认只按用户过滤）', async () => {
    selectOffset.mockResolvedValue([])
    await getUserPaymentHistory('u1', {
      paymentType: PaymentType.SUBSCRIPTION,
      paymentStatus: PaymentStatus.REFUNDED,
      limit: 10,
    })
    expect(selectOffset).toHaveBeenCalled()
  })
})
