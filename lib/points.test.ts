import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { addPoints, deductPoints, getSubscriptionGiftedPoints, giveRegisterBonus, POINTS_CONFIG, PointsAction, PointsType } from './points'

/**
 * points 契约测试（seam：积分账本写半边）。
 * 关键验证：deductPoints 的「余额不足拒扣」守卫（负余额事故的防线）与
 * purchased/gifted 两本账的字段分流。db 是系统边界，予以 mock；
 * stripe 价格表予以 mock（避免模块顶层构造 Stripe 客户端）。
 */

vi.mock('@/lib/db', () => ({
  db: {
    update: vi.fn(),
    insert: vi.fn(),
    select: vi.fn(),
  },
}))

vi.mock('@/lib/stripe', () => ({
  SUBSCRIPTION_PRODUCTS: {
    starter: { giftedPoints: 48 },
    pro: { giftedPoints: 1000 },
  },
}))

const updateSet = vi.fn().mockReturnThis()
const updateWhere = vi.fn().mockResolvedValue([])
const insertValues = vi.fn().mockResolvedValue([])
const selectLimit = vi.fn().mockResolvedValue([{ points: 106 }])

function wireDb() {
  const m = db as unknown as Record<string, ReturnType<typeof vi.fn>>
  m.update.mockReturnValue({ set: updateSet })
  updateSet.mockReturnValue({ where: updateWhere })
  m.insert.mockReturnValue({ values: insertValues })
  m.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: selectLimit,
      }),
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  updateWhere.mockResolvedValue([])
  insertValues.mockResolvedValue([])
  selectLimit.mockResolvedValue([{ points: 106 }])
  wireDb()
})

describe('getSubscriptionGiftedPoints（订阅赠送积分表）', () => {
  it('已知计划返回登记值，未知/空计划回落默认值', () => {
    expect(getSubscriptionGiftedPoints('pro')).toBe(1000)
    expect(getSubscriptionGiftedPoints('starter')).toBe(48)
    expect(getSubscriptionGiftedPoints(null)).toBe(getSubscriptionGiftedPoints(undefined))
    expect(getSubscriptionGiftedPoints('nonexistent' as never)).toBe(1000)
  })
})

describe('addPoints（积分入账）', () => {
  it('purchased 类型走 points+purchasedPoints 双字段递增，历史默认记购买类型', async () => {
    await addPoints('u1', 100, PointsAction.MANUAL, PointsType.PURCHASED)

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        points: expect.anything(),
        purchasedPoints: expect.anything(),
      }),
    )
    expect(updateSet.mock.calls[0][0]).not.toHaveProperty('giftedPoints')
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', points: 100, pointsType: 'purchased', action: 'manual' }),
    )
  })

  it('gifted 类型走 giftedPoints 字段分流', async () => {
    await addPoints('u1', 100, PointsAction.MANUAL, PointsType.GIFTED)

    expect(updateSet.mock.calls[0][0]).toHaveProperty('giftedPoints')
    expect(updateSet.mock.calls[0][0]).not.toHaveProperty('purchasedPoints')
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ points: 100, pointsType: 'gifted' }),
    )
  })

  it('返回扣加后的最新总积分', async () => {
    const result = await addPoints('u1', 100)
    expect(result).toBe(106)
  })
})

describe('deductPoints（扣费与负余额守卫）', () => {
  it('余额充足 → 扣减并写负数历史（流水负数表示扣除）', async () => {
    selectLimit.mockResolvedValue([{ points: 50 }])
    const result = await deductPoints('u1', 30, '测试扣费')

    expect(result).toBe(20)
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ points: 20 }))
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ points: -30, pointsType: 'purchased', description: '测试扣费' }),
    )
  })

  it('余额不足 → 抛错拒扣，且不写任何账（负余额守卫）', async () => {
    selectLimit.mockResolvedValue([{ points: 10 }])
    await expect(deductPoints('u1', 30)).rejects.toThrow('Insufficient points')
    expect(updateSet).not.toHaveBeenCalled()
    expect(insertValues).not.toHaveBeenCalled()
  })
})

describe('giveRegisterBonus（注册赠送）', () => {
  it('赠送 POINTS_CONFIG.REGISTER_BONUS 点，归类 purchased（永不过期）', async () => {
    await giveRegisterBonus('u1')
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        points: POINTS_CONFIG.REGISTER_BONUS,
        pointsType: 'purchased',
        action: 'register',
      }),
    )
  })
})
