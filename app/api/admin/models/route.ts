import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { requireAdminUser, getClientIP } from '@/lib/auth-utils'
import { recordAdminAudit, sanitizeAuditSnapshot } from '@/lib/admin-audit'
import { getFallbackStats } from '@/lib/fallback-stats'
import {
  listEndpoints,
  createEndpoint,
  updateEndpoint,
  setEndpointEnabled,
  deleteEndpoint,
  toPublicEndpoint,
  validateEndpointPayload,
  hasOtherEnabled,
  type EndpointPayload,
} from '@/lib/providers/endpoints'

/**
 * /api/admin/models —— 自建端点管理（ADR-0001）。
 * GET    列表（key 永远只以掩码出现）+ 近 7 日回退统计
 * POST   创建；PUT 更新（apiKey 留空 = 保留原 key）；PATCH 启停；DELETE 删除
 * 写操作审计先行（fail-closed），targetType=model_config；任何响应不含完整 key。
 */

const AUDIT_TARGET = 'model_config' as const

export async function GET() {
  const adminUser = await requireAdminUser()
  if (!adminUser) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }
  try {
    const [endpoints, fallbackStats] = await Promise.all([listEndpoints(), getFallbackStats(7)])
    return NextResponse.json({ endpoints: endpoints.map(toPublicEndpoint), fallbackStats })
  } catch (error) {
    console.error('Admin models GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function auditAndRespond(
  request: NextRequest,
  adminUserId: string,
  action: string,
  targetId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  op: () => Promise<unknown>,
): Promise<NextResponse> {
  // 审计先行（fail-closed）：after 快照过 sanitize（apiKey 已在敏感键清单）
  await recordAdminAudit({
    adminUserId,
    action,
    targetType: AUDIT_TARGET,
    targetId,
    before: sanitizeAuditSnapshot(before),
    after: sanitizeAuditSnapshot(after),
    ip: getClientIP(request),
  })
  const row = await op()
  // toPublicEndpoint 单点掩码映射（契约测试守卫：输出永不含 apiKey）
  return NextResponse.json({ endpoint: toPublicEndpoint(row as NonNullable<Awaited<ReturnType<typeof updateEndpoint>>>) })
}

export async function POST(request: NextRequest) {
  const adminUser = await requireAdminUser()
  if (!adminUser) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }
  try {
    const body = await request.json()
    const validated = validateEndpointPayload(body, { requireApiKey: true })
    if (!validated.ok || !validated.value) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }

    const duplicates = (await listEndpoints()).filter(
      e => e.capability === validated.value!.capability && e.enabled,
    )
    if (duplicates.length > 0 && validated.value.enabled) {
      return NextResponse.json(
        { error: `capability ${validated.value.capability} 已有启用中的自建端点（每步同时只能启用一个）` },
        { status: 409 },
      )
    }

    // 审计先行需要真实 targetId，故 id 预生成
    const newId = uuidv4()
    return await auditAndRespond(request, adminUser.id, 'create_model_endpoint', newId, null,
      snapshotOf(validated.value),
      () => createEndpoint(validated.value!, newId),
    )
  } catch (error) {
    console.error('Admin models POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const adminUser = await requireAdminUser()
  if (!adminUser) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }
  try {
    const body = await request.json()
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) {
      return NextResponse.json({ error: 'id 是必需的' }, { status: 400 })
    }
    const validated = validateEndpointPayload(body, { requireApiKey: false })
    if (!validated.ok || !validated.value) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }

    const endpoints = await listEndpoints()
    const before = endpoints.find(e => e.id === id)
    if (!before) {
      return NextResponse.json({ error: '端点不存在' }, { status: 404 })
    }
    const conflict = endpoints.find(
      e => e.id !== id && e.capability === validated.value!.capability && e.enabled && validated.value!.enabled,
    )
    if (conflict) {
      return NextResponse.json(
        { error: `capability ${validated.value.capability} 已有启用中的自建端点` },
        { status: 409 },
      )
    }

    return await auditAndRespond(request, adminUser.id, 'update_model_endpoint', id,
      snapshotOf(before), snapshotOf(validated.value),
      () => updateEndpoint(id, validated.value!),
    )
  } catch (error) {
    console.error('Admin models PUT error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const adminUser = await requireAdminUser()
  if (!adminUser) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }
  try {
    const body = await request.json()
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id || typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'id 与 enabled(boolean) 是必需的' }, { status: 400 })
    }
    const endpoints = await listEndpoints()
    const before = endpoints.find(e => e.id === id)
    if (!before) {
      return NextResponse.json({ error: '端点不存在' }, { status: 404 })
    }
    // 唯一启用约束前置检查（撞 cap_enabled 唯一索引会 500，这里给 409）
    if (body.enabled && hasOtherEnabled(endpoints, before.capability, id)) {
      return NextResponse.json(
        { error: `capability ${before.capability} 已有启用中的自建端点` },
        { status: 409 },
      )
    }

    return await auditAndRespond(request, adminUser.id, body.enabled ? 'enable_model_endpoint' : 'disable_model_endpoint', id,
      { enabled: before.enabled }, { enabled: body.enabled },
      () => setEndpointEnabled(id, body.enabled),
    )
  } catch (error) {
    console.error('Admin models PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const adminUser = await requireAdminUser()
  if (!adminUser) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }
  try {
    const id = new URL(request.url).searchParams.get('id') || ''
    if (!id) {
      return NextResponse.json({ error: 'id 是必需的' }, { status: 400 })
    }
    const before = (await listEndpoints()).find(e => e.id === id)
    if (!before) {
      return NextResponse.json({ error: '端点不存在' }, { status: 404 })
    }

    return await auditAndRespond(request, adminUser.id, 'delete_model_endpoint', id,
      snapshotOf(before), null,
      async () => {
        await deleteEndpoint(id)
        return before
      },
    )
  } catch (error) {
    console.error('Admin models DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** 审计快照：剥离 apiKey（SENSITIVE_KEYS 双保险），只留业务字段 */
function snapshotOf(value: Record<string, unknown> | EndpointPayload | undefined): Record<string, unknown> | null {
  if (!value) return null
  const { apiKey: _apiKey, ...rest } = value as Record<string, unknown>
  return rest
}
