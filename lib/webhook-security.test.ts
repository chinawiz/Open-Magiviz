import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import type { NextRequest } from 'next/server'

/**
 * webhook-security 契约测试（seam：外部回调验签）。
 * 核心验证生产环境 fail-closed（密钥缺失/签名不符一律 401）与开发环境放行策略。
 * NODE_ENV 在模块顶层求值，因此用 resetModules + stubEnv 分环境加载。
 */

async function loadModule(nodeEnv: string) {
  vi.resetModules()
  vi.stubEnv('NODE_ENV', nodeEnv)
  return await import('./webhook-security')
}

function kieSignature(taskId: string, timestamp: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(`${taskId}.${timestamp}`).digest('base64')
}

const fakeRequest = (token: string | null) =>
  ({
    nextUrl: { searchParams: { get: () => token } },
  }) as unknown as NextRequest

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('verifyKieWebhook（Kie 系回调验签）', () => {
  it('签名正确 → 通过（返回 null）', async () => {
    const mod = await loadModule('production')
    const taskId = 'tid-1'
    const timestamp = '1725300000'
    const sig = kieSignature(taskId, timestamp, 'shared-secret')
    expect(
      mod.verifyKieWebhook({ taskId, timestamp, signature: sig, secret: 'shared-secret', label: 'test' }),
    ).toBeNull()
  })

  it('生产环境密钥缺失 → fail-closed 401（关键安全属性）', async () => {
    const mod = await loadModule('production')
    const rejection = mod.verifyKieWebhook({
      taskId: 'tid-1',
      timestamp: '1725300000',
      signature: 'whatever',
      secret: undefined,
      label: 'test',
    })
    expect(rejection).toEqual({ status: 401, error: 'Webhook signature not configured' })
  })

  it('开发环境密钥缺失 → 放行（本地联调策略）', async () => {
    const mod = await loadModule('development')
    expect(
      mod.verifyKieWebhook({
        taskId: 'tid-1',
        timestamp: '1725300000',
        signature: null,
        secret: undefined,
        label: 'test',
      }),
    ).toBeNull()
  })

  it('生产环境缺少签名头 → 401', async () => {
    const mod = await loadModule('production')
    const rejection = mod.verifyKieWebhook({
      taskId: 'tid-1',
      timestamp: null,
      signature: null,
      secret: 'shared-secret',
      label: 'test',
    })
    expect(rejection).toEqual({ status: 401, error: 'Missing signature headers' })
  })

  it('签名不符（篡改 taskId/密钥不匹配）→ 401', async () => {
    const mod = await loadModule('production')
    const rejection = mod.verifyKieWebhook({
      taskId: 'tid-evil',
      timestamp: '1725300000',
      signature: kieSignature('tid-1', '1725300000', 'shared-secret'),
      secret: 'shared-secret',
      label: 'test',
    })
    expect(rejection).toEqual({ status: 401, error: 'Invalid signature' })
  })
})

describe('verifyFalWebhookToken（FAL 回调共享 token）', () => {
  it('生产环境 token 未配置 → fail-closed 401', async () => {
    const mod = await loadModule('production')
    const rejection = mod.verifyFalWebhookToken(fakeRequest(null))
    expect(rejection).toEqual({ status: 401, error: 'Webhook token not configured' })
  })

  it('token 正确 → 通过；token 错误 → 401', async () => {
    vi.stubEnv('FAL_WEBHOOK_TOKEN_SECRET', 'callback-token')
    const mod = await loadModule('production')
    expect(mod.verifyFalWebhookToken(fakeRequest('callback-token'))).toBeNull()
    expect(mod.verifyFalWebhookToken(fakeRequest('wrong'))).toEqual({ status: 401, error: 'Invalid webhook token' })
  })
})

describe('withFalWebhookToken（提交时附加回调 token）', () => {
  it('无 url / 无密钥时原样返回', async () => {
    const mod = await loadModule('development')
    expect(mod.withFalWebhookToken(undefined)).toBeUndefined()
    expect(mod.withFalWebhookToken('https://example.com/hook')).toBe('https://example.com/hook')
  })

  it('有密钥时按 ?/& 正确拼接 token', async () => {
    vi.stubEnv('FAL_WEBHOOK_TOKEN_SECRET', 'cb secret/特殊')
    const mod = await loadModule('development')
    expect(mod.withFalWebhookToken('https://example.com/hook')).toBe(
      `https://example.com/hook?token=${encodeURIComponent('cb secret/特殊')}`,
    )
    expect(mod.withFalWebhookToken('https://example.com/hook?a=1')).toBe(
      `https://example.com/hook?a=1&token=${encodeURIComponent('cb secret/特殊')}`,
    )
  })
})
