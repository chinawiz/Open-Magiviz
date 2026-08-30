import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { aiGenerationTasks, users } from '@/lib/schema'
import { eq, desc, like, and } from 'drizzle-orm'
import { requireAdminUser, getClientIP } from '@/lib/auth-utils'
import { recordAdminAudit } from '@/lib/admin-audit'
import { settleStaleTask, zombieCutoff } from '@/lib/task-compensate'

// 单次返回上限（单人运营面板，无分页足够用）
const LIST_LIMIT = 50

export async function GET(request: NextRequest) {
  try {
    const adminUser = await requireAdminUser()
    if (!adminUser) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const email = (searchParams.get('email') || '').trim()
    const status = searchParams.get('status') || ''

    const conditions = []
    if (email) {
      conditions.push(like(users.email, `%${email}%`))
    }
    if (status && ['pending', 'success', 'failed'].includes(status)) {
      conditions.push(eq(aiGenerationTasks.status, status))
    }

    const tasks = await db
      .select({
        id: aiGenerationTasks.id,
        taskId: aiGenerationTasks.taskId,
        taskType: aiGenerationTasks.taskType,
        model: aiGenerationTasks.model,
        status: aiGenerationTasks.status,
        pointsDeducted: aiGenerationTasks.pointsDeducted,
        pointsAmount: aiGenerationTasks.pointsAmount,
        createdAt: aiGenerationTasks.createdAt,
        updatedAt: aiGenerationTasks.updatedAt,
        userId: users.id,
        userEmail: users.email,
        userName: users.name,
      })
      .from(aiGenerationTasks)
      .innerJoin(users, eq(aiGenerationTasks.userId, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(aiGenerationTasks.createdAt))
      .limit(LIST_LIMIT)

    return NextResponse.json({ tasks })
  } catch (error) {
    console.error('Admin tasks API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// 手动补偿：对 pending 任务按供应商终态结算一次（复用补偿 cron 的唯一实现）
export async function POST(request: NextRequest) {
  try {
    const adminUser = await requireAdminUser()
    if (!adminUser) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const { taskId } = await request.json()
    if (!taskId) {
      return NextResponse.json({ error: 'taskId 是必需的' }, { status: 400 })
    }

    const taskRows = await db
      .select()
      .from(aiGenerationTasks)
      .where(eq(aiGenerationTasks.taskId, taskId))
      .limit(1)

    if (taskRows.length === 0) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    const task = taskRows[0]
    if (task.status !== 'pending') {
      return NextResponse.json(
        { error: `任务已终态（${task.status}），无需补偿` },
        { status: 400 }
      )
    }

    // 审计先行：补偿可能补扣积分（金钱路径），先落审计行、失败即中止
    await recordAdminAudit({
      adminUserId: adminUser.id,
      action: 'settle_task',
      targetType: 'task',
      targetId: task.taskId,
      before: { status: task.status, pointsDeducted: task.pointsDeducted },
      after: { requestedBy: adminUser.id },
      ip: getClientIP(request),
    })

    const result = await settleStaleTask(task, zombieCutoff())

    return NextResponse.json({
      message: `补偿执行完成：${result}`,
      result,
    })
  } catch (error) {
    console.error('Admin task settle error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
