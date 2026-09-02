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

describe('submitTask：wan27', () => {
  const baseInput = { prompt: '城市延时', imageUrl: 'https://img/first.png', duration: '6s' }

  it('请求体/任务行符合契约（720p、数字时长、prompt_extend）', async () => {
    mockFetch.mockResolvedValue(kieOk('tid-wan'))
    vi.stubEnv('KIE_VIDEO_WEBHOOK_URL', 'https://example.com/kie/video-webhook')

    const outcome = await submitTask('wan27', baseInput, { userId: 'u1', projectId: 'p1' })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.model).toBe('wan/2-7-image-to-video')
    expect(body.input.prompt).toBe('城市延时')
    expect(body.input.first_frame_url).toBe('https://img/first.png')
    expect(body.input.resolution).toBe('720p')
    expect(body.input.duration).toBe(6) // 历史契约：数字
    expect(body.input.prompt_extend).toBe(true)
    expect(body.input.driving_audio_url).toBe('') // 空字符串触发自动音频
    expect(body.callBackUrl).toBe('https://example.com/kie/video-webhook')

    expect(outcome).toMatchObject({ ok: true, taskId: 'tid-wan', taskType: 'wan_2_7_video', pointsAmount: 12 })
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ taskType: 'wan_2_7_video', model: 'wan27', pointsAmount: 12 }))
  })

  it('无尾帧时请求不带 last_frame_url；带尾帧时传入', async () => {
    mockFetch.mockResolvedValue(kieOk())
    await submitTask('wan27', baseInput, {})
    let body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.input.last_frame_url).toBeUndefined()

    await submitTask('wan27', { ...baseInput, additionalImageUrls: ['https://img/last.png'] }, {})
    body = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(body.input.last_frame_url).toBe('https://img/last.png')
  })

  it('缺 imageUrl → 拒绝；时长越界按历史口径收敛到 5s（含计费）', async () => {
    const noImage = await submitTask('wan27', { prompt: 'x' }, {})
    expect(noImage).toEqual({ ok: false, error: 'Image URL is required' })

    mockFetch.mockResolvedValue(kieOk('tid-wan2'))
    const outcome = await submitTask('wan27', { prompt: 'x', imageUrl: 'https://i.png', duration: '20s' }, { userId: 'u1' })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.input.duration).toBe(5)
    expect(outcome).toMatchObject({ ok: true, pointsAmount: 10 }) // 5s × 2
  })
})

describe('submitTask：minimaxH3', () => {
  it('请求体符合契约（768p、数字时长）', async () => {
    mockFetch.mockResolvedValue(kieOk('tid-mm'))
    const outcome = await submitTask(
      'minimaxH3',
      { prompt: '海浪', imageUrl: 'https://img/f.png', additionalImageUrls: ['https://img/l.png'], duration: '8s' },
      { userId: 'u1' },
    )
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.model).toBe('minimax-h3/image-to-video')
    expect(body.input.first_frame_url).toBe('https://img/f.png')
    expect(body.input.last_frame_url).toBe('https://img/l.png')
    expect(body.input.resolution).toBe('768p')
    expect(body.input.duration).toBe(8)
    expect(outcome).toMatchObject({ ok: true, taskId: 'tid-mm', taskType: 'minimax_h3_video', pointsAmount: 20 })
  })

  it('缺 imageUrl → 拒绝；时长越界收敛到 6s（含计费）', async () => {
    const noImage = await submitTask('minimaxH3', { prompt: 'x' }, {})
    expect(noImage).toEqual({ ok: false, error: 'Image URL is required for MiniMax H3' })

    mockFetch.mockResolvedValue(kieOk('tid-mm2'))
    const outcome = await submitTask('minimaxH3', { prompt: 'x', imageUrl: 'https://i.png', duration: '30s' }, { userId: 'u1' })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.input.duration).toBe(6)
    expect(outcome).toMatchObject({ ok: true, pointsAmount: 15 }) // 6s × 2.5
  })
})

describe('submitTask：happyHorse', () => {
  const baseInput = { prompt: '奔马', imageUrl: 'https://img/f.png', duration: '6s' }

  it('请求体符合契约（HappyHorse 1.1 接口、720p、image_urls）', async () => {
    mockFetch.mockResolvedValue(kieOk('tid-hh'))
    vi.stubEnv('KIE_VIDEO_WEBHOOK_URL', 'https://example.com/kie/video-webhook')

    const outcome = await submitTask('happyHorse', baseInput, { userId: 'u1' })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.model).toBe('happyhorse-1-1/image-to-video')
    expect(body.input.image_urls).toEqual(['https://img/f.png'])
    expect(body.input.resolution).toBe('720p')
    expect(body.input.duration).toBe(6)
    expect(body.callBackUrl).toBe('https://example.com/kie/video-webhook')
    expect(outcome).toMatchObject({ ok: true, taskId: 'tid-hh', taskType: 'happyhorse_video', pointsAmount: 15 })
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ taskType: 'happyhorse_video', model: 'happyHorse' }))
  })

  it('无任何 webhook 配置 → 回退本服务 video-webhook（带 projectId 时附场景定位参数）', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')
    mockFetch.mockResolvedValue(kieOk())

    await submitTask('happyHorse', baseInput, { projectId: 'p1', sceneIndex: 3, sceneId: 's3' })
    let body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.callBackUrl).toBe('https://app.example.com/api/ai/kie/video-webhook?projectId=p1&sceneIndex=3&sceneId=s3&versionId=undefined&versionGroupId=undefined')

    await submitTask('happyHorse', baseInput, {})
    body = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(body.callBackUrl).toBe('https://app.example.com/api/ai/kie/video-webhook')
  })

  it('缺 imageUrl → 拒绝；时长 3-15 之外收敛到 5s（含计费）', async () => {
    const noImage = await submitTask('happyHorse', { prompt: 'x' }, {})
    expect(noImage).toEqual({ ok: false, error: 'Image URL is required' })

    mockFetch.mockResolvedValue(kieOk('tid-hh2'))
    const outcome = await submitTask('happyHorse', { prompt: 'x', imageUrl: 'https://i.png', duration: '2s' }, { userId: 'u1' })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.input.duration).toBe(5)
    expect(outcome).toMatchObject({ ok: true, pointsAmount: 13 }) // 5s × 2.5 → round(12.5)=13
  })
})

describe('submitTask：kling3', () => {
  const baseInput = { prompt: '太空漫游', imageUrl: 'https://img/f.png', duration: '6s', aspectRatio: '16:9' }

  it('请求体符合契约（std 档、字符串时长、sound on、multi_shots off）', async () => {
    mockFetch.mockResolvedValue(kieOk('tid-kl'))
    const outcome = await submitTask('kling3', baseInput, { userId: 'u1' })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.model).toBe('kling-3.0/video')
    expect(body.input.image_urls).toEqual(['https://img/f.png'])
    expect(body.input.duration).toBe('6') // 历史契约：字符串
    expect(body.input.mode).toBe('std')
    expect(body.input.sound).toBe(true)
    expect(body.input.multi_shots).toBe(false)
    expect(outcome).toMatchObject({ ok: true, taskId: 'tid-kl', taskType: 'kling_3_0_video', pointsAmount: 15 })
  })

  it('尾帧模式 image_urls 两张；hollywood 风格增强 prompt（Kling 专属文案）', async () => {
    mockFetch.mockResolvedValue(kieOk())
    await submitTask('kling3', { ...baseInput, additionalImageUrls: ['https://img/l.png'], videoStyle: 'hollywood' }, {})
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.input.image_urls).toEqual(['https://img/f.png', 'https://img/l.png'])
    expect(body.input.prompt).toBe('太空漫游, Hollywood cinematic style, film-like quality, dramatic lighting, cinematic color grading')
  })

  it('缺 imageUrl → 拒绝；时长越界收敛到 5s（含计费）', async () => {
    const noImage = await submitTask('kling3', { prompt: 'x' }, {})
    expect(noImage).toEqual({ ok: false, error: 'Image URL is required' })

    mockFetch.mockResolvedValue(kieOk('tid-kl2'))
    const outcome = await submitTask('kling3', { prompt: 'x', imageUrl: 'https://i.png', duration: '30s' }, { userId: 'u1' })
    expect(outcome).toMatchObject({ ok: true, pointsAmount: 13 }) // 5s × 2.5
  })
})

describe('submitTask：Seedance 系（四键）', () => {
  const baseInput = { prompt: '森林日出', imageUrl: 'https://img/f.png', duration: '6s' }

  it('seedance2：请求体符合契约（generate_audio on、web_search off、720p）', async () => {
    mockFetch.mockResolvedValue(kieOk('tid-sd'))
    const outcome = await submitTask('seedance2', baseInput, { userId: 'u1' })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.model).toBe('bytedance/seedance-2')
    expect(body.input.first_frame_url).toBe('https://img/f.png')
    expect(body.input.generate_audio).toBe(true)
    expect(body.input.web_search).toBe(false)
    expect(body.input.resolution).toBe('720p')
    expect(body.input.duration).toBe(6)
    expect(body.input.reference_video_urls).toBeUndefined()
    expect(outcome).toMatchObject({ ok: true, taskId: 'tid-sd', taskType: 'seedance_2_0_video', pointsAmount: 21 }) // 6s × 3.5
  })

  it('四键各映射到正确的供应商 model/taskType/单价', async () => {
    mockFetch.mockResolvedValue(kieOk('tid-sd'))
    const cases = [
      { key: 'seedance25', vendorModel: 'bytedance/seedance-2-5', taskType: 'seedance_2_5_video', points6s: 54 },
      { key: 'seedance2Fast', vendorModel: 'bytedance/seedance-2-fast', taskType: 'seedance_2_0_fast_video', points6s: 12 },
      { key: 'seedance2Mini', vendorModel: 'bytedance/seedance-2-mini', taskType: 'seedance_2_0_mini_video', points6s: 9 },
      { key: 'seedance2', vendorModel: 'bytedance/seedance-2', taskType: 'seedance_2_0_video', points6s: 21 },
    ] as const
    for (const c of cases) {
      const outcome = await submitTask(c.key, baseInput, { userId: 'u1' })
      const body = JSON.parse(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body)
      expect(body.model).toBe(c.vendorModel)
      expect(outcome).toMatchObject({ ok: true, taskType: c.taskType, pointsAmount: c.points6s })
    }
  })

  it('seedance25 时长上限 30s；非 25 越界收敛到 8s（undefined 默认 5s）', async () => {
    mockFetch.mockResolvedValue(kieOk('tid-sd'))
    await submitTask('seedance25', { ...baseInput, duration: '20s' }, {})
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).input.duration).toBe(20)

    await submitTask('seedance2', { ...baseInput, duration: '20s' }, {})
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).input.duration).toBe(8)

    await submitTask('seedance2', { prompt: baseInput.prompt, imageUrl: baseInput.imageUrl }, {})
    expect(JSON.parse(mockFetch.mock.calls[2][1].body).input.duration).toBe(5)
  })

  it('尾帧与多模态参考（video/audio 各截前 3 个）', async () => {
    mockFetch.mockResolvedValue(kieOk('tid-sd'))
    await submitTask(
      'seedance2',
      {
        ...baseInput,
        additionalImageUrls: ['https://img/l.png'],
        referenceVideoUrls: ['https://v/1.mp4', 'https://v/2.mp4', 'https://v/3.mp4', 'https://v/4.mp4'],
        referenceAudioUrls: ['https://a/1.mp3'],
      },
      { userId: 'u1' },
    )
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.input.last_frame_url).toBe('https://img/l.png')
    expect(body.input.reference_video_urls).toEqual(['https://v/1.mp4', 'https://v/2.mp4', 'https://v/3.mp4'])
    expect(body.input.reference_audio_urls).toEqual(['https://a/1.mp3'])
  })

  it('缺 imageUrl → 拒绝', async () => {
    const outcome = await submitTask('seedance2', { prompt: 'x' }, {})
    expect(outcome).toEqual({ ok: false, error: 'Image URL is required' })
  })
})

describe('submitTask：Veo 系（三键）', () => {
  const baseInput = { prompt: '城市夜景', imageUrl: 'https://img/f.png', duration: '8s', aspectRatio: '16:9' }

  it('veo31Fast：veo/generate 端点、顶层 imageUrls、单图自动 FIRST_AND_LAST', async () => {
    mockFetch.mockResolvedValue(kieOk('tid-veo'))
    const outcome = await submitTask('veo31Fast', baseInput, { userId: 'u1' })

    expect(mockFetch.mock.calls[0][0]).toBe('https://api.kie.ai/api/v1/veo/generate') // 专属端点
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.model).toBe('veo3_fast')
    expect(body.prompt).toBe('城市夜景') // 顶层（非 input 包裹）
    expect(body.generationType).toBe('FIRST_AND_LAST_FRAMES_2_VIDEO')
    expect(body.imageUrls).toEqual(['https://img/f.png'])
    expect(body.aspect_ratio).toBe('16:9')
    expect(body.duration).toBe(8)
    expect(body.enableTranslation).toBe(true)
    expect(outcome).toMatchObject({ ok: true, taskId: 'tid-veo', taskType: 'generate_story_video_veo', pointsAmount: 16 })
  })

  it('双图 → FIRST_AND_LAST 首尾帧；三图 → REFERENCE_2_VIDEO 截前 3', async () => {
    mockFetch.mockResolvedValue(kieOk())
    await submitTask('veo31Fast', { ...baseInput, additionalImageUrls: ['https://img/l.png'] }, {})
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).imageUrls).toEqual(['https://img/f.png', 'https://img/l.png'])

    await submitTask('veo31Fast', { ...baseInput, additionalImageUrls: ['https://img/2.png', 'https://img/3.png'] }, {})
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).generationType).toBe('REFERENCE_2_VIDEO')
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).imageUrls).toEqual(['https://img/f.png', 'https://img/2.png', 'https://img/3.png'])
  })

  it('纯文生视频：无图 → REFERENCE_2_VIDEO + 空 imageUrls，仍可提交', async () => {
    mockFetch.mockResolvedValue(kieOk('tid-veo2'))
    const outcome = await submitTask('veo31Fast', { prompt: '一只猫' }, { userId: 'u1' })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.imageUrls).toEqual([])
    expect(outcome).toMatchObject({ ok: true, taskId: 'tid-veo2' })
  })

  it('显式 generationType 优先；时长越界收敛 8s', async () => {
    mockFetch.mockResolvedValue(kieOk())
    await submitTask('veo31Fast', { ...baseInput, generationType: 'REFERENCE_2_VIDEO' }, {})
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).generationType).toBe('REFERENCE_2_VIDEO')

    await submitTask('veo31Fast', { ...baseInput, duration: '5s' }, {})
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).duration).toBe(8)
  })

  it('三键各映射供应商 model 与档位单价；webhook 走 KIE_VEO_WEBHOOK_URL', async () => {
    vi.stubEnv('KIE_VEO_WEBHOOK_URL', 'https://example.com/kie/veo-webhook')
    mockFetch.mockResolvedValue(kieOk())
    const cases = [
      { key: 'veo31Lite', vendorModel: 'veo3_lite', points8s: 12 },
      { key: 'veo31Fast', vendorModel: 'veo3_fast', points8s: 16 },
      { key: 'veo31Quality', vendorModel: 'veo3', points8s: 72 },
    ] as const
    for (const c of cases) {
      const outcome = await submitTask(c.key, baseInput, { userId: 'u1' })
      const body = JSON.parse(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body)
      expect(body.model).toBe(c.vendorModel)
      expect(body.callBackUrl).toBe('https://example.com/kie/veo-webhook')
      expect(outcome).toMatchObject({ ok: true, taskType: 'generate_story_video_veo', pointsAmount: c.points8s })
    }
  })

  it('ads 风格增强 prompt（Veo 专属文案）；缺 prompt → 拒绝', async () => {
    mockFetch.mockResolvedValue(kieOk())
    await submitTask('veo31Fast', { ...baseInput, videoStyle: 'ads' }, {})
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).prompt).toBe('城市夜景, advertisement style, educational video style')

    const noPrompt = await submitTask('veo31Fast', { prompt: '', imageUrl: 'https://i.png' }, {})
    expect(noPrompt).toEqual({ ok: false, error: 'Prompt is required' })
  })
})
