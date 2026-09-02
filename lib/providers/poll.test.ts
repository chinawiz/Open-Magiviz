import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { pollKieTask } from './kie'
import { pollTaskUntilVerdict } from './poll'

/**
 * 轮询 seam 测试：pollKieTask 的响应形状归一（含 MiniMax H3 在 jobs/get 上
 * 返回 successFlag 的变体——补偿任务曾因映射不符而读不到终态），
 * 以及 pollTaskUntilVerdict 的循环/超时语义。
 */

const mockFetch = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mockFetch)
  vi.stubEnv('KIE_API_KEY', 'test-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('pollKieTask（jobsGet 形状归一）', () => {
  it('标准形状：taskStatus SUCCESS → success + result.resultUrls', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ code: 200, data: { taskStatus: 'SUCCESS', result: { resultUrls: ['https://v.mp4'] } } }),
    })
    const r = await pollKieTask('jobsGet', 'tid-1')
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.kie.ai/api/v1/jobs/get?taskId=tid-1')
    expect(r).toEqual({ verdict: 'success', resultUrls: ['https://v.mp4'] })
  })

  it('MiniMax H3 变体：successFlag=1 → success + response.videoUrl/url/urls 归一', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ code: 200, data: { successFlag: 1, response: { videoUrl: 'https://v-minimax.mp4' } } }),
    })
    expect(await pollKieTask('jobsGet', 'tid-1')).toEqual({ verdict: 'success', resultUrls: ['https://v-minimax.mp4'] })

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ code: 200, data: { successFlag: 1, response: { urls: ['https://a.mp4', 'https://b.mp4'] } } }),
    })
    expect(await pollKieTask('jobsGet', 'tid-1')).toEqual({ verdict: 'success', resultUrls: ['https://a.mp4', 'https://b.mp4'] })
  })

  it('MiniMax H3 变体：successFlag=2/3 → fail；0 → processing', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ code: 200, data: { successFlag: 2 } }) })
    expect((await pollKieTask('jobsGet', 'tid-1')).verdict).toBe('fail')
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ code: 200, data: { successFlag: 3 } }) })
    expect((await pollKieTask('jobsGet', 'tid-1')).verdict).toBe('fail')
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ code: 200, data: { successFlag: 0 } }) })
    expect((await pollKieTask('jobsGet', 'tid-1')).verdict).toBe('processing')
  })

  it('taskStatus FAILED → fail', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ code: 200, data: { taskStatus: 'FAILED', result: { failMsg: 'boom' } } }),
    })
    expect((await pollKieTask('jobsGet', 'tid-1')).verdict).toBe('fail')
  })

  it('HappyHorse 变体：taskStatus completed + result.videoUrl → success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ code: 200, data: { taskStatus: 'completed', result: { videoUrl: 'https://v-hh.mp4' } } }),
    })
    expect(await pollKieTask('jobsGet', 'tid-1')).toEqual({ verdict: 'success', resultUrls: ['https://v-hh.mp4'] })
  })
})

describe('pollTaskUntilVerdict（轮询循环 seam）', () => {
  it('processing → success：返回终态与 URL', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 200, data: { taskStatus: 'PENDING' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 200, data: { taskStatus: 'SUCCESS', result: { resultUrls: ['https://v.mp4'] } } }) })
    const r = await pollTaskUntilVerdict('wan_2_7_video', 'tid-1', { maxAttempts: 5, intervalMs: 1 })
    expect(r).toEqual({ verdict: 'success', resultUrls: ['https://v.mp4'] })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('始终 processing：耗尽 maxAttempts → unknown', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ code: 200, data: { taskStatus: 'PENDING' } }) })
    const r = await pollTaskUntilVerdict('wan_2_7_video', 'tid-1', { maxAttempts: 3, intervalMs: 1 })
    expect(r.verdict).toBe('unknown')
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('单次查询抛错不中断循环', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('network glitch'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 200, data: { taskStatus: 'SUCCESS', result: { resultUrls: ['https://v.mp4'] } } }) })
    const r = await pollTaskUntilVerdict('wan_2_7_video', 'tid-1', { maxAttempts: 5, intervalMs: 1 })
    expect(r.verdict).toBe('success')
  })
})
