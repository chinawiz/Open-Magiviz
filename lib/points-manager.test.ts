import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { getUserPointsDetail } from './points-manager'

/**
 * points-manager 契约测试（seam：订阅到期赠送积分清零）。
 * 关键验证：到期+active+有赠送积分 → 清零、写 subscription_expired 负数流水、
 * 订阅状态转 expired；purchased 积分永不清零。db 是系统边界，予以 mock。
 */

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
}))

const selectLimit = vi.fn()
const updateSet = vi.fn().mockReturnThis()
const updateWhere = vi.fn().mockResolvedValue([])
const insertValues = vi.fn().mockResolvedValue([])

function mockUser(user: Record<string, unknown> | []) {
  ;(db.select as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ limit: selectLimit }),
    }),
  })
  selectLimit.mockResolvedValue(Array.isArray(user) ? user : [user])
  ;(db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set: updateSet })
  updateSet.mockReturnValue({ where: updateWhere })
  ;(db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: insertValues })
}

const futureDate = new Date('2030-01-01')
const pastDate = new Date('2020-01-01')

beforeEach(() => {
  vi.clearAllMocks()
  updateWhere.mockResolvedValue([])
  insertValues.mockResolvedValue([])
})

describe('getUserPointsDetail（积分详情与订阅到期清零）', () => {
  it('用户不存在 → 抛错', async () => {
    mockUser([])
    await expect(getUserPointsDetail('u1')).rejects.toThrow('用户不存在')
  })

  it('订阅未到期 → 原样返回，不动账', async () => {
    mockUser({
      id: 'u1',
      points: 106,
      purchasedPoints: 6,
      giftedPoints: 100,
      subscriptionStatus: 'active',
      subscriptionPlan: 'pro',
      subscriptionCurrentPeriodEnd: futureDate,
    })
    const detail = await getUserPointsDetail('u1')

    expect(detail).toMatchObject({
      totalPoints: 106,
      purchasedPoints: 6,
      giftedPoints: 100,
      subscriptionStatus: 'active',
      subscriptionPlan: 'pro',
    })
    expect(updateSet).not.toHaveBeenCalled()
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('到期+active+有赠送积分 → 清零赠送部分并写 subscription_expired 负数流水', async () => {
    mockUser({
      id: 'u1',
      points: 106,
      purchasedPoints: 6,
      giftedPoints: 100,
      subscriptionStatus: 'active',
      subscriptionPlan: 'pro',
      subscriptionCurrentPeriodEnd: pastDate,
    })
    const detail = await getUserPointsDetail('u1')

    expect(detail).toMatchObject({
      totalPoints: 6,
      giftedPoints: 0,
      subscriptionStatus: 'expired',
      subscriptionPlan: null,
    })
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        points: -100,
        pointsType: 'gifted',
        action: 'subscription_expired',
      }),
    )
  })

  it('到期清零只扣赠送积分，purchased 部分永不清零（夹具满足 points=purchased+gifted 不变式）', async () => {
    mockUser({
      id: 'u1',
      points: 1054,
      purchasedPoints: 54,
      giftedPoints: 1000,
      subscriptionStatus: 'active',
      subscriptionPlan: 'starter',
      subscriptionCurrentPeriodEnd: pastDate,
    })
    const detail = await getUserPointsDetail('u1')
    expect(detail.totalPoints).toBe(54)
    expect(detail.purchasedPoints).toBe(54)
  })

  it('到期但赠送积分已为 0 → 现状契约：不动账也不转状态（状态翻转只发生在清零分支内）', async () => {
    mockUser({
      id: 'u1',
      points: 54,
      purchasedPoints: 54,
      giftedPoints: 0,
      subscriptionStatus: 'active',
      subscriptionPlan: 'pro',
      subscriptionCurrentPeriodEnd: pastDate,
    })
    const detail = await getUserPointsDetail('u1')
    expect(detail.subscriptionStatus).toBe('active')
    expect(detail.totalPoints).toBe(54)
    expect(updateSet).not.toHaveBeenCalled()
    expect(insertValues).not.toHaveBeenCalled()
  })
})
