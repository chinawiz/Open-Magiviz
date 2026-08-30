import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Session } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/schema'
import { eq } from 'drizzle-orm'

/**
 * 获取已登录会话；未登录（无 user.id）或账号已被封禁（users.bannedAt 非空）时返回 null。
 * 用于替代各路由中重复的 getServerSession + 401 判断。
 *
 * 封禁在唯一会话入口收敛（docs/admin-plan.md 裁决：用户级封禁=停用账号），
 * 46 个消费者零改动即全覆盖；代价是每次鉴权多一次主键查询。
 */
export async function getAuthedSession(): Promise<Session | null> {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) {
    return null
  }

  const rows = await db
    .select({ bannedAt: users.bannedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (rows[0]?.bannedAt) {
    console.warn(`[auth] banned user blocked: ${userId}`)
    return null
  }

  return session
}

/** 统一的错误响应封装 */
export function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json(extra ? { error, ...extra } : { error }, { status })
}

/** 统一的成功响应封装 */
export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json(data, { status })
}
