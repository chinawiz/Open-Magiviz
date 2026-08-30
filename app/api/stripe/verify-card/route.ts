import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { getAuthedSession, jsonError } from '@/lib/api'
import { db } from '@/lib/db'
import { users } from '@/lib/schema'
import { eq } from 'drizzle-orm'

export const maxDuration = 10

/**
 * 支付方式验证（2026-08-30 定价重构 §4.2）。
 * Stripe Checkout mode:'setup' 保存一张可用卡——不建订阅、不扣款；
 * webhook 收到 setup 完成后一次性发放 CARD_VERIFICATION_GIFT 点（≈1 部成片）。
 * 前提：登录 + 邮箱已验证（登录闸已保证）。同一用户只允许发起一次有效验证。
 */
export async function POST(request: NextRequest) {
  try {
    if (!stripe) {
      return jsonError(500, 'Stripe not configured')
    }

    const session = await getAuthedSession()
    if (!session?.user?.email || !session.user.id) {
      return jsonError(401, 'Unauthorized')
    }

    const userRows = await db
      .select({
        id: users.id,
        cardVerifiedAt: users.cardVerifiedAt,
        stripeCustomerId: users.stripeCustomerId,
      })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1)

    const user = userRows[0]
    if (!user) {
      return jsonError(404, 'User not found')
    }

    if (user.cardVerifiedAt) {
      return NextResponse.json({ alreadyVerified: true })
    }

    // 创建或复用 Stripe Customer
    let customerId = user.stripeCustomerId || null
    if (customerId) {
      const existing = await stripe.customers.retrieve(customerId).catch(() => null)
      if (!existing || existing.deleted) {
        customerId = null
      }
    }
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: session.user.email,
        name: session.user.name || undefined,
        metadata: { userId: user.id },
      })
      customerId = customer.id
    }

    const { locale = 'en' } = await request.json().catch(() => ({ locale: 'en' }))
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''

    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'setup',
      payment_method_types: ['card'],
      // setup 模式必填 currency
      currency: 'usd',
      success_url: `${appUrl}/${locale}/create?card_verified=1`,
      cancel_url: `${appUrl}/${locale}/create?card_verify_cancelled=1`,
      metadata: {
        userId: user.id,
        type: 'card_verification',
      },
    })

    return NextResponse.json({ url: checkoutSession.url })
  } catch (error) {
    console.error('Verify-card session creation error:', error)
    return jsonError(500, 'Failed to create verification session')
  }
}
