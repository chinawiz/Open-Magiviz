import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { aiGenerationTasks } from '@/lib/schema'
import { gte } from 'drizzle-orm'
import { isAdmin } from '@/lib/auth-utils'
import { computeModelHealth, type HealthTaskRow } from '@/lib/pricing-health'

/**
 * 定价健康端点（管理员）：按模型聚合失败率与预估毛利（视频+图片）。
 * 制度化对账用——失败损耗超过底线假设（1.7×）或预估毛利不足 100% 的模型
 * 会带 warning 返回。成本口径见 lib/pricing-health.ts。
 * 历史行无 model 字段时归入 unknown 桶（只计收入不计成本）。
 */
export async function GET(request: NextRequest) {
  try {
    const adminAccess = await isAdmin()
    if (!adminAccess) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const days = Math.min(Math.max(Number(searchParams.get('days')) || 30, 1), 365)
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const rows = await db
      .select({
        model: aiGenerationTasks.model,
        status: aiGenerationTasks.status,
        pointsDeducted: aiGenerationTasks.pointsDeducted,
        pointsAmount: aiGenerationTasks.pointsAmount,
      })
      .from(aiGenerationTasks)
      .where(gte(aiGenerationTasks.createdAt, since))

    const report = computeModelHealth(rows as HealthTaskRow[])

    return NextResponse.json({
      days,
      generatedAt: new Date().toISOString(),
      ...report,
    })
  } catch (error) {
    console.error('[pricing-health] 统计失败:', error)
    return NextResponse.json({ error: '统计失败' }, { status: 500 })
  }
}
