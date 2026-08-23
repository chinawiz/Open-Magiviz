import { NextResponse } from 'next/server'
import { getAuthedSession, jsonError } from '@/lib/api'
import { getUserPointsDetail } from '@/lib/points-manager'

export async function GET() {
  try {
    const session = await getAuthedSession()
    
    if (!session) {
      return jsonError(401, 'Unauthorized')
337}

    const pointsDetail = await getUserPointsDetail(session.user.id)
    
    return NextResponse.json(pointsDetail)
  } catch (error) {
    console.error('获取用户积分详情失败:', error)
    return NextResponse.json(
      { error: '获取积分详情失败' },
      { status: 500 }
    )
  }
} 