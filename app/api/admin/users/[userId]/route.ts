import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users, pointsHistory } from '@/lib/schema'
import { eq, desc, sql } from 'drizzle-orm'
import { requireAdminUser, getClientIP } from '@/lib/auth-utils'
import { recordAdminAudit } from '@/lib/admin-audit'
import { v4 as uuidv4 } from 'uuid'
import { getSubscriptionGiftedPoints } from '@/lib/points'

// 详情接口列白名单：绝不返回 password/resetToken/cardFingerprint 等敏感列（P0 安全收口）
const USER_DETAIL_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  emailVerified: users.emailVerified,
  image: users.image,
  role: users.role,
  points: users.points,
  purchasedPoints: users.purchasedPoints,
  giftedPoints: users.giftedPoints,
  hasTrialSubscription: users.hasTrialSubscription,
  subscriptionStatus: users.subscriptionStatus,
  subscriptionPlan: users.subscriptionPlan,
  subscriptionCurrentPeriodEnd: users.subscriptionCurrentPeriodEnd,
  signupIp: users.signupIp,
  cardVerifiedAt: users.cardVerifiedAt,
  bannedAt: users.bannedAt,
  bannedReason: users.bannedReason,
  referralCode: users.referralCode,
  referredBy: users.referredBy,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
}

// 调积分单次上限：防手滑保险（超过请分批操作，审计可逐笔追踪）
const MAX_SINGLE_ADJUST_POINTS = 100000

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const adminUser = await requireAdminUser()
    if (!adminUser) {
      return NextResponse.json(
        { error: '需要管理员权限' },
        { status: 403 }
      )
    }

    const { userId } = await params

    // 获取用户详细信息（白名单列）
    const user = await db
      .select(USER_DETAIL_COLUMNS)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    if (user.length === 0) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      )
    }

    // 获取用户积分历史
    const pointsHistoryData = await db
      .select()
      .from(pointsHistory)
      .where(eq(pointsHistory.userId, userId))
      .orderBy(desc(pointsHistory.createdAt))
      .limit(20)

    return NextResponse.json({
      user: user[0],
      pointsHistory: pointsHistoryData
    })
  } catch (error) {
    console.error('Get user details error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const adminUser = await requireAdminUser()
    if (!adminUser) {
      return NextResponse.json(
        { error: '需要管理员权限' },
        { status: 403 }
      )
    }

    const { userId } = await params
    const { action, ...data } = await request.json()
    const ip = getClientIP(request)

    // 所有写操作共用模式：审计先行（fail-closed，审计失败即中止）→ 业务写。
    // neon-http 驱动不支持事务，靠「先审计后写」的顺序保证审计不缺失。

    if (action === 'updateRole') {
      const { role } = data

      if (!['user', 'admin'].includes(role)) {
        return NextResponse.json(
          { error: '无效的用户角色' },
          { status: 400 }
        )
      }

      const currentUser = await db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)

      if (currentUser.length === 0) {
        return NextResponse.json(
          { error: '用户不存在' },
          { status: 404 }
        )
      }

      await recordAdminAudit({
        adminUserId: adminUser.id,
        action: 'update_role',
        targetType: 'user',
        targetId: userId,
        before: { role: currentUser[0].role },
        after: { role },
        ip,
      })

      const result = await db
        .update(users)
        .set({
          role,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId))
        .returning()

      return NextResponse.json({
        message: '用户角色更新成功',
        user: { ...result[0], password: undefined, resetToken: undefined }
      })
    }

    if (action === 'adjustPoints') {
      const { points, pointsType = 'purchased', description } = data

      if (!points || isNaN(points)) {
        return NextResponse.json(
          { error: '积分数量无效' },
          { status: 400 }
        )
      }

      const pointsChange = parseInt(points)
      if (Math.abs(pointsChange) > MAX_SINGLE_ADJUST_POINTS) {
        return NextResponse.json(
          { error: `单次调整不能超过 ${MAX_SINGLE_ADJUST_POINTS} 积分，请分批操作` },
          { status: 400 }
        )
      }

      // 获取当前用户信息
      const currentUser = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)

      if (currentUser.length === 0) {
        return NextResponse.json(
          { error: '用户不存在' },
          { status: 404 }
        )
      }

      const user = currentUser[0]

      // 如果是赠送积分，必须关联订阅到期时间
      if (pointsType === 'gifted' && pointsChange > 0) {
        if (!user.subscriptionCurrentPeriodEnd) {
          return NextResponse.json(
            { error: '赠送积分必须关联订阅到期时间，请先为用户设置订阅' },
            { status: 400 }
          )
        }
        // 检查订阅是否已过期
        const now = new Date()
        if (user.subscriptionCurrentPeriodEnd < now) {
          return NextResponse.json(
            { error: '用户订阅已过期，无法添加赠送积分。请先更新订阅到期时间' },
            { status: 400 }
          )
        }
      }

      // 计算新的积分值
      let newTotalPoints = (user.points || 0) + pointsChange
      let newPurchasedPoints = user.purchasedPoints || 0
      let newGiftedPoints = user.giftedPoints || 0

      if (pointsType === 'purchased') {
        newPurchasedPoints += pointsChange
      } else {
        newGiftedPoints += pointsChange
        // 如果是扣除赠送积分，确保不超过当前赠送积分数量
        if (pointsChange < 0 && Math.abs(pointsChange) > (user.giftedPoints || 0)) {
          return NextResponse.json(
            { error: '扣除的赠送积分不能超过当前赠送积分数量' },
            { status: 400 }
          )
        }
      }

      // 确保积分不为负数
      if (newTotalPoints < 0) {
        return NextResponse.json(
          { error: '积分不足，无法扣除' },
          { status: 400 }
        )
      }

      // 审计先行（脱敏白名单只含积分字段，天然无敏感列）
      await recordAdminAudit({
        adminUserId: adminUser.id,
        action: 'adjust_points',
        targetType: 'user',
        targetId: userId,
        before: {
          points: user.points,
          purchasedPoints: user.purchasedPoints,
          giftedPoints: user.giftedPoints,
        },
        after: {
          points: newTotalPoints,
          purchasedPoints: Math.max(0, newPurchasedPoints),
          giftedPoints: Math.max(0, newGiftedPoints),
          change: pointsChange,
          pointsType,
          description: description || null,
        },
        ip,
      })

      // 更新用户积分
      const updatedUser = await db
        .update(users)
        .set({
          points: newTotalPoints,
          purchasedPoints: Math.max(0, newPurchasedPoints),
          giftedPoints: Math.max(0, newGiftedPoints),
          updatedAt: new Date()
        })
        .where(eq(users.id, userId))
        .returning()

      // 记录积分变动历史（与审计双写验收：两条都必须落库）
      await db.insert(pointsHistory).values({
        id: uuidv4(),
        userId,
        points: pointsChange,
        pointsType,
        action: 'manual',
        description: description || `管理员${pointsChange > 0 ? '增加' : '扣除'}${pointsType === 'purchased' ? '购买' : '赠送'}积分`,
        createdAt: new Date()
      })

      return NextResponse.json({
        message: '积分调整成功',
        user: { ...updatedUser[0], password: undefined, resetToken: undefined }
      })
    }

    if (action === 'updateSubscription') {
      const { subscriptionStatus, subscriptionPlan, subscriptionEndDate } = data

      // 验证订阅状态
      if (subscriptionStatus && !['active', 'cancelled', 'past_due', 'paused'].includes(subscriptionStatus)) {
        return NextResponse.json(
          { error: '无效的订阅状态' },
          { status: 400 }
        )
      }

      // 验证订阅计划
      if (subscriptionPlan && !['trial', 'pro', 'annual', 'starter'].includes(subscriptionPlan)) {
        return NextResponse.json(
          { error: '无效的订阅计划' },
          { status: 400 }
        )
      }

      const currentUser = await db
        .select({
          subscriptionStatus: users.subscriptionStatus,
          subscriptionPlan: users.subscriptionPlan,
          subscriptionCurrentPeriodEnd: users.subscriptionCurrentPeriodEnd,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)

      if (currentUser.length === 0) {
        return NextResponse.json(
          { error: '用户不存在' },
          { status: 404 }
        )
      }

      // 构建更新数据
      const updateData: Record<string, unknown> = {
        updatedAt: new Date()
      }

      if (subscriptionStatus) {
        updateData.subscriptionStatus = subscriptionStatus
      }

      if (subscriptionPlan) {
        updateData.subscriptionPlan = subscriptionPlan
      }

      if (subscriptionEndDate) {
        updateData.subscriptionCurrentPeriodEnd = new Date(subscriptionEndDate)
      }

      // 审计先行
      await recordAdminAudit({
        adminUserId: adminUser.id,
        action: 'update_subscription',
        targetType: 'user',
        targetId: userId,
        before: {
          subscriptionStatus: currentUser[0].subscriptionStatus,
          subscriptionPlan: currentUser[0].subscriptionPlan,
          subscriptionCurrentPeriodEnd: currentUser[0].subscriptionCurrentPeriodEnd,
        },
        after: {
          subscriptionStatus: updateData.subscriptionStatus ?? currentUser[0].subscriptionStatus,
          subscriptionPlan: updateData.subscriptionPlan ?? currentUser[0].subscriptionPlan,
          subscriptionCurrentPeriodEnd: updateData.subscriptionCurrentPeriodEnd ?? currentUser[0].subscriptionCurrentPeriodEnd,
        },
        ip,
      })

      // 更新用户订阅信息
      const updatedUser = await db
        .update(users)
        .set(updateData)
        .where(eq(users.id, userId))
        .returning()

      // 如果激活订阅，给用户赠送积分
      if (subscriptionStatus === 'active' && subscriptionPlan && ['trial', 'pro', 'annual', 'starter'].includes(subscriptionPlan)) {
        const giftPoints = getSubscriptionGiftedPoints(subscriptionPlan as 'trial' | 'pro' | 'annual' | 'starter')

        // 更新用户积分
        await db
          .update(users)
          .set({
            points: sql`${users.points} + ${giftPoints}`,
            giftedPoints: sql`${users.giftedPoints} + ${giftPoints}`,
            updatedAt: new Date()
          })
          .where(eq(users.id, userId))

        // 记录积分变动历史
        await db.insert(pointsHistory).values({
          id: uuidv4(),
          userId,
          points: giftPoints,
          pointsType: 'gifted',
          action: 'subscription_gift',
          description: `管理员激活${subscriptionPlan}订阅，赠送${giftPoints}积分`,
          createdAt: new Date()
        })
      }

      return NextResponse.json({
        message: '订阅信息更新成功',
        user: { ...updatedUser[0], password: undefined, resetToken: undefined }
      })
    }

    if (action === 'ban' || action === 'unban') {
      const banning = action === 'ban'
      const reason = (data.reason as string | undefined)?.trim() || null

      if (banning && !reason) {
        return NextResponse.json(
          { error: '封禁必须填写原因（将写入审计）' },
          { status: 400 }
        )
      }

      const currentUser = await db
        .select({
          role: users.role,
          bannedAt: users.bannedAt,
          bannedReason: users.bannedReason,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)

      if (currentUser.length === 0) {
        return NextResponse.json(
          { error: '用户不存在' },
          { status: 404 }
        )
      }

      // 安全护栏：不允许封禁管理员账号（防止单管理员自封后失控）
      if (banning && currentUser[0].role === 'admin') {
        return NextResponse.json(
          { error: '不能封禁管理员账号' },
          { status: 400 }
        )
      }

      const now = new Date()
      await recordAdminAudit({
        adminUserId: adminUser.id,
        action: banning ? 'ban_user' : 'unban_user',
        targetType: 'user',
        targetId: userId,
        before: {
          bannedAt: currentUser[0].bannedAt,
          bannedReason: currentUser[0].bannedReason,
        },
        after: {
          bannedAt: banning ? now : null,
          bannedReason: banning ? reason : null,
        },
        ip,
      })

      const updatedUser = await db
        .update(users)
        .set({
          bannedAt: banning ? now : null,
          bannedReason: banning ? reason : null,
          updatedAt: now,
        })
        .where(eq(users.id, userId))
        .returning()

      return NextResponse.json({
        message: banning ? '用户已封禁' : '用户已解封',
        user: { ...updatedUser[0], password: undefined, resetToken: undefined }
      })
    }

    return NextResponse.json(
      { error: '无效的操作类型' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Update user error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
