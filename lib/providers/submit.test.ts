import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { db } from '@/lib/db'
import { aiGenerationTasks } from '@/lib/schema'
import { submitTask } from './submit'

/**
 * submitTask 契约测试（seam：lib/providers 提交半边）。
 * 验证：请求体形状、鉴权头、webhook 解析（环境变量优先）、任务行落库字段、
 * 与 video-pricing 单一事实源对齐的 pointsAmount。
 * db 与 fetch 是系统边界，予以 mock；供应商响应用真实 JSON 形状。
 */

vi.mock('@/lib/db', () => ({
  db: { insert: vi.fn() },
}))

const insertValues = vi.fn().mockResolvedValue([])
const mockFetch = vi.fn()

function kieOk(taskId = 'tid-1') {
  return { ok: true, status: 200, text: async () => JSON.stringify({ code: 200, data: { taskId } }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mockFetch)
  vi.stubEnv('KIE_API_KEY', 'test-key')
  ;(db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: insertValues })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('submitTask（视频任务提交 seam）', () => {
  it('geminiOmni：POST jobs/createTask，请求体/鉴权/任务行符合契约', async () => {
    vi.stubEnv('KIE_VIDEO_WEBHOOK_URL', 'https://example.com/kie/video-webhook')
    mockFetch.mockResolvedValue(kieOk())

    const outcome = await submitTask(
      'geminiOmni',
      {
        prompt: '一只猫在奔跑',
        imageUrl: 'https://img/first.png',
        additionalImageUrls: ['https://img/ref1.png'],
        duration: '6s',
        aspectRatio: '16:9',
      },
      { userId: 'u1', projectId: 'p1', versionId: 'v1', versionGroupId: 'vg1', sceneIndex: 2, sceneId: 's2' },
    )

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.kie.ai/api/v1/jobs/createTask')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer test-key')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('gemini-omni-video')
    expect(body.input.prompt).toBe('一只猫在奔跑')
    expect(body.input.duration).toBe('6') // 历史契约：字符串秒数
    expect(body.input.resolution).toBe('1080p')
    expect(body.input.aspect_ratio).toBe('16:9')
    expect(body.input.image_urls).toEqual(['https://img/first.png', 'https://img/ref1.png'])
    expect(body.callBackUrl).toBe('https://example.com/kie/video-webhook')

    expect(outcome).toEqual({
      ok: true,
      taskId: 'tid-1',
      taskType: 'gemini_omni_video',
      pointsAmount: 15, // 6s × 2.5（VIDEO_MODEL_UNIT_POINTS，非手抄）
      webhook: true,
    })
    expect(db.insert).toHaveBeenCalledWith(aiGenerationTasks)
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'tid-1',
        userId: 'u1',
        taskType: 'gemini_omni_video',
        pointsAmount: 15,
        model: 'geminiOmni',
        pointsDeducted: false,
        status: 'pending',
        projectId: 'p1',
        versionId: 'v1',
        itemId: '2',
        versionGroupId: 'vg1',
        newVersionId: null,
      }),
    )
  })

  it('geminiOmni：时长不在 4/6/8/10s → 拒绝且不发请求', async () => {
    const outcome = await submitTask('geminiOmni', { prompt: 'x', duration: '5s' }, {})
    expect(outcome).toEqual({ ok: false, error: 'Gemini Omni 只支持 4/6/8/10s，当前: 5s' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('geminiOmni：缺 prompt → 拒绝', async () => {
    const outcome = await submitTask('geminiOmni', { prompt: '  ', duration: '6s' }, {})
    expect(outcome).toEqual({ ok: false, error: 'Prompt is required' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('未知模型 → 拒绝（Unsupported model）', async () => {
    const outcome = await submitTask('nonexistent', { prompt: 'x' }, {})
    expect(outcome).toEqual({ ok: false, error: 'Unsupported model: nonexistent' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('供应商返回 code!==200 → 透传 msg；不落任务行', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ code: 500, msg: 'quota exceeded' }) })
    const outcome = await submitTask('geminiOmni', { prompt: 'x', duration: '6s' }, { userId: 'u1' })
    expect(outcome).toEqual({ ok: false, error: 'quota exceeded' })
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('供应商未返回 taskId → 拒绝', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ code: 200, data: {} }) })
    const outcome = await submitTask('geminiOmni', { prompt: 'x', duration: '6s' }, {})
    expect(outcome).toEqual({ ok: false, error: 'No task ID returned' })
  })

  it('HTTP 非 2xx → API error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502, text: async () => 'bad gateway' })
    const outcome = await submitTask('geminiOmni', { prompt: 'x', duration: '6s' }, {})
    expect(outcome).toEqual({ ok: false, error: 'API error: 502' })
  })

  it('webhook 解析：环境变量优先于调用方传入（全模型统一口径）', async () => {
    vi.stubEnv('KIE_VIDEO_WEBHOOK_URL', 'https://env.example.com/hook')
    mockFetch.mockResolvedValue(kieOk())
    await submitTask('geminiOmni', { prompt: 'x', duration: '6s' }, { webhookUrl: 'https://caller.example.com/hook' })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.callBackUrl).toBe('https://env.example.com/hook')
  })

  it('无任何 webhook 来源 → 请求不带 callBackUrl，outcome.webhook=false', async () => {
    mockFetch.mockResolvedValue(kieOk())
    const outcome = await submitTask('geminiOmni', { prompt: 'x', duration: '6s' }, {})
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.callBackUrl).toBeUndefined()
    expect(outcome).toMatchObject({ ok: true, webhook: false })
  })

  it('无 userId → 不落任务行（与历史一致）', async () => {
    mockFetch.mockResolvedValue(kieOk())
    await submitTask('geminiOmni', { prompt: 'x', duration: '6s' }, {})
    expect(insertValues).not.toHaveBeenCalled()
  })
})
