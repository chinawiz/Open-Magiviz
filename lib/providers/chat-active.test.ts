import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { callChatCompletionActive, type RoutedChatResult } from './chat-active'
import type { ActiveRouteEntry } from './router'

// 生效模型路由包装：只测外显行为——local/云端谁被调、调几次、回退元数据对不对。

const endpointEntry: ActiveRouteEntry = {
  provider: 'local',
  modelKey: 'route-model',
  priority: 0,
  endpoint: {
    id: 'ep-1',
    capability: 'script',
    protocol: 'openai-chat',
    baseUrl: 'http://dgx:8000/v1',
    apiKey: 'sk-local',
    modelId: 'local-model',
    timeoutMs: 1000,
    enabled: true,
    lastTestAt: null,
    lastTestOk: null,
    note: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
}
const cloudEntry: ActiveRouteEntry = { provider: 'zenmux', modelKey: 'cloud-model', priority: 0 }

const resolveActiveRoutes = vi.hoisted(() => vi.fn())
vi.mock('./router', () => ({ resolveActiveRoutes }))

beforeEach(() => {
  resolveActiveRoutes.mockReset()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const opts = (callCloud: () => Promise<string>) => ({
  capability: 'script' as const,
  cloudProvider: 'zenmux',
  cloudModel: 'cloud-model',
  input: { user: '写个剧本' },
  callCloud,
})

describe('callChatCompletionActive', () => {
  it('无自建：只调云端一次，fallbackApplied=false', async () => {
    resolveActiveRoutes.mockResolvedValue([cloudEntry])
    const callCloud = vi.fn(async () => '云端剧本')

    const result = await callChatCompletionActive(opts(callCloud))

    expect(result).toMatchObject({ content: '云端剧本', provider: 'zenmux', model: 'cloud-model', fallbackApplied: false })
    expect(callCloud).toHaveBeenCalledTimes(1)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('自建成功：只调自建，云端零调用', async () => {
    resolveActiveRoutes.mockResolvedValue([endpointEntry])
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '自建剧本' } }] }), { status: 200 }))
    const callCloud = vi.fn(async () => '不该被调')

    const result: RoutedChatResult = await callChatCompletionActive(opts(callCloud))

    expect(result).toMatchObject({ content: '自建剧本', provider: 'local', model: 'local-model', fallbackApplied: false })
    expect(callCloud).not.toHaveBeenCalled()
  })

  it('自建失败：回退云端恰好一次，元数据带 fallbackApplied 与 localError 阶段', async () => {
    resolveActiveRoutes.mockResolvedValue([endpointEntry, cloudEntry])
    vi.mocked(global.fetch).mockRejectedValue(new TypeError('ECONNREFUSED'))
    const callCloud = vi.fn(async () => '云端兜底剧本')

    const result = await callChatCompletionActive(opts(callCloud))

    expect(result).toMatchObject({ content: '云端兜底剧本', provider: 'zenmux', model: 'cloud-model', fallbackApplied: true })
    expect(result.localError).toContain('connect')
    expect(callCloud).toHaveBeenCalledTimes(1)
  })

  it('自建失败且云端也失败：向上抛云端错误（保持 LLMError 语义），并挂回退元数据', async () => {
    resolveActiveRoutes.mockResolvedValue([endpointEntry])
    vi.mocked(global.fetch).mockRejectedValue(new TypeError('ECONNREFUSED'))
    const cloudError = Object.assign(new Error('cloud down'), { status: 502 })
    const callCloud = vi.fn(async () => {
      throw cloudError
    })

    await expect(callChatCompletionActive(opts(callCloud))).rejects.toThrow('cloud down')
    expect(callCloud).toHaveBeenCalledTimes(1)
    // 原错误对象上携带回退痕迹（调用方的 instanceof 检查不受影响）
    expect((cloudError as { routedMeta?: unknown }).routedMeta).toMatchObject({
      fallbackApplied: true,
    })
    expect(String((cloudError as { routedMeta?: { localError?: string } }).routedMeta?.localError)).toContain('connect')
  })
})
