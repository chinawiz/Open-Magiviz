import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { stripePayments, pointsHistory } from '@/lib/schema'
import { eq, sum, count, and, isNotNull, lt, sql, inArray } from 'drizzle-orm'
import { requireAdminUser } from '@/lib/auth-utils'

/**
 * finance 对账视图（docs/admin-plan.md P2）：网关侧 vs 台账侧勾稽。
 * - 勾稽主线： succeeded 积分购买的 pointsAmount 合计 vs pointsHistory(action='purchase') 发放合计，
 *   差异 ≠ 0 即存在「付了钱没到账」（webhook 漏发），用 finance 查询页定位到人后手动补发。
 * - 退款单：charge.refunded 由 webhook 回写 paymentStatus/refundAmount（积分回收是手动调减，走审计）。
 * 全部只读，无审计需求。
 */
export async function GET() {
  try {
    const adminUser = await requireAdminUser()
    if (!adminUser) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    // 应发口径 = 曾成功售出（含后来退款的——退款积分走手动调减回收，不影响"曾应发"）
    const soldPointsPurchase = and(
      inArray(stripePayments.paymentStatus, ['succeeded', 'refunded']),
      eq(stripePayments.paymentType, 'points_purchase')
    )
    const succeededPointsPurchase = and(
      eq(stripePayments.paymentStatus, 'succeeded'),
      eq(stripePayments.paymentType, 'points_purchase')
    )

    const [subRevenueQ, pointsRevenueQ, pointsSoldQ, refundedAmountQ, refundedCountQ, stuckPendingQ, deliveredQ] =
      await Promise.all([
        // 订阅收入（网关侧实收）
        db
          .select({ total: sum(stripePayments.amount) })
          .from(stripePayments)
          .where(and(eq(stripePayments.paymentStatus, 'succeeded'), eq(stripePayments.paymentType, 'subscription'))),
        // 积分购买收入（网关侧实收，仅 succeeded——退款额单列）
        db.select({ total: sum(stripePayments.amount) }).from(stripePayments).where(succeededPointsPurchase),
        // 售出积分（应发数：succeeded + refunded）
        db.select({ total: sum(stripePayments.pointsAmount) }).from(stripePayments).where(soldPointsPurchase),
        // 退款合计与笔数
        db
          .select({ total: sum(stripePayments.refundAmount) })
          .from(stripePayments)
          .where(isNotNull(stripePayments.refundAmount)),
        db.select({ count: count() }).from(stripePayments).where(eq(stripePayments.paymentStatus, 'refunded')),
        // 漏发观察项：pending 超过 1 小时（checklist §6 观察口径）
        db
          .select({ count: count() })
          .from(stripePayments)
          .where(and(eq(stripePayments.paymentStatus, 'pending'), lt(stripePayments.createdAt, sql`now() - interval '1 hour'`))),
        // 已发放积分（台账侧口径：实发数）
        db
          .select({ total: sum(pointsHistory.points) })
          .from(pointsHistory)
          .where(and(eq(pointsHistory.action, 'purchase'), sql`${pointsHistory.points} > 0`)),
      ])

    const pointsSold = Number(pointsSoldQ[0]?.total || 0)
    const pointsDelivered = Number(deliveredQ[0]?.total || 0)

    return NextResponse.json({
      gateway: {
        subscriptionRevenue: Number(subRevenueQ[0]?.total || 0),
        pointsRevenue: Number(pointsRevenueQ[0]?.total || 0),
        pointsSold,
        refundedAmount: Number(refundedAmountQ[0]?.total || 0),
        refundedCount: refundedCountQ[0]?.count || 0,
        stuckPending: stuckPendingQ[0]?.count || 0,
      },
      ledger: {
        pointsDelivered,
      },
      // 差异 ≠ 0 = 有订单付了钱但积分没到账
      diff: pointsSold - pointsDelivered,
    })
  } catch (error) {
    console.error('Admin finance recon error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
