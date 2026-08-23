import { NextRequest, NextResponse } from 'next/server'
import { getAuthedSession, jsonError } from '@/lib/api'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthedSession()
    
    if (!session) {
      return jsonError(401, '未授权访问')
    }

    // 获取用户的关联账户信息
    const accounts = await db.query.accounts.findMany({
      where: (accounts, { eq }) => eq(accounts.userId, session.user.id),
    })

    const connectedAccounts = [
      {
        provider: 'github',
        connected: accounts.some(acc => acc.provider === 'github'),
      },
      {
        provider: 'google',
        connected: accounts.some(acc => acc.provider === 'google'),
      },
    ]

    return NextResponse.json({
      success: true,
      accounts: connectedAccounts,
    })
  } catch (error) {
    console.error('获取关联账户失败:', error)
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    )
  }
} 