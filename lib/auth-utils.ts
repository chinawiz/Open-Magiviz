import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import type { NextRequest } from 'next/server'

// 仅被 isAdmin 内部使用，不对外暴露
async function getCurrentUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return null
  }

  const user = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1)

  return user[0] || null
}

export async function isAdmin() {
  const user = await getCurrentUser()
  return user?.role === 'admin'
}

export async function requireAdmin() {
  const admin = await isAdmin()
  if (!admin) {
    redirect('/zh/unauthorized')
  }
  return true
}

// 从代理头链中解析客户端真实 IP（x-forwarded-for → x-real-ip → cf-connecting-ip），
// 供邮件发送频率限制使用。原先在 register / forgot-password / resend-verification
// 三个路由各有一份逐字相同的拷贝，此处收敛为单一事实。
export function getClientIP(request: NextRequest): string | undefined {
  const forwarded = request.headers.get('x-forwarded-for')
  const realIP = request.headers.get('x-real-ip')
  const cfConnectingIP = request.headers.get('cf-connecting-ip') // Cloudflare

  if (cfConnectingIP) return cfConnectingIP
  if (realIP) return realIP
  if (forwarded) return forwarded.split(',')[0].trim()

  return undefined
}
