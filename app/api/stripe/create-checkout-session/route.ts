import { NextRequest, NextResponse } from 'next/server'
import { stripe, POINTS_PRODUCTS } from '@/lib/stripe'
import { getAuthedSession, jsonError } from '@/lib/api'

export async function POST(request: NextRequest) {
  try {
    // 检查Stripe是否已配置
    if (!stripe) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })
    }

    const session = await getAuthedSession()

    if (!session?.user?.email) {
      return jsonError(401, 'Unauthorized')
    }

    const { packageId, points } = await request.json()

    // 安全约束：点数与金额只能来自服务端价目表（POINTS_PRODUCTS）。
    // 历史上这里信任客户端传入的 amount，导致可伪造低价结算，已修复——
    // 客户端输入仅用于匹配套餐，金额一律以服务端配置为准。
    const pkg = packageId
      ? Object.values(POINTS_PRODUCTS).find((p) => p.id === packageId)
      : Object.values(POINTS_PRODUCTS).find((p) => p.points === Number(points))

    if (!pkg) {
      return NextResponse.json({ error: 'Invalid points package' }, { status: 400 })
    }

    // 创建或获取客户
    let customer
    const existingCustomers = await stripe.customers.list({
      email: session.user.email,
      limit: 1,
    })

    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0]
    } else {
      customer = await stripe.customers.create({
        email: session.user.email,
        name: session.user.name || undefined,
      })
    }

    // 优先使用服务端环境变量里配置的价格 ID；未配置时按服务端价目表动态建价
    const lineItems = pkg.priceId
      ? [
          {
            price: pkg.priceId,
            quantity: 1,
          },
        ]
      : [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `${pkg.points.toLocaleString()} Points`,
                description: `Purchase ${pkg.points.toLocaleString()} points for your account`,
              },
              unit_amount: pkg.price * 100, // 元转分
            },
            quantity: 1,
          },
        ]

    // 创建结账会话
    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customer.id,
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/profile?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/profile?payment=cancelled`,
      metadata: {
        userId: session.user.id || '',
        points: pkg.points.toString(),
        type: 'points_purchase',
      },
      // 启用发票生成
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description: `${pkg.points.toLocaleString()} Points Purchase`,
          metadata: {
            userId: session.user.id,
            type: 'points_purchase'
          }
        }
      },
    })

    return NextResponse.json({ url: checkoutSession.url })
  } catch (error) {
    console.error('Stripe checkout session creation error:', error)
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    )
  }
}
