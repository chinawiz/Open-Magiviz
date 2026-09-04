import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { attemptLocalImages } from './image-active'
import type { ActiveRouteEntry } from './router'

// 自建图像三态：inactive（未启用/skip）→ 云端不算回退；ok → 已转存 R2 公网直链；failed → 云端 + fallbackApplied。

const endpointEntry: ActiveRouteEntry = {
  provider: 'local',
  modelKey: 'local-image-model',
  priority: 0,
  endpoint: {
    id: 'ep-img',
    capability: 'image',
    protocol: 'openai-images',
    baseUrl: 'http://dgx:8000/v1',
    apiKey: 'sk-local',
    modelId: 'flux2-local',
    timeoutMs: 120000,
    enabled: true,
    lastTestAt: null,
    lastTestOk: null,
    note: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
}
const cloudEntry: ActiveRouteEntry = { provider: 'kieai', modelKey: 'nano-banana-2', priority: 0 }

const resolveActiveRoutes = vi.hoisted(() => vi.fn())
vi.mock('./router', () => ({ resolveActiveRoutes }))
const uploadImageBufferToR2 = vi.hoisted(() => vi.fn())
vi.mock('@/lib/r2-upload', () => ({ uploadImageBufferToR2 }))

beforeEach(() => {
  resolveActiveRoutes.mockReset()
  uploadImageBufferToR2.mockReset()
  vi.stubGlobal('fetch', vi.fn())
  uploadImageBufferToR2.mockResolvedValue('https://cdn.example.com/generated/local-images/x.png')
})
afterEach(() => vi.unstubAllGlobals())

describe('attemptLocalImages', () => {
  it('未启用自建 → inactive（调用方走云端且不算回退）', async () => {
    resolveActiveRoutes.mockResolvedValue([cloudEntry])
    expect(await attemptLocalImages('a castle')).toEqual({ status: 'inactive' })
  })

  it('skip=true（带参考图/角色图的 img2img）→ inactive，且不发起路由解析', async () => {
    await attemptLocalImages('a castle', { skip: true })
    expect(resolveActiveRoutes).not.toHaveBeenCalled()
  })

  it('自建成功：b64 结果经 R2 转存为公网直链', async () => {
    resolveActiveRoutes.mockResolvedValue([endpointEntry])
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: 'aW1n' }] }), { status: 200 }),
    )

    const result = await attemptLocalImages('a castle')

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.model).toBe('flux2-local')
      expect(result.images).toEqual([{ url: 'https://cdn.example.com/generated/local-images/x.png' }])
    }
    const [buffer, key] = uploadImageBufferToR2.mock.calls[0]
    expect(Buffer.isBuffer(buffer)).toBe(true)
    expect(String(key)).toMatch(/^generated\/local-images\//)
  })

  it('自建失败 → failed，localError 带阶段（调用方回退云端并记 fallbackApplied）', async () => {
    resolveActiveRoutes.mockResolvedValue([endpointEntry])
    vi.mocked(global.fetch).mockRejectedValue(new TypeError('ECONNREFUSED'))

    const result = await attemptLocalImages('a castle')

    expect(result.status).toBe('failed')
    if (result.status === 'failed') expect(result.localError).toContain('connect')
  })

  it('R2 转存失败同样按自建失败回退（下游需要公网直链，转存是链路的一部分）', async () => {
    resolveActiveRoutes.mockResolvedValue([endpointEntry])
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: 'aW1n' }] }), { status: 200 }),
    )
    uploadImageBufferToR2.mockRejectedValue(new Error('R2_BUCKET 未配置'))

    const result = await attemptLocalImages('a castle')

    expect(result.status).toBe('failed')
    if (result.status === 'failed') expect(result.localError).toContain('R2')
  })
})
