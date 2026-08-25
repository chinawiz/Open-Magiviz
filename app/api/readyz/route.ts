import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** Readiness 就绪检查：探依赖（数据库），失败返回 503 供外部拨测摘流 */
export async function GET() {
  try {
    await db.execute(sql`SELECT 1`)
    return NextResponse.json({ status: 'ok', checks: { database: 'ok' } })
  } catch (error) {
    console.error('[readyz] 依赖检查失败:', error)
    return NextResponse.json(
      { status: 'unavailable', checks: { database: 'fail' } },
      { status: 503 },
    )
  }
}
