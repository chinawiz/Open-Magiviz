import { NextRequest, NextResponse } from 'next/server'
import { getAuthedSession, jsonError } from '@/lib/api'
import { updateAffiliateCode } from '@/lib/affiliate'

/**
 * 更新推广码（只能修改一次）
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getAuthedSession()
    
    if (!session) {
      return jsonError(401, 'Unauthorized')
    }

    const { code } = await request.json()

    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { error: 'CODE_EMPTY' },
        { status: 400 }
      )
    }

    const result = await updateAffiliateCode(session.user.id, code)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'UPDATE_FAILED' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      code: result.code,
    })
  } catch (error) {
    console.error('Failed to update affiliate code:', error)
    return NextResponse.json(
      { error: 'UPDATE_FAILED' },
      { status: 500 }
    )
  }
}


