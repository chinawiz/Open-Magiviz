import { db } from './db'
import { stripePayments, users } from './schema'
import { eq, desc, and, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { NewStripePayment } from './types'

// 支付状态枚举
export enum PaymentStatus {
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  PENDING = 'pending',
  REFUNDED = 'refunded',
  CANCELLED = 'cancelled'
}

// 支付类型枚举
export enum PaymentType {
  SUBSCRIPTION = 'subscription',
  POINTS_PURCHASE = 'points_purchase',
  ONE_TIME = 'one_time'
}

// 支付记录接口
export interface PaymentRecord {
  id: string
  userId: string
  stripeCustomerId: string
  paymentIntentId?: string
  checkoutSessionId?: string
  subscriptionId?: string
  invoiceId?: string
  paymentStatus: PaymentStatus
  paymentType: PaymentType
  amount: number
  currency: string
  productName?: string
  productDescription?: string
  priceId?: string
  pointsAmount?: number
  pointsType?: string
  subscriptionPlan?: string
  subscriptionPeriodStart?: Date
  subscriptionPeriodEnd?: Date
  refundAmount?: number
  refundReason?: string
  refundedAt?: Date
  metadata?: string
  webhookEventId?: string
  createdAt: Date
  updatedAt: Date
}

// 创建支付记录
export async function createPaymentRecord(data: {
  userId: string
  stripeCustomerId: string
  paymentIntentId?: string
  checkoutSessionId?: string
  subscriptionId?: string
  invoiceId?: string
  paymentStatus: PaymentStatus
  paymentType: PaymentType
  amount: number
  currency?: string
  productName?: string
  productDescription?: string
  priceId?: string
  pointsAmount?: number
  pointsType?: string
  subscriptionPlan?: string
  subscriptionPeriodStart?: Date
  subscriptionPeriodEnd?: Date
  metadata?: unknown
  webhookEventId?: string
}) {
  try {
    const paymentRecord = await db.insert(stripePayments).values({
      id: uuidv4(),
      userId: data.userId,
      stripeCustomerId: data.stripeCustomerId,
      paymentIntentId: data.paymentIntentId,
      checkoutSessionId: data.checkoutSessionId,
      subscriptionId: data.subscriptionId,
      invoiceId: data.invoiceId,
      paymentStatus: data.paymentStatus,
      paymentType: data.paymentType,
      amount: data.amount,
      currency: data.currency || 'usd',
      productName: data.productName,
      productDescription: data.productDescription,
      priceId: data.priceId,
      pointsAmount: data.pointsAmount,
      pointsType: data.pointsType,
      subscriptionPlan: data.subscriptionPlan,
      subscriptionPeriodStart: data.subscriptionPeriodStart,
      subscriptionPeriodEnd: data.subscriptionPeriodEnd,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      webhookEventId: data.webhookEventId,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning()

    return paymentRecord[0]
  } catch (error) {
    console.error('创建支付记录失败:', error)
    throw error
  }
}

/**
 * 原子认领支付记录（claim-first，F10 计费幂等）。
 * 以 paymentIntentId / checkoutSessionId 唯一索引为锁插入一条 pending 记录：
 * 并发重复投递时冲突方返回 null（调用方直接跳过发放）；
 * 记录已处于终态（succeeded/failed）同样返回 null。
 * 残余风险（已记录于文档）：处理中崩溃会留下 pending 行，可审计人工补偿。
 */
export async function claimPaymentRecord(data: {
  userId: string
  stripeCustomerId: string
  paymentIntentId?: string
  checkoutSessionId?: string
  paymentType: PaymentType
}): Promise<{ id: string } | null> {
  const inserted = await db
    .insert(stripePayments)
    .values({
      id: uuidv4(),
      userId: data.userId,
      stripeCustomerId: data.stripeCustomerId,
      paymentIntentId: data.paymentIntentId,
      checkoutSessionId: data.checkoutSessionId,
      paymentStatus: PaymentStatus.PENDING,
      paymentType: data.paymentType,
      amount: 0,
      currency: 'usd',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: stripePayments.id })

  return inserted.length > 0 ? { id: inserted[0].id } : null
}

/** 认领后补全支付记录（终态与明细），仅更新提供的字段 */
export async function completePaymentRecord(
  paymentId: string,
  data: {
    paymentStatus: PaymentStatus
    amount?: number
    currency?: string
    subscriptionId?: string
    invoiceId?: string
    productName?: string
    productDescription?: string
    priceId?: string
    pointsAmount?: number
    pointsType?: string
    subscriptionPlan?: string
    subscriptionPeriodStart?: Date
    subscriptionPeriodEnd?: Date
    metadata?: unknown
    webhookEventId?: string
  }
) {
  const updated = await db
    .update(stripePayments)
    .set({
      paymentStatus: data.paymentStatus,
      amount: data.amount,
      currency: data.currency,
      subscriptionId: data.subscriptionId,
      invoiceId: data.invoiceId,
      productName: data.productName,
      productDescription: data.productDescription,
      priceId: data.priceId,
      pointsAmount: data.pointsAmount,
      pointsType: data.pointsType,
      subscriptionPlan: data.subscriptionPlan,
      subscriptionPeriodStart: data.subscriptionPeriodStart,
      subscriptionPeriodEnd: data.subscriptionPeriodEnd,
      metadata: data.metadata ? JSON.stringify(data.metadata) : undefined,
      webhookEventId: data.webhookEventId,
      updatedAt: new Date(),
    })
    .where(eq(stripePayments.id, paymentId))
    .returning({ id: stripePayments.id })
  return updated[0] ?? null
}

// 更新支付记录
export async function updatePaymentRecord(
  paymentId: string,
  updates: Partial<{
    paymentStatus: PaymentStatus
    refundAmount: number
    refundReason: string
    refundedAt: Date
    metadata: unknown
  }>
) {
  try {
    const updateData: Partial<NewStripePayment> = {
      paymentStatus: updates.paymentStatus,
      refundAmount: updates.refundAmount,
      refundReason: updates.refundReason,
      refundedAt: updates.refundedAt,
      updatedAt: new Date(),
    }

    if (updates.metadata) {
      updateData.metadata = JSON.stringify(updates.metadata)
    }

    const updatedRecord = await db
      .update(stripePayments)
      .set(updateData)
      .where(eq(stripePayments.id, paymentId))
      .returning()

    return updatedRecord[0]
  } catch (error) {
    console.error('更新支付记录失败:', error)
    throw error
  }
}

// 获取用户的支付记录
export async function getUserPaymentHistory(
  userId: string,
  options: {
    limit?: number
    offset?: number
    paymentType?: PaymentType
    paymentStatus?: PaymentStatus
  } = {}
) {
  try {
    const { limit = 50, offset = 0, paymentType, paymentStatus } = options

    // 构建查询条件
    let whereConditions = [eq(stripePayments.userId, userId)]
    
    if (paymentType) {
      whereConditions.push(eq(stripePayments.paymentType, paymentType))
    }
    
    if (paymentStatus) {
      whereConditions.push(eq(stripePayments.paymentStatus, paymentStatus))
    }

    const payments = await db
      .select()
      .from(stripePayments)
      .where(and(...whereConditions))
      .orderBy(desc(stripePayments.createdAt))
      .limit(limit)
      .offset(offset)

    return payments.map(payment => ({
      ...payment,
      metadata: payment.metadata ? JSON.parse(payment.metadata) : null
    }))
  } catch (error) {
    console.error('获取用户支付记录失败:', error)
    throw error
  }
}

// 获取单个支付记录
export async function getPaymentRecord(paymentId: string) {
  try {
    const payment = await db
      .select()
      .from(stripePayments)
      .where(eq(stripePayments.id, paymentId))
      .limit(1)

    if (payment.length === 0) {
      return null
    }

    return {
      ...payment[0],
      metadata: payment[0].metadata ? JSON.parse(payment[0].metadata) : null
    }
  } catch (error) {
    console.error('获取支付记录失败:', error)
    throw error
  }
}

// 根据Stripe ID获取支付记录
export async function getPaymentByStripeId(stripeId: string, type: 'payment_intent' | 'session' | 'subscription') {
  try {
    let whereCondition
    
    switch (type) {
      case 'payment_intent':
        whereCondition = eq(stripePayments.paymentIntentId, stripeId)
        break
      case 'session':
        whereCondition = eq(stripePayments.checkoutSessionId, stripeId)
        break
      case 'subscription':
        whereCondition = eq(stripePayments.subscriptionId, stripeId)
        break
      default:
        throw new Error('Invalid stripe ID type')
    }

    const payment = await db
      .select()
      .from(stripePayments)
      .where(whereCondition)
      .limit(1)

    if (payment.length === 0) {
      return null
    }

    return {
      ...payment[0],
      metadata: payment[0].metadata ? JSON.parse(payment[0].metadata) : null
    }
  } catch (error) {
    console.error('根据Stripe ID获取支付记录失败:', error)
    throw error
  }
}

// 获取用户支付统计
export async function getUserPaymentStats(userId: string) {
  try {
    const stats = await db
      .select({
        totalPayments: sql<number>`count(*)`,
        totalAmount: sql<number>`sum(${stripePayments.amount})`,
        totalPointsPurchased: sql<number>`
          coalesce(sum(
            case 
              when ${stripePayments.pointsType} = 'purchased' 
                then ${stripePayments.pointsAmount} 
              else 0 
            end
          ), 0)
        `,
        totalPointsGifted: sql<number>`
          coalesce(sum(
            case 
              when ${stripePayments.pointsType} = 'gifted' 
                then ${stripePayments.pointsAmount} 
              else 0 
            end
          ), 0)
        `,
        successfulPayments: sql<number>`count(case when ${stripePayments.paymentStatus} = 'succeeded' then 1 end)`,
        failedPayments: sql<number>`count(case when ${stripePayments.paymentStatus} = 'failed' then 1 end)`,
        refundedPayments: sql<number>`count(case when ${stripePayments.paymentStatus} = 'refunded' then 1 end)`,
        subscriptionPayments: sql<number>`count(case when ${stripePayments.paymentType} = 'subscription' then 1 end)`,
        pointsPayments: sql<number>`count(case when ${stripePayments.paymentType} = 'points_purchase' then 1 end)`,
      })
      .from(stripePayments)
      .where(eq(stripePayments.userId, userId))

    return stats[0] || {
      totalPayments: 0,
      totalAmount: 0,
      totalPointsPurchased: 0,
      totalPointsGifted: 0,
      successfulPayments: 0,
      failedPayments: 0,
      refundedPayments: 0,
      subscriptionPayments: 0,
      pointsPayments: 0,
    }
  } catch (error) {
    console.error('获取用户支付统计失败:', error)
    throw error
  }
}

// 获取用户最近的支付记录
export async function getUserRecentPayments(userId: string, limit: number = 5) {
  try {
    const payments = await db
      .select()
      .from(stripePayments)
      .where(eq(stripePayments.userId, userId))
      .orderBy(desc(stripePayments.createdAt))
      .limit(limit)

    return payments.map(payment => ({
      ...payment,
      metadata: payment.metadata ? JSON.parse(payment.metadata) : null
    }))
  } catch (error) {
    console.error('获取用户最近支付记录失败:', error)
    throw error
  }
} 