import { NextRequest, NextResponse } from 'next/server'
import { getAuthedSession, jsonError } from '@/lib/api'
import { db } from '@/lib/db'
import { users } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-01-28.clover',
})

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthedSession()
    
    if (!session) {
      return jsonError(401, 'Unauthorized')
    }

    // 获取用户的Stripe客户ID
    const user = await db.select({
      stripeCustomerId: users.stripeCustomerId
    }).from(users).where(eq(users.id, session.user.id)).limit(1)

    const userData = user[0]

    if (!userData?.stripeCustomerId) {
      return NextResponse.json(
        { error: 'No Stripe customer found' },
        { status: 404 }
      )
    }

    // 获取请求体中的返回URL
    const body = await request.json()
    const { returnUrl } = body

    // 创建客户门户会话
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: userData.stripeCustomerId,
      return_url: returnUrl || `${process.env.NEXT_PUBLIC_BASE_URL}/profile`,
    })

    return NextResponse.json({
      url: portalSession.url
    })

  } catch (error) {
    console.error('Customer portal creation error:', error)
    return NextResponse.json(
      { error: 'Failed to create customer portal session' },
      { status: 500 }
    )
  }
}
