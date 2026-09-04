import { describe, it, expect, beforeEach, vi } from 'vitest'

// endpoints.ts 顶层引入 lib/db（无合法 DATABASE_URL 即抛）——测试只需类型与纯函数 + doMock，哑 env（neon 格式合法串，不真连）放行模块加载
vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://user:pass@example.com/db?sslmode=require'
})

import {
  maskApiKey,
  toPublicEndpoint,
  validateEndpointPayload,
  type SelfHostedEndpoint,
} from './endpoints'

// key 安全契约：任何对外映射只含掩码；payload 校验与「留空保留原 key」语义。

const row: SelfHostedEndpoint = {
  id: 'ep-1',
  capability: 'script',
  protocol: 'openai-chat',
  baseUrl: 'http://dgx:8000/v1',
  apiKey: 'sk-live-abcdef1234',
  modelId: 'glm-5',
  timeoutMs: 60000,
  enabled: true,
  lastTestAt: null,
  lastTestOk: null,
  note: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

beforeEach(() => vi.resetModules())

describe('maskApiKey', () => {
  it('只露末 4 位', () => {
    expect(maskApiKey('sk-live-abcdef1234')).toBe('****1234')
  })
  it('长度 ≤4 全掩码（不泄露长度信息之外的内容）', () => {
    expect(maskApiKey('abc')).toBe('****')
    expect(maskApiKey('')).toBe('****')
  })
})

describe('toPublicEndpoint（key 泄漏契约守卫）', () => {
  it('输出不含 apiKey 字段，只含 apiKeyMasked', () => {
    const pub = toPublicEndpoint(row) as Record<string, unknown>
    expect(pub).not.toHaveProperty('apiKey')
    expect(JSON.stringify(pub)).not.toContain('sk-live-abcdef1234')
    expect(pub.apiKeyMasked).toBe('****1234')
  })
})

describe('validateEndpointPayload', () => {
  it('合法 payload 通过，baseUrl 去尾斜杠、timeoutMs 夹取到 1s–10min', () => {
    const result = validateEndpointPayload({
      capability: 'script',
      protocol: 'openai-chat',
      baseUrl: 'http://dgx:8000/v1/',
      modelId: 'glm-5',
      timeoutMs: 999999,
      apiKey: 'sk-1',
    })
    expect(result.ok).toBe(true)
    expect(result.value?.timeoutMs).toBe(600000)
    expect(result.value?.baseUrl).toBe('http://dgx:8000/v1')
  })

  it('非法 capability/protocol/baseUrl/缺失 modelId 拒绝', () => {
    expect(validateEndpointPayload({ capability: 'video', protocol: 'openai-chat', baseUrl: 'http://x/v1', modelId: 'm' }).ok).toBe(false)
    expect(validateEndpointPayload({ capability: 'script', protocol: 'comfy', baseUrl: 'http://x/v1', modelId: 'm' }).ok).toBe(false)
    expect(validateEndpointPayload({ capability: 'script', protocol: 'openai-chat', baseUrl: 'ftp://x', modelId: 'm' }).ok).toBe(false)
    expect(validateEndpointPayload({ capability: 'script', protocol: 'openai-chat', baseUrl: 'http://x/v1', modelId: '' }).ok).toBe(false)
  })

  it('创建时 apiKey 必填；更新时允许留空', () => {
    const base = { capability: 'script', protocol: 'openai-chat', baseUrl: 'http://x/v1', modelId: 'm' }
    expect(validateEndpointPayload(base, { requireApiKey: true }).ok).toBe(false)
    expect(validateEndpointPayload(base, { requireApiKey: false }).ok).toBe(true)
  })
})

describe('updateEndpoint（key 留空保留语义 + modelId 联动路由行）', () => {
  it('apiKey 留空 → set 中保留原 key；enabled 时重同步路由行', async () => {
    const captured: { set: Record<string, unknown> | null } = { set: null }
    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(async () => [row]),
            })),
          })),
        })),
        update: vi.fn(() => ({
          set: vi.fn((set: Record<string, unknown>) => {
            captured.set = set
            return {
              where: vi.fn(() => ({
                returning: vi.fn(async () => [{ ...row, modelId: 'glm-6' }]),
              })),
            }
          }),
        })),
        // updateEndpoint 内部会按 enabled 重调 syncLocalRouteOnEnable（insert 路由行）
        insert: vi.fn(() => ({
          values: vi.fn(() => ({
            onConflictDoUpdate: vi.fn(async () => {}),
          })),
        })),
      },
    }))

    const { updateEndpoint: updateWithMockedDb } = await import('./endpoints')

    const updated = await updateWithMockedDb('ep-1', {
      capability: 'script',
      protocol: 'openai-chat',
      baseUrl: 'http://dgx:8000/v1',
      modelId: 'glm-6',
      timeoutMs: 60000,
      enabled: true,
      note: null,
      apiKey: '',
    })

    expect(updated?.modelId).toBe('glm-6')
    expect(captured.set).toBeTruthy()
    // 留空 key → 保留原值（后台「留空不改」语义）
    expect(captured.set?.apiKey).toBe('sk-live-abcdef1234')
    expect(captured.set?.modelId).toBe('glm-6')
  })
})
