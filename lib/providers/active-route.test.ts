import { describe, it, expect, beforeEach, vi } from 'vitest'

// 生效模型解析：provider_routes 里 region='local' 的启用行（自建）排在云端之前；
// endpoint 启用行是「自建生效」的唯一事实源；配置写入后缓存失效必须立即生效（热更新）。

const localRow = {
  capability: 'script',
  region: 'local',
  provider: 'local',
  modelKey: 'test-model',
  priority: 0,
}
const cloudRow = {
  capability: 'script',
  region: 'overseas',
  provider: 'zenmux',
  modelKey: 'google/gemini-3-flash-preview',
  priority: 0,
}
const endpointRow = {
  id: 'ep-1',
  capability: 'script',
  protocol: 'openai-chat',
  baseUrl: 'http://dgx:8000/v1',
  apiKey: 'sk-test-key',
  modelId: 'test-model',
  timeoutMs: 60000,
  enabled: true,
  lastTestAt: null,
  lastTestOk: null,
  note: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const state = vi.hoisted(() => ({ routes: [] as unknown[], endpoints: [] as unknown[] }))

vi.mock('@/lib/db', async () => {
  const { providerRoutes } = await import('@/lib/schema')
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn(() => {
            const rows = table === providerRoutes ? [...state.routes] : [...state.endpoints]
            // 兼容两种链尾：loadRoutes 直接 await where()，getEnabledEndpoint 再 .limit(1)
            return {
              limit: vi.fn(async () => rows),
              then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
            }
          }),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(async () => {}),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => {}),
        })),
      })),
    },
  }
})

import { resolveActiveRoutes, invalidateRouteCache } from './router'
import { syncLocalRouteOnEnable, syncLocalRouteOnDisable } from './endpoints'

beforeEach(() => {
  state.routes = []
  state.endpoints = []
  invalidateRouteCache()
})

describe('resolveActiveRoutes', () => {
  it('无自建时与现状一致：只有云端候选', async () => {
    state.routes = [cloudRow]
    const routes = await resolveActiveRoutes('script')
    expect(routes).toHaveLength(1)
    expect(routes[0].provider).toBe('zenmux')
    expect(routes[0].endpoint).toBeUndefined()
  })

  it('自建启用时 local 排首、云端殿后，local 条目携带端点配置', async () => {
    state.routes = [cloudRow, localRow]
    state.endpoints = [endpointRow]
    const routes = await resolveActiveRoutes('script')
    expect(routes).toHaveLength(2)
    expect(routes[0].provider).toBe('local')
    expect(routes[0].endpoint?.baseUrl).toBe('http://dgx:8000/v1')
    expect(routes[1].provider).toBe('zenmux')
  })

  it('端点行是唯一事实源：路由行在而端点行不在 → 自建不生效', async () => {
    state.routes = [localRow, cloudRow]
    state.endpoints = []
    const routes = await resolveActiveRoutes('script')
    expect(routes[0].provider).toBe('zenmux')
  })

  it('capability 不匹配的端点互不干扰', async () => {
    state.routes = [cloudRow]
    state.endpoints = [{ ...endpointRow, capability: 'image' }]
    const routes = await resolveActiveRoutes('script')
    expect(routes[0].provider).toBe('zenmux')
  })

  it('热更新：路由行变更后 invalidate 立即生效，不等 60s 缓存', async () => {
    state.routes = [cloudRow]
    await resolveActiveRoutes('script')

    state.routes = [localRow, cloudRow]
    state.endpoints = [endpointRow]
    invalidateRouteCache()

    const routes = await resolveActiveRoutes('script')
    expect(routes[0].provider).toBe('local')
  })
})

describe('端点启停同步路由行', () => {
  it('启用：同步函数自身失效缓存——预热缓存后直接解析即见 local（路由行 modelKey 优先于端点 modelId）', async () => {
    // 路由行与端点行的 modelKey 故意不同：缓存已失效时走路由行（route-model），
    // 若 sync 忘了 invalidate 则命中旧缓存（无 local 行）退回端点兜底（endpoint-model）
    state.routes = [cloudRow]
    await resolveActiveRoutes('script') // 预热缓存：此刻只有云端

    state.routes = [{ ...localRow, modelKey: 'route-model' }]
    state.endpoints = [{ ...endpointRow, modelId: 'endpoint-model' }]
    await syncLocalRouteOnEnable(endpointRow as never)

    const routes = await resolveActiveRoutes('script')
    expect(routes[0].provider).toBe('local')
    expect(routes[0].modelKey).toBe('route-model')
    expect(routes[0].endpoint?.modelId).toBe('endpoint-model')
  })

  it('禁用：路由行下线并失效缓存，解析回落云端', async () => {
    state.routes = [localRow, cloudRow]
    state.endpoints = [endpointRow]
    await resolveActiveRoutes('script') // 预热缓存

    await syncLocalRouteOnDisable('script')
    state.routes = [cloudRow]
    state.endpoints = []

    const routes = await resolveActiveRoutes('script')
    expect(routes[0].provider).toBe('zenmux')
  })
})
