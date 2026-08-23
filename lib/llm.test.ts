import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { callChatCompletion, parseJsonFromContent, LLMError, DEFAULT_MODEL, ZENMUX_API_URL } from './llm'

describe('parseJsonFromContent', () => {
  it('解析纯 JSON 文本', () => {
    const result = parseJsonFromContent('{"a":1}')
    expect(result).toEqual({ a: 1 })
  })

  it('解析 ```json 代码块包裹的 JSON', () => {
    const content = '```json\n{"a":1,"b":[1,2]}\n```'
    expect(parseJsonFromContent(content)).toEqual({ a: 1, b: [1, 2] })
  })

  it('解析带前后说明文本的 JSON', () => {
    const content = '以下是结果：\n{"scenes":[{"title":"第一幕"}]}\n结束'
    expect(parseJsonFromContent(content)).toEqual({ scenes: [{ title: '第一幕' }] })
  })

  it('非法 JSON 抛出 SyntaxError', () => {
    expect(() => parseJsonFromContent('not json at all')).toThrow(SyntaxError)
  })
})

describe('callChatCompletion', () => {
  const mockFetch = vi.fn()
  const originalKey = process.env.ZENMUX_API_KEY

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    process.env.ZENMUX_API_KEY = 'test-key'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalKey === undefined) {
      delete process.env.ZENMUX_API_KEY
    } else {
      process.env.ZENMUX_API_KEY = originalKey
    }
    mockFetch.mockReset()
  })

  it('缺少 API key 时抛出 LLMError', async () => {
    delete process.env.ZENMUX_API_KEY
    await expect(callChatCompletion({ user: 'hi' })).rejects.toThrow('ZENMUX_API_KEY')
  })

  it('成功时返回 message content，并组装正确的请求 payload', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const content = await callChatCompletion({ user: '你好', system: '你是助手' })

    expect(content).toBe('{"ok":true}')

    // 校验请求
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(ZENMUX_API_URL)
    expect(options.method).toBe('POST')
    const headers = options.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-key')
    expect(headers['Content-Type']).toBe('application/json')

    const body = JSON.parse(options.body as string)
    expect(body.model).toBe(DEFAULT_MODEL)
    expect(body.messages).toEqual([
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '你好' },
    ])
    expect(body.maxTokens).toBe(4096)
    expect(body.temperature).toBe(0.7)
  })

  it('上游返回 429 时透传状态码（LLMError.status）', async () => {
    mockFetch.mockResolvedValue(
      new Response('rate limited', { status: 429, headers: { 'Content-Type': 'text/plain' } })
    )

    const error = await callChatCompletion({ user: 'hi' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LLMError)
    expect((error as LLMError).status).toBe(429)
    expect((error as LLMError).details).toBe('rate limited')
  })

  it('上游 5xx 时同样透传状态码', async () => {
    mockFetch.mockResolvedValue(
      new Response('boom', { status: 502, headers: { 'Content-Type': 'text/plain' } })
    )

    const error = await callChatCompletion({ user: 'hi' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LLMError)
    expect((error as LLMError).status).toBe(502)
  })

  it('支持覆盖默认模型与 maxTokens', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await callChatCompletion({ user: 'hi', model: 'custom-model', maxTokens: 128, temperature: 0.2 })

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(options.body as string)
    expect(body.model).toBe('custom-model')
    expect(body.maxTokens).toBe(128)
    expect(body.temperature).toBe(0.2)
  })
})
