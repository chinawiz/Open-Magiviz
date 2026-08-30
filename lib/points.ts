import { db } from '@/lib/db'
import { SUBSCRIPTION_PRODUCTS, type SubscriptionPlanType } from '@/lib/stripe'
import { users, pointsHistory } from '@/lib/schema'
import { eq, desc, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'

// 积分配置 - 可以在这里修改各种奖励积分
// 2026-08-30 定价重构：注册赠送 6 点 = 剧本(1)+角色(2)+首个场景分镜(3)，
// 免费层只覆盖前三步；视频/合成按计划能力门控（见 docs/pricing-redesign-2026-08.md §4.2）
export const POINTS_CONFIG = {
  REGISTER_BONUS: 6, // 注册赠送积分（三步体验预算）
  REFERRAL_BONUS: 200, // 推荐用户奖励（被推荐者首笔付费后发放）
  // 验卡一次性赠送：48 点 ≈ 1 部 3 场景 24s 成片（docs/pricing-redesign-2026-08.md §4.2）
  CARD_VERIFICATION_GIFT: 48,
} as const

// 积分操作类型
export enum PointsAction {
  REGISTER = 'register',
  REFERRAL = 'referral',
  MANUAL = 'manual',
  GENERATE_STORY = 'generate_story',
  GENERATE_CHARACTER = 'generate_character',
  GENERATE_STORYBOARD = 'generate_storyboard',
  GENERATE_STORY_VIDEO = 'generate_story_video',
  GENERATE_FINAL_VIDEO = 'generate_final_video',
}

// 积分类型
export enum PointsType {
  PURCHASED = 'purchased', // 购买积分（永不过期）
  GIFTED = 'gifted', // 赠送积分（订阅到期清零）
}

// 操作描述映射
const ACTION_DESCRIPTIONS = {
  [PointsAction.REGISTER]: 'Registration bonus',
  [PointsAction.REFERRAL]: 'Referral bonus',
  [PointsAction.MANUAL]: 'Manual operation',
  [PointsAction.GENERATE_STORY]: 'Generate story',
  [PointsAction.GENERATE_CHARACTER]: 'Generate character',
  [PointsAction.GENERATE_STORYBOARD]: 'Generate storyboard',
  [PointsAction.GENERATE_STORY_VIDEO]: 'Generate story video',
  [PointsAction.GENERATE_FINAL_VIDEO]: 'Generate final video',
} as const

const DEFAULT_SUBSCRIPTION_GIFTED_POINTS = 1000

export function getSubscriptionGiftedPoints(plan: SubscriptionPlanType | null | undefined) {
  if (!plan) {
    return DEFAULT_SUBSCRIPTION_GIFTED_POINTS
  }
  return SUBSCRIPTION_PRODUCTS[plan]?.giftedPoints ?? DEFAULT_SUBSCRIPTION_GIFTED_POINTS
}

// 添加积分历史记录
async function addPointsHistory(
  userId: string,
  points: number,
  action: PointsAction,
  pointsType: PointsType,
  description?: string
) {
  await db.insert(pointsHistory).values({
    id: nanoid(),
    userId,
    points,
    pointsType,
    action,
    description: description || ACTION_DESCRIPTIONS[action],
  })
}

// 添加积分
export async function addPoints(
  userId: string, 
  points: number, 
  action: PointsAction = PointsAction.MANUAL,
  pointsType: PointsType = PointsType.PURCHASED, // 默认为购买积分
  description?: string
) {
  try {
    // 根据积分类型更新不同的字段
    if (pointsType === PointsType.PURCHASED) {
      await db
        .update(users)
        .set({
          points: sql`${users.points} + ${points}`,
          purchasedPoints: sql`${users.purchasedPoints} + ${points}`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
    } else {
      await db
        .update(users)
        .set({
          points: sql`${users.points} + ${points}`,
          giftedPoints: sql`${users.giftedPoints} + ${points}`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
    }

    // 添加历史记录
    await addPointsHistory(userId, points, action, pointsType, description)

    // 获取更新后的积分总数
    const user = await db
      .select({ points: users.points })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    const newPoints = user.length > 0 ? user[0].points || 0 : 0
    console.log(`用户 ${userId} 获得 ${points} ${pointsType}积分 (${action})，当前总积分: ${newPoints}`)
    return newPoints
  } catch (error) {
    console.error('添加积分失败:', error)
    throw error
  }
}

// 获取用户积分
export async function getUserPoints(userId: string) {
  try {
    const result = await db
      .select({ points: users.points })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    return result[0]?.points || 0
  } catch (error) {
    console.error('获取用户积分失败:', error)
    return 0
  }
}

// 扣除积分
export async function deductPoints(userId: string, points: number, description?: string, action: PointsAction = PointsAction.MANUAL) {
  try {
    const currentPoints = await getUserPoints(userId)

    if (currentPoints < points) {
      throw new Error('Insufficient points')
    }

    const newPoints = currentPoints - points
    await db
      .update(users)
      .set({
        points: newPoints,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))

    // 添加历史记录（负数表示扣除）
    await addPointsHistory(userId, -points, action, PointsType.PURCHASED, description || ACTION_DESCRIPTIONS[action])

    console.log(`用户 ${userId} 扣除 ${points} 积分，当前总积分: ${newPoints}`)
    return newPoints
  } catch (error) {
    console.error('扣除积分失败:', error)
    throw error
  }
}

// 获取用户积分历史
export async function getUserPointsHistory(userId: string, limit: number = 20, offset: number = 0) {
  try {
    const history = await db
      .select({
        id: pointsHistory.id,
        points: pointsHistory.points,
        action: pointsHistory.action,
        description: pointsHistory.description,
        createdAt: pointsHistory.createdAt,
      })
      .from(pointsHistory)
      .where(eq(pointsHistory.userId, userId))
      .orderBy(desc(pointsHistory.createdAt))
      .limit(limit)
      .offset(offset)

    return history
  } catch (error) {
    console.error('获取积分历史失败:', error)
    return []
  }
}

// 获取用户积分历史总数
export async function getUserPointsHistoryCount(userId: string) {
  try {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(pointsHistory)
      .where(eq(pointsHistory.userId, userId))

    return result[0]?.count || 0
  } catch (error) {
    console.error('获取积分历史总数失败:', error)
    return 0
  }
}

// 给新注册用户赠送积分（归类为购买积分，永不过期）
export async function giveRegisterBonus(userId: string) {
  return addPoints(
    userId,
    POINTS_CONFIG.REGISTER_BONUS,
    PointsAction.REGISTER,
    PointsType.PURCHASED // 注册积分归类为购买积分，永不过期
  )
}