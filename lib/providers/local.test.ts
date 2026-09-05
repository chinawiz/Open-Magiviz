import { describe, it, expect, vi } from 'vitest'
import { localChatCompletion, probeEndpoint, LocalProviderError, type LocalEndpointConfig } from './local'

// 自建端点客户端（统一契约：OpenAI 兼容）。测试只测外显行为：
// 给定端点响应/错误，调用方拿到什么、错误归一到哪个阶段。

const endpoint: LocalEndpointConfig = {
  baseUrl: 'http://dgx:8000/v1/',
  apiKey: 'sk-test-key',
  modelId: 'test-model',
  timeoutMs: 5000,
}

function fetchOk(json: unknown) {
  return vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => json,
    text: async () => JSON.stringify(json),
  }))
}

function fetchHttpError(status: number, text: string) {
  return vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => text,
  }))
}

describe('localChatCompletion', () => {
  it('成功：POST {baseUrl}/chat/completions（去尾斜杠），带 Bearer 与模型名，返回首条消息文本', async () => {
    const fetchImpl = fetchOk({ choices: [{ message: { content: '你好，剧本' } }] })
    const result = await localChatCompletion(endpoint, { user: '写个剧本' }, fetchImpl)

    expect(result).toBe('你好，剧本')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('http://dgx:8000/v1/chat/completions')
    expect(init!.method).toBe('POST')
    expect((init!.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test-key')
    const body = JSON.parse(String(init!.body))
    expect(body.model).toBe('test-model')
    expect(body.messages).toEqual([{ role: 'user', content: '写个剧本' }])
  })

  it('system 提示词进入 messages 首位', async () => {
    const fetchImpl = fetchOk({ choices: [{ message: { content: 'ok' } }] })
    await localChatCompletion(endpoint, { system: '你是编剧', user: '写' }, fetchImpl)
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]!.body))
    expect(body.messages[0]).toEqual({ role: 'system', content: '你是编剧' })
  })

  it('乱序 messages 归一化：散落的 system 合并置顶（vLLM Qwen 模板硬性要求，生产实测 400）', async () => {
    const fetchImpl = fetchOk({ choices: [{ message: { content: 'ok' } }] })
    await localChatCompletion(
      endpoint,
      {
        messages: [
          { role: 'user', content: '用户想法' },
          { role: 'system', content: '系统规则 A' },
          { role: 'user', content: '续写' },
          { role: 'system', content: '系统规则 B' },
        ],
      },
      fetchImpl,
    )
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]!.body))
    expect(body.messages[0]).toEqual({ role: 'system', content: '系统规则 A\n\n系统规则 B' })
    expect(body.messages.slice(1)).toEqual([
      { role: 'user', content: '用户想法' },
      { role: 'user', content: '续写' },
    ])
  })

  it('连接失败 → phase=connect', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed: ECONNREFUSED')
    })
    const err = await localChatCompletion(endpoint, { user: 'x' }, fetchImpl).catch(e => e)
    expect(err).toBeInstanceOf(LocalProviderError)
    expect(err.phase).toBe('connect')
  })

  it('超时（AbortError）→ phase=timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      const e = new Error('The operation was aborted')
      e.name = 'AbortError'
      throw e
    })
    const err = await localChatCompletion(endpoint, { user: 'x' }, fetchImpl).catch(e => e)
    expect(err).toBeInstanceOf(LocalProviderError)
    expect(err.phase).toBe('timeout')
  })

  it('HTTP 429/5xx → phase=http，携带状态码', async () => {
    for (const status of [429, 500, 503]) {
      const fetchImpl = fetchHttpError(status, 'upstream busy')
      const err = await localChatCompletion(endpoint, { user: 'x' }, fetchImpl).catch(e => e)
      expect(err).toBeInstanceOf(LocalProviderError)
      expect(err.phase).toBe('http')
      expect(err.status).toBe(status)
    }
  })

  it('响应形状不符（缺 choices）→ phase=shape', async () => {
    const fetchImpl = fetchOk({ error: 'unexpected shape' })
    const err = await localChatCompletion(endpoint, { user: 'x' }, fetchImpl).catch(e => e)
    expect(err).toBeInstanceOf(LocalProviderError)
    expect(err.phase).toBe('shape')
  })

  it('请求完成后清理超时定时器（不悬挂句柄）', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = fetchOk({ choices: [{ message: { content: 'ok' } }] })
      await localChatCompletion(endpoint, { user: 'x' }, fetchImpl)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('probeEndpoint', () => {
  it('成功：GET {baseUrl}/models，返回 ok 与耗时', async () => {
    const fetchImpl = fetchOk({ data: [{ id: 'test-model' }] })
    const result = await probeEndpoint(endpoint, fetchImpl)

    expect(result.ok).toBe(true)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('http://dgx:8000/v1/models')
    expect(init!.method).toBe('GET')
    expect((init!.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test-key')
  })

  it('端点不可达/HTTP 错误 → ok=false，error 带阶段与状态', async () => {
    const connFail = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    expect((await probeEndpoint(endpoint, connFail)).ok).toBe(false)

    const httpErr = fetchHttpError(502, 'bad gateway')
    const result = await probeEndpoint(endpoint, httpErr)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('502')
  })
})
