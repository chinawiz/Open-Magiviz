import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { selfHostedEndpoints } from '@/lib/schema'
import { requireAdminUser } from '@/lib/auth-utils'
import { probeEndpoint } from '@/lib/providers/local'

/**
 * POST /api/admin/models/test —— 自建端点「测试连接」（ADR-0001）。
 * 零成本探活（GET {baseUrl}/models，不真出图不烧 token）；
 * 带已保存 id 时把结果回写 lastTestAt/lastTestOk；也支持对未保存的表单配置直接探测。
 */
export async function POST(request: NextRequest) {
  const adminUser = await requireAdminUser()
  if (!adminUser) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }
  try {
    const body = await request.json()
    const id = typeof body?.id === 'string' ? body.id : ''

    let config: { baseUrl: string; apiKey: string; modelId: string; timeoutMs: number } | null = null

    if (id) {
      const [row] = await db.select().from(selfHostedEndpoints).where(eq(selfHostedEndpoints.id, id)).limit(1)
      if (!row) {
        return NextResponse.json({ error: '端点不存在' }, { status: 404 })
      }
      config = { baseUrl: row.baseUrl, apiKey: row.apiKey, modelId: row.modelId, timeoutMs: row.timeoutMs }
    } else if (
      typeof body?.baseUrl === 'string' && typeof body?.apiKey === 'string' && typeof body?.modelId === 'string'
    ) {
      // 未保存配置的即时探测（表单场景）；key 不落日志不回显
      config = {
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
        modelId: body.modelId,
        timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : 10000,
      }
    } else {
      return NextResponse.json({ error: '需要 id 或完整的 baseUrl/apiKey/modelId' }, { status: 400 })
    }

    const result = await probeEndpoint(config)

    if (id) {
      await db
        .update(selfHostedEndpoints)
        .set({ lastTestAt: new Date(), lastTestOk: result.ok, updatedAt: new Date() })
        .where(eq(selfHostedEndpoints.id, id))
    }

    return NextResponse.json({
      ok: result.ok,
      latencyMs: result.latencyMs,
      error: result.error ?? null,
    })
  } catch (error) {
    console.error('Admin models test error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
