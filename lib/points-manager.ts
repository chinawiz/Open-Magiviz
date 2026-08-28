import { db } from '@/lib/db'
import { users, pointsHistory } from '@/lib/schema'
import { eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

// 获取用户积分详情
export async function getUserPointsDetail(userId: string) {
  try {
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1)
    
    if (user.length === 0) {
      throw new Error('用户不存在')
    }

    const currentUser = user[0]
    
    // 检查订阅是否已到期并处理积分清零
    const now = new Date()
    const isExpired = currentUser.subscriptionCurrentPeriodEnd && currentUser.subscriptionCurrentPeriodEnd < now
    let totalPoints = currentUser.points || 0
    let giftedPoints = currentUser.giftedPoints || 0
    let subscriptionStatus = currentUser.subscriptionStatus
    let subscriptionPlan = currentUser.subscriptionPlan

    // 如果订阅已到期但状态仍为active，需要清零赠送积分
    if (isExpired && currentUser.subscriptionStatus === 'active' && (currentUser.giftedPoints || 0) > 0) {
      console.log('积分详情API检测到订阅已到期，清零赠送积分:', {
        userId: currentUser.id,
        到期时间: currentUser.subscriptionCurrentPeriodEnd,
        当前时间: now,
        当前赠送积分: currentUser.giftedPoints
      })

      // 清零赠送积分并更新订阅状态
      await db
        .update(users)
        .set({
          subscriptionStatus: 'expired',
          subscriptionPlan: null,
          points: sql`${users.points} - ${currentUser.giftedPoints || 0}`,
          giftedPoints: 0,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))

      // 记录积分清零历史
      await db.insert(pointsHistory).values({
        id: uuidv4(),
        userId: currentUser.id,
        points: -(currentUser.giftedPoints || 0),
        pointsType: 'gifted',
        action: 'subscription_expired',
        description: `订阅到期自动清零赠送积分`,
        createdAt: new Date(),
      })

      // 更新返回值
      totalPoints = totalPoints - (currentUser.giftedPoints || 0)
      giftedPoints = 0
      subscriptionStatus = 'expired'
      subscriptionPlan = null

      console.log(`积分详情API订阅到期处理完成: 用户 ${currentUser.id}，清零 ${currentUser.giftedPoints || 0} 赠送积分`)
    }
    
    return {
      totalPoints,
      purchasedPoints: currentUser.purchasedPoints || 0,
      giftedPoints,
      subscriptionStatus,
      subscriptionPlan,
      subscriptionCurrentPeriodEnd: currentUser.subscriptionCurrentPeriodEnd,
    }
  } catch (error) {
    console.error('获取用户积分详情失败:', error)
    throw error
  }
}