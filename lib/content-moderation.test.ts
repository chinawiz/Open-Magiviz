import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { moderatePrompt, moderationErrorResponse, combineTextsForModeration, MODERATION_MAX_CHARS } from './content-moderation'

/**
 * Creem Moderation API 适配层契约测试（seam：lib/content-moderation）。
 * 文档硬约束：flag 与 deny 同待遇拦截；超时/5xx/生产缺 key 一律 fail-closed。
 */

const mockFetch = vi.fn()

function creemResponse(decision: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ id: 'mod_1', object: 'moderation_result', decision, usage: { units: 1 } }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mockFetch)
  vi.stubEnv('CREEM_MODERATION_API_KEY', 'creem_test_key')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('moderatePrompt', () => {
  it('allow → 放行；请求体/鉴权头/external_id 符合 Creem 契约', async () => {
    mockFetch.mockResolvedValue(creemResponse('allow'))
    const outcome = await moderatePrompt('一只猫在奔跑', { externalId: 'story-video:u1' })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.creem.io/v1/moderation/prompt')
    expect(init.headers['x-api-key']).toBe('creem_test_key')
    expect(JSON.parse(init.body)).toEqual({ prompt: '一只猫在奔跑', external_id: 'story-video:u1' })
    expect(outcome).toEqual({ ok: true })
  })

  it('flag → 拒绝（与 deny 同待遇，文档要求）', async () => {
    mockFetch.mockResolvedValue(creemResponse('flag'))
    expect(await moderatePrompt('x')).toEqual({ ok: false, code: 'prompt_rejected' })
  })

  it('deny → 拒绝', async () => {
    mockFetch.mockResolvedValue(creemResponse('deny'))
    expect(await moderatePrompt('x')).toEqual({ ok: false, code: 'prompt_rejected' })
  })

  it('HTTP 5xx → fail-closed（moderation_unavailable）', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    expect(await moderatePrompt('x')).toEqual({ ok: false, code: 'moderation_unavailable' })
  })

  it('审核服务超时/不可达 → fail-closed', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'))
    expect(await moderatePrompt('x')).toEqual({ ok: false, code: 'moderation_unavailable' })
  })

  it('生产环境缺 key → fail-closed 且不发请求', async () => {
    vi.unstubAllEnvs()
    vi.stubEnv('CREEM_MODERATION_API_KEY', '')
    vi.stubEnv('NODE_ENV', 'production')
    const outcome = await moderatePrompt('x')
    expect(outcome).toEqual({ ok: false, code: 'moderation_unavailable' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('非生产环境缺 key → 放行（本地开发便利）', async () => {
    vi.unstubAllEnvs()
    vi.stubEnv('CREEM_MODERATION_API_KEY', '')
    const outcome = await moderatePrompt('x')
    expect(outcome).toEqual({ ok: true })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('空文本 → 跳过审核放行（路由层本就拒绝空 prompt，此处兜底）', async () => {
    const outcome = await moderatePrompt('  ')
    expect(outcome).toEqual({ ok: true })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('CREEM_MODERATION_API_BASE 覆盖端点（sandbox 阶段用 test-api）', async () => {
    vi.stubEnv('CREEM_MODERATION_API_BASE', 'https://test-api.creem.io/')
    mockFetch.mockResolvedValue(creemResponse('allow'))
    await moderatePrompt('x')
    expect(mockFetch.mock.calls[0][0]).toBe('https://test-api.creem.io/v1/moderation/prompt')
  })
})

describe('moderationErrorResponse（路由统一错误体）', () => {
  it('prompt_rejected → 400 + content_flagged；unavailable → 503 + moderation_unavailable', () => {
    expect(moderationErrorResponse({ ok: false, code: 'prompt_rejected' })).toEqual({
      status: 400,
      body: { error: '内容未通过安全审核，请修改提示词后重试', errorKey: 'content_flagged' },
    })
    expect(moderationErrorResponse({ ok: false, code: 'moderation_unavailable' })).toEqual({
      status: 503,
      body: { error: '内容安全审核服务暂时不可用，请稍后重试', errorKey: 'moderation_unavailable' },
    })
  })
})

describe('combineTextsForModeration（多字段拼接）', () => {
  it('过滤空值并以换行拼接；超长截断', () => {
    expect(combineTextsForModeration(['a', undefined, null, '  ', 'b'])).toBe('a\nb')
    const long = combineTextsForModeration(['x'.repeat(MODERATION_MAX_CHARS + 10), 'tail'])
    expect(long.length).toBe(MODERATION_MAX_CHARS)
  })
})
