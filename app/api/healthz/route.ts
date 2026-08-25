import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Liveness 探活：仅确认函数可服务，不检查依赖 */
export async function GET() {
  return NextResponse.json({ status: 'ok' })
}
