import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// /api/admin/models 路由契约：非 admin 一律 403；任何响应（含错误）不出现完整 apiKey；
// 每 capability 唯一启用约束前置检查（409 而非撞唯一索引 500）。

const state = vi.hoisted(() => ({
  endpoints: [] as Array<Record<string, unknown>>,
  stats: [] as Array<Record<string, unknown>>,
  inserted: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/auth-utils', () => ({
  requireAdminUser: vi.fn(async () => ({ id: 'admin-1' })),
  getClientIP: vi.fn(() => '127.0.0.1'),
  isAdmin: vi.fn(async () => true),
}))

vi.mock('@/lib/db', async () => {
  const { selfHostedEndpoints, funnelEvents } = await import('@/lib/schema')
  const chainFor = (table: unknown) => ({
    orderBy: vi.fn(async () => (table === selfHostedEndpoints ? [...state.endpoints] : [...state.stats])),
    where: vi.fn(() => ({
      groupBy: vi.fn(async () => [...state.stats]),
      limit: vi.fn(async () => (table === selfHostedEndpoints ? [...state.endpoints] : [...state.stats])),
    })),
  })
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => chainFor(table)),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => {
          state.inserted = values
          return {
            returning: vi.fn(async () => [{ ...values }]),
            onConflictDoUpdate: vi.fn(async () => {}),
          }
        }),
      })),
      // funnelEvents 表用于 groupBy 判别的同一性兜底
      __tables: { selfHostedEndpoints, funnelEvents },
    },
  }
})

vi.mock('@/lib/admin-audit', () => ({
  recordAdminAudit: vi.fn(async () => {}),
  sanitizeAuditSnapshot: vi.fn((s: Record<string, unknown> | null) => s),
}))

import { GET, POST, PATCH } from './route'
import { requireAdminUser } from '@/lib/auth-utils'

const fullKey = 'sk-live-super-secret-9999'
const endpointRow = {
  id: 'ep-1',
  capability: 'script',
  protocol: 'openai-chat',
  baseUrl: 'http://dgx:8000/v1',
  apiKey: fullKey,
  modelId: 'glm-5',
  timeoutMs: 60000,
  enabled: true,
  lastTestAt: null,
  lastTestOk: null,
  note: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

// 路由只用到 request.json()/url；构造 NextRequest 兼容形状即可
const req = (url: string, init?: RequestInit) => new Request(url, init) as unknown as NextRequest

beforeEach(() => {
  state.endpoints = []
  state.stats = []
  state.inserted = null
  vi.mocked(requireAdminUser).mockClear().mockResolvedValue({ id: 'admin-1' } as never)
})

describe('GET /api/admin/models', () => {
  it('非 admin → 403', async () => {
    vi.mocked(requireAdminUser).mockResolvedValue(null as never)
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('admin → 端点只含掩码（完整 key 不出现在任何响应字节里）+ 回退统计', async () => {
    state.endpoints = [endpointRow]
    state.stats = [{ stage: 'script', capability: 'script', count: 2, lastAt: new Date() }]

    const res = await GET()
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain(fullKey)
    expect(text).toContain('****9999')
    const body = JSON.parse(text)
    expect(body.endpoints[0]).not.toHaveProperty('apiKey')
    expect(body.fallbackStats).toHaveLength(1)
  })
})

describe('POST /api/admin/models', () => {
  it('非 admin → 403，且不发生任何写入', async () => {
    vi.mocked(requireAdminUser).mockResolvedValue(null as never)
    const res = await POST(req('http://localhost/api/admin/models', {
      method: 'POST',
      body: JSON.stringify({ capability: 'script', protocol: 'openai-chat', baseUrl: 'http://x/v1', modelId: 'm', apiKey: 'sk-1' }),
    }))
    expect(res.status).toBe(403)
    expect(state.inserted).toBeNull()
  })

  it('每 capability 唯一启用：撞已有启用端点 → 409（完整 key 不出现在错误响应）', async () => {
    state.endpoints = [endpointRow]
    const res = await POST(req('http://localhost/api/admin/models', {
      method: 'POST',
      body: JSON.stringify({ capability: 'script', protocol: 'openai-chat', baseUrl: 'http://y/v1', modelId: 'm', apiKey: fullKey, enabled: true }),
    }))
    expect(res.status).toBe(409)
    const text = await res.text()
    expect(text).not.toContain(fullKey)
  })

  it('admin 创建成功 → 响应只含掩码', async () => {
    const res = await POST(req('http://localhost/api/admin/models', {
      method: 'POST',
      body: JSON.stringify({ capability: 'image', protocol: 'openai-images', baseUrl: 'http://y/v1', modelId: 'flux2', apiKey: fullKey, timeoutMs: 120000 }),
    }))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain(fullKey)
    expect(text).toContain('****9999')
  })
})

describe('PATCH /api/admin/models', () => {
  it('启用时已有其他启用端点 → 409', async () => {
    state.endpoints = [{ ...endpointRow, id: 'ep-2', capability: 'image', enabled: true }, { ...endpointRow, id: 'ep-3', capability: 'image', enabled: false }]
    const res = await PATCH(req('http://localhost/api/admin/models', {
      method: 'PATCH',
      body: JSON.stringify({ id: 'ep-3', enabled: true }),
    }))
    expect(res.status).toBe(409)
  })
})
