import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Session } from 'next-auth'
import { authOptions } from '@/lib/auth'

/**
 * 获取已登录会话；未登录（无 user.id）时返回 null。
 * 用于替代各路由中重复的 getServerSession + 401 判断。
 */
export async function getAuthedSession(): Promise<Session | null> {
  const session = await getServerSession(authOptions)
  return session?.user?.id ? session : null
}

/** 统一的错误响应封装 */
export function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json(extra ? { error, ...extra } : { error }, { status })
}

/** 统一的成功响应封装 */
export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json(data, { status })
}
