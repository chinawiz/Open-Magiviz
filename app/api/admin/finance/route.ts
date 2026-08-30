import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { stripePayments, pointsHistory, users } from '@/lib/schema'
import { eq, desc } from 'drizzle-orm'
import { requireAdminUser } from '@/lib/auth-utils'

// 只读工单查询：按 email 查「付了钱/积分没到账」类问题（docs/admin-plan.md P1）

const LIST_LIMIT = 20

export async function GET(request: NextRequest) {
  try {
    const adminUser = await requireAdminUser()
    if (!adminUser) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const email = (searchParams.get('email') || '').trim().toLowerCase()

    if (!email) {
      return NextResponse.json({ error: 'email 是必需的' }, { status: 400 })
    }

    const userRows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        points: users.points,
        purchasedPoints: users.purchasedPoints,
        giftedPoints: users.giftedPoints,
        subscriptionStatus: users.subscriptionStatus,
        subscriptionPlan: users.subscriptionPlan,
        subscriptionCurrentPeriodEnd: users.subscriptionCurrentPeriodEnd,
        cardVerifiedAt: users.cardVerifiedAt,
        bannedAt: users.bannedAt,
        bannedReason: users.bannedReason,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)

    if (userRows.length === 0) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    const userId = userRows[0].id

    const [payments, history] = await Promise.all([
      db
        .select()
        .from(stripePayments)
        .where(eq(stripePayments.userId, userId))
        .orderBy(desc(stripePayments.createdAt))
        .limit(LIST_LIMIT),
      db
        .select()
        .from(pointsHistory)
        .where(eq(pointsHistory.userId, userId))
        .orderBy(desc(pointsHistory.createdAt))
        .limit(LIST_LIMIT),
    ])

    return NextResponse.json({
      user: userRows[0],
      payments,
      pointsHistory: history,
    })
  } catch (error) {
    console.error('Admin finance API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
