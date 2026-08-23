import { NextRequest, NextResponse } from 'next/server'
import { getAuthedSession, jsonError } from '@/lib/api'
import { db } from '@/lib/db'
import { users, referrals } from '@/lib/schema'
import { eq, desc } from 'drizzle-orm'

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthedSession()

    if (!session) {
      return jsonError(401, 'Unauthorized')
    }

    const userId = session.user.id
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const offset = (page - 1) * limit

    // 获取被推荐用户列表（带分页）
    const referralRecords = await db
      .select({
        id: referrals.id,
        referredId: referrals.referredId,
        referralCode: referrals.referralCode,
        hasSubscribed: referrals.hasSubscribed,
        subscriptionRewarded: referrals.subscriptionRewarded,
        createdAt: referrals.createdAt,
        referredUserEmail: users.email,
        referredUserName: users.name,
        referredUserImage: users.image,
        referredUserSubscriptionStatus: users.subscriptionStatus,
      })
      .from(referrals)
      .innerJoin(users, eq(referrals.referredId, users.id))
      .where(eq(referrals.referrerId, userId))
      .orderBy(desc(referrals.createdAt))
      .limit(limit)
      .offset(offset)

    // 获取总数
    const totalRecords = await db
      .select({ count: referrals.id })
      .from(referrals)
      .where(eq(referrals.referrerId, userId))

    return NextResponse.json({
      success: true,
      data: referralRecords,
      pagination: {
        page,
        limit,
        total: totalRecords.length,
        totalPages: Math.ceil(totalRecords.length / limit),
      },
    })
  } catch (error) {
    console.error('Error fetching referral records:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}


