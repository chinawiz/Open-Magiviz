import { db } from '@/lib/db'
import { aiGenerationTasks } from '@/lib/schema'
import { v4 as uuidv4 } from 'uuid'
import { computeVideoPointsFor, type VideoResolution } from '@/lib/video-pricing'
import type { KieRequestBody, KieApiResponse } from '@/lib/ai-types'

/**
 * 供应商适配层——视频任务提交半边（与 pollTask 并列的 seam）。
 *
 * 调用方（generate-story-video 路由）只认 submitTask(modelKey, input, meta)，
 * 不感知各模型的端点差异、请求体形状、taskType 字符串与 webhook 环境变量；
 * 供应商知识收敛在本模块的 VIDEO_SUBMITTERS 注册表内。
 *
 * 计费约束（methods.md §3a）：pointsAmount 一律由 lib/video-pricing 的
 * computeVideoPoints 按实际提交的 modelKey 计算——预检与落行同源，禁止手抄单价。
 * 金钱决策（余额闸门、扣点）不进本 seam：闸门在路由，扣点在 webhook 结算。
 */

export interface SubmitInput {
  imageUrl?: string
  prompt: string
  aspectRatio?: string
  duration?: string
  resolution?: string // 分辨率偏好（仅对 supportedResolutions 里的模型生效）
  videoStyle?: string
  additionalImageUrls?: string[]
  generationType?: string // 仅 Veo
  referenceVideoUrls?: string[] // 仅 Seedance 2.0 系
  referenceAudioUrls?: string[] // 仅 Seedance 2.0 系
}

export interface SubmitMeta {
  userId?: string
  projectId?: string | null
  versionId?: string | null
  versionGroupId?: string | null
  sceneIndex?: number
  sceneId?: string | null
  webhookUrl?: string
}

export type SubmitOutcome =
  | { ok: true; taskId: string; taskType: string; pointsAmount: number; webhook: boolean }
  | { ok: false; error: string }

const KIE_BASE = 'https://api.kie.ai/api/v1'
const JOBS_CREATE_URL = `${KIE_BASE}/jobs/createTask`

/** Kling/Seedance/Wan/HappyHorse/GeminiOmni/MiniMax 共用的视频 webhook 环境变量（惰性读取） */
function resolveSharedWebhook(meta: SubmitMeta): string | undefined {
  return process.env.KIE_VIDEO_WEBHOOK_URL || process.env.KIE_KLING_WEBHOOK_URL || meta.webhookUrl
}

/** 从 duration 字符串解析秒数（'6s'→6；缺省/无法解析时由各模型给默认值） */
function parseDurationSeconds(raw: string | undefined, fallback: number): number {
  const n = parseInt(String(raw ?? '').replace(/s$/i, ''), 10)
  return Number.isNaN(n) ? fallback : n
}

/** 区间收敛口径：空值用 emptyDefault，越界/非法用 fallback（与各模型历史实现一致） */
function clampedSeconds(raw: string | undefined, emptyDefault: number, min: number, max: number, fallback: number): number {
  const n = parseInt(String(raw || String(emptyDefault)).replace(/s$/i, ''), 10)
  if (Number.isNaN(n) || n < min || n > max) return fallback
  return n
}

/** 图生视频模型的公共校验：imageUrl + prompt（错误文案按模型微调） */
function imageAndPromptValidator(imageMsg = 'Image URL is required') {
  return (input: SubmitInput): string | null => {
    if (!input.imageUrl || !input.imageUrl.trim()) return imageMsg
    if (!input.prompt || !input.prompt.trim()) return 'Prompt is required'
    return null
  }
}

interface VideoSubmitter {
  label: string
  taskType: string
  endpointUrl: string
  parseDuration(raw: string | undefined): number
  validate(input: SubmitInput, seconds: number): string | null
  buildBody(input: SubmitInput, seconds: number, webhookUrl?: string, resolution?: VideoResolution): KieRequestBody
  /** 可选分辨率档（供 UI 选择与路由预检）；缺省 = 模型原生固定分辨率 */
  supportedResolutions?: VideoResolution[]
  /** 缺省用共享环境变量解析；happyHorse 等有专属兜底 URL 的模型覆写 */
  resolveWebhook?(meta: SubmitMeta): string | undefined
}

/** 视频提交注册表：key 与 video-pricing 的 VIDEO_MODEL_UNIT_POINTS 一一对应（有测试守卫） */
export const VIDEO_SUBMITTERS: Record<string, VideoSubmitter> = {
  /** Veo 系：三档共享请求构造；专属端点 veo/generate、顶层 imageUrls、generationType 自动判定 */
  ...(Object.fromEntries(
    (['veo31Lite', 'veo31Fast', 'veo31Quality'] as const).map(key => {
      const kieModel = key === 'veo31Lite' ? 'veo3_lite' : key === 'veo31Quality' ? 'veo3' : 'veo3_fast'
      const label = key === 'veo31Lite' ? 'Veo 3.1 Lite' : key === 'veo31Quality' ? 'Veo 3.1 Quality' : 'Veo 3.1'
      return [key, {
        label,
        taskType: 'generate_story_video_veo',
        endpointUrl: `${KIE_BASE}/veo/generate`,
        // Veo 生成基线为 720p；更高清晰度走官方 get-1080p/4k-video 升级端点（超分按钮，独立计费）
        supportedResolutions: [],
        // 历史口径：字面 '4s'/'6s'/'8s' 精确匹配，其余一律收敛到 8s
        parseDuration: (raw: string | undefined) => {
          const s = typeof raw === 'string' ? raw : ''
          return s === '4s' || s === '6s' || s === '8s' ? parseInt(s, 10) : 8
        },
        validate: (input: SubmitInput) => {
          if (!input.prompt || !input.prompt.trim()) return 'Prompt is required'
          return null
        },
        // Veo 使用专属回调环境变量
        resolveWebhook: (meta: SubmitMeta) => process.env.KIE_VEO_WEBHOOK_URL || meta.webhookUrl,
        buildBody: (input: SubmitInput, seconds: number, webhookUrl?: string) => {
          const styleMap: Record<string, string> = {
            anime: 'anime style, Japanese animation style',
            hollywood: 'Hollywood cinematic style, film-like quality',
            ads: 'advertisement style, educational video style',
          }
          const enhancedPrompt =
            input.videoStyle && input.videoStyle !== 'auto' && styleMap[input.videoStyle]
              ? `${input.prompt}, ${styleMap[input.videoStyle]}`
              : input.prompt

          // 合并图片：imageUrl 优先，其后为 additionalImageUrls
          const allImageUrls: string[] = []
          if (input.imageUrl && input.imageUrl.trim()) allImageUrls.push(input.imageUrl)
          if (input.additionalImageUrls && input.additionalImageUrls.length > 0) {
            allImageUrls.push(...input.additionalImageUrls.filter(u => u && u.trim()))
          }

          let generationType = input.generationType || ''
          if (!generationType) {
            // 自动判断：1-2 张 → 首尾帧；0 或 3+ 张 → 参考图模式
            generationType = allImageUrls.length === 1 || allImageUrls.length === 2
              ? 'FIRST_AND_LAST_FRAMES_2_VIDEO'
              : 'REFERENCE_2_VIDEO'
          }
          if (generationType === 'REFERENCE_2_VIDEO' && key === 'veo31Lite') {
            console.warn('[providers/submit] [Veo] REFERENCE_2_VIDEO 模式不支持 veo3_lite')
          }

          let imageUrls: string[] = []
          if (generationType === 'FIRST_AND_LAST_FRAMES_2_VIDEO') {
            if (allImageUrls.length === 1) imageUrls = [allImageUrls[0]]
            else if (allImageUrls.length >= 2) imageUrls = [allImageUrls[0], allImageUrls[1]]
            else if (input.imageUrl && input.imageUrl.trim()) imageUrls = [input.imageUrl]
            else console.warn('[providers/submit] [Veo] FIRST_AND_LAST_FRAMES_2_VIDEO 模式需要至少1张图片')
          } else if (generationType === 'REFERENCE_2_VIDEO') {
            const refUrls = allImageUrls.slice(0, 3)
            if (refUrls.length > 0) imageUrls = refUrls
            else if (input.imageUrl && input.imageUrl.trim()) imageUrls = [input.imageUrl]
            else console.warn('[providers/submit] [Veo] REFERENCE_2_VIDEO 模式需要至少1张图片')
          } else if (input.imageUrl && input.imageUrl.trim()) {
            imageUrls = [input.imageUrl]
          } else {
            console.warn('[providers/submit] [Veo] 默认模式需要 imageUrl')
          }

          const body: KieRequestBody = {
            prompt: enhancedPrompt,
            model: kieModel,
            generationType,
            aspect_ratio: input.aspectRatio === '16:9' || input.aspectRatio === '9:16' ? input.aspectRatio : '16:9',
            duration: seconds,
            enableTranslation: true,
            imageUrls,
          }
          if (webhookUrl) body.callBackUrl = webhookUrl
          return body
        },
      } satisfies VideoSubmitter]
    }),
  ) as Record<string, VideoSubmitter>),
  /** Seedance 系：四个 modelKey 共享一套请求构造，仅供应商 model/taskType/时长上限不同 */
  ...(Object.fromEntries(
    (['seedance25', 'seedance2Fast', 'seedance2Mini', 'seedance2'] as const).map(key => {
      const is25 = key === 'seedance25'
      const isFast = key === 'seedance2Fast'
      const isMini = key === 'seedance2Mini'
      const kieModel = is25 ? 'bytedance/seedance-2-5' : isMini ? 'bytedance/seedance-2-mini' : isFast ? 'bytedance/seedance-2-fast' : 'bytedance/seedance-2'
      const taskType = is25 ? 'seedance_2_5_video' : isMini ? 'seedance_2_0_mini_video' : isFast ? 'seedance_2_0_fast_video' : 'seedance_2_0_video'
      const label = is25 ? 'Seedance 2.5' : isMini ? 'Seedance 2.0 Mini' : isFast ? 'Seedance 2.0 Fast' : 'Seedance 2.0'
      return [key, {
        label,
        taskType,
        endpointUrl: JOBS_CREATE_URL,
        // 官方口径：2.5 支持 480p/720p/1080p，其余 480p/720p
        supportedResolutions: (is25 ? ['480p', '720p', '1080p'] : ['480p', '720p']) as VideoResolution[],
        // 历史口径：4..max 之外收敛（2.5 上限 30s 收敛 5s；其余上限 15s 收敛 8s；未传默认 5s）
        parseDuration: (raw: string | undefined) => clampedSeconds(raw, 5, 4, is25 ? 30 : 15, is25 ? 5 : 8),
        validate: imageAndPromptValidator(),
        buildBody: (input: SubmitInput, seconds: number, webhookUrl?: string, resolution?: VideoResolution) => {
          const lastFrameUrl = input.additionalImageUrls?.[0] || ''
          const body: KieRequestBody = {
            model: kieModel,
            input: {
              prompt: input.prompt,
              first_frame_url: input.imageUrl,
              generate_audio: true, // 默认开启声音
              resolution: resolution ?? '720p',
              aspect_ratio: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'].includes(input.aspectRatio || '') ? input.aspectRatio! : '16:9',
              duration: seconds,
              web_search: false,
            },
          }
          if (lastFrameUrl) body.input!.last_frame_url = lastFrameUrl
          // Seedance 2.0 多模态参考：上传的视频/音频各截前 3 个
          const refVideoUrls = (input.referenceVideoUrls || []).filter(u => typeof u === 'string' && u.trim().length > 0)
          const refAudioUrls = (input.referenceAudioUrls || []).filter(u => typeof u === 'string' && u.trim().length > 0)
          if (refVideoUrls.length > 0) body.input!.reference_video_urls = refVideoUrls.slice(0, 3)
          if (refAudioUrls.length > 0) body.input!.reference_audio_urls = refAudioUrls.slice(0, 3)
          if (webhookUrl) body.callBackUrl = webhookUrl
          return body
        },
      } satisfies VideoSubmitter]
    }),
  ) as Record<string, VideoSubmitter>),
  happyHorse: {
    label: 'HappyHorse',
    taskType: 'happyhorse_video',
    endpointUrl: JOBS_CREATE_URL,
    // 历史口径：3-15s 之外的输入一律收敛到 5s（计费按收敛后时长）
    parseDuration: raw => clampedSeconds(raw, 5, 3, 15, 5),
    validate: imageAndPromptValidator(),
    // 历史兜底：环境变量与调用方都未配置时，回退本服务 video-webhook
    //（带 projectId 时附场景定位参数，格式与历史一致）
    resolveWebhook: meta => {
      const envWebhook = process.env.KIE_VIDEO_WEBHOOK_URL || process.env.KIE_KLING_WEBHOOK_URL
      if (envWebhook) return envWebhook
      if (meta.webhookUrl) return meta.webhookUrl
      const self = `${process.env.NEXT_PUBLIC_APP_URL}/api/ai/kie/video-webhook`
      if (meta.projectId) {
        return `${self}?projectId=${meta.projectId}&sceneIndex=${meta.sceneIndex}&sceneId=${meta.sceneId}&versionId=${meta.versionId}&versionGroupId=${meta.versionGroupId}`
      }
      return self
    },
    buildBody: (input, seconds, webhookUrl) => {
      const body: KieRequestBody = {
        model: 'happyhorse-1-1/image-to-video',
        input: {
          prompt: input.prompt,
          image_urls: [input.imageUrl!],
          resolution: '720p',
          duration: seconds,
        },
      }
      if (webhookUrl) body.callBackUrl = webhookUrl
      return body
    },
  },
  kling3: {
    label: 'Kling 3.0',
    taskType: 'kling_3_0_video',
    endpointUrl: JOBS_CREATE_URL,
    // 历史口径：3-15s 之外的输入一律收敛到 5s（计费按收敛后时长）
    parseDuration: raw => clampedSeconds(raw, 5, 3, 15, 5),
    validate: imageAndPromptValidator(),
    buildBody: (input, seconds, webhookUrl) => {
      const lastFrameUrl = input.additionalImageUrls?.[0]
      const styleMap: Record<string, string> = {
        anime: 'anime style, Japanese animation style',
        hollywood: 'Hollywood cinematic style, film-like quality, dramatic lighting, cinematic color grading',
        ads: 'advertisement style, educational video style',
      }
      const enhancedPrompt =
        input.videoStyle && input.videoStyle !== 'auto' && styleMap[input.videoStyle]
          ? `${input.prompt}, ${styleMap[input.videoStyle]}`
          : input.prompt
      const body: KieRequestBody = {
        model: 'kling-3.0/video',
        input: {
          prompt: enhancedPrompt,
          image_urls: lastFrameUrl ? [input.imageUrl!, lastFrameUrl] : [input.imageUrl!],
          duration: String(seconds),
          aspect_ratio: ['16:9', '9:16', '1:1'].includes(input.aspectRatio || '') ? input.aspectRatio! : '16:9',
          mode: 'std',
          sound: true,
          multi_shots: false, // false = 首尾帧模式（历史口径）
        },
      }
      if (webhookUrl) body.callBackUrl = webhookUrl
      return body
    },
  },
  geminiOmni: {
    label: 'Gemini Omni',
    taskType: 'gemini_omni_video',
    endpointUrl: JOBS_CREATE_URL,
    parseDuration: raw => parseDurationSeconds(raw, 8),
    validate: (input, seconds) => {
      if (!input.prompt || !input.prompt.trim()) return 'Prompt is required'
      if (![4, 6, 8, 10].includes(seconds)) return `Gemini Omni 只支持 4/6/8/10s，当前: ${seconds}s`
      return null
    },
    buildBody: (input, seconds, webhookUrl) => {
      const allImageUrls: string[] = []
      if (input.imageUrl && input.imageUrl.trim()) allImageUrls.push(input.imageUrl.trim())
      if (input.additionalImageUrls && input.additionalImageUrls.length > 0) {
        allImageUrls.push(...input.additionalImageUrls.filter(u => u && u.trim()))
      }
      const body: KieRequestBody = {
        model: 'gemini-omni-video',
        input: {
          prompt: input.prompt.trim(),
          duration: String(seconds),
          aspect_ratio: input.aspectRatio || '16:9',
          resolution: '1080p',
        },
      }
      if (allImageUrls.length > 0) body.input!.image_urls = allImageUrls.slice(0, 7)
      if (webhookUrl) body.callBackUrl = webhookUrl
      return body
    },
  },
  wan27: {
    label: 'Wan 2.7',
    taskType: 'wan_2_7_video',
    endpointUrl: JOBS_CREATE_URL,
    // 历史口径：2-15s 之外的输入一律收敛到 5s（计费按收敛后时长）
    parseDuration: raw => clampedSeconds(raw, 5, 2, 15, 5),
    validate: imageAndPromptValidator(),
    buildBody: (input, seconds, webhookUrl) => {
      const lastFrameUrl = input.additionalImageUrls?.[0] || ''
      const body: KieRequestBody = {
        model: 'wan/2-7-image-to-video',
        input: {
          prompt: input.prompt,
          first_frame_url: input.imageUrl,
          resolution: '720p',
          duration: seconds,
          prompt_extend: true,
          watermark: false,
          nsfw_checker: false,
          driving_audio_url: '', // 空字符串触发自动音频（历史口径）
        },
      }
      if (lastFrameUrl) body.input!.last_frame_url = lastFrameUrl
      if (webhookUrl) body.callBackUrl = webhookUrl
      return body
    },
  },
  minimaxH3: {
    label: 'MiniMax H3',
    taskType: 'minimax_h3_video',
    endpointUrl: JOBS_CREATE_URL,
    // 历史口径：4-15s 之外的输入一律收敛到 6s（计费按收敛后时长）
    parseDuration: raw => clampedSeconds(raw, 6, 4, 15, 6),
    validate: imageAndPromptValidator('Image URL is required for MiniMax H3'),
    buildBody: (input, seconds, webhookUrl) => {
      const lastFrameUrl = input.additionalImageUrls?.[0] || ''
      const body: KieRequestBody = {
        model: 'minimax-h3/image-to-video',
        input: {
          prompt: input.prompt,
          first_frame_url: input.imageUrl || undefined,
          last_frame_url: lastFrameUrl || undefined,
          duration: seconds,
          resolution: '768p',
        },
      }
      if (webhookUrl) body.callBackUrl = webhookUrl
      return body
    },
  },
}

/** 提交视频生成任务：调供应商 + 落任务行（claim 行），返回供应商 taskId */
export async function submitTask(modelKey: string, input: SubmitInput, meta: SubmitMeta): Promise<SubmitOutcome> {
  const sub = VIDEO_SUBMITTERS[modelKey]
  if (!sub) return { ok: false, error: `Unsupported model: ${modelKey}` }

  const seconds = sub.parseDuration(input.duration)
  const invalid = sub.validate(input, seconds)
  if (invalid) return { ok: false, error: invalid }

  const webhookUrl = sub.resolveWebhook ? sub.resolveWebhook(meta) : resolveSharedWebhook(meta)

  // 分辨率偏好：仅当模型声明支持该档时生效，否则回落模型原生默认（计费同源取同口径）
  const requested = input.resolution as VideoResolution | undefined
  const resolution = requested && sub.supportedResolutions?.includes(requested) ? requested : undefined
  const body = sub.buildBody(input, seconds, webhookUrl, resolution)

  console.log(`[providers/submit] [${sub.label}] 创建视频任务:`, {
    promptLength: input.prompt?.length,
    duration: seconds,
    modelKey,
    useWebhook: !!webhookUrl,
  })

  const apiKey = process.env.KIE_API_KEY
  let data: KieApiResponse
  try {
    const response = await fetch(sub.endpointUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const responseText = await response.text()
    if (!response.ok) {
      console.error(`[providers/submit] [${sub.label}] API error:`, response.status, responseText)
      return { ok: false, error: `API error: ${response.status}` }
    }
    try {
      data = JSON.parse(responseText)
    } catch {
      console.error(`[providers/submit] [${sub.label}] 解析响应失败:`, responseText)
      return { ok: false, error: 'Invalid API response' }
    }
  } catch (err) {
    console.error(`[providers/submit] [${sub.label}] 请求异常:`, err)
    return { ok: false, error: 'Invalid API response' }
  }

  if (data.code !== 200) {
    console.error(`[providers/submit] [${sub.label}] 生成失败:`, data.msg)
    return { ok: false, error: data.msg || 'Video generation failed' }
  }

  const taskId = data.data?.taskId
  if (!taskId) {
    console.error(`[providers/submit] [${sub.label}] 未返回 taskId:`, data)
    return { ok: false, error: 'No task ID returned' }
  }

  console.log(`[providers/submit] [${sub.label}] 任务创建成功:`, { taskId })

  // pointsAmount 单一事实源：video-pricing（预检与落行同源，分辨率档位计入单价）
  const pointsAmount = computeVideoPointsFor(modelKey, seconds, resolution)

  if (meta.userId) {
    try {
      await db.insert(aiGenerationTasks).values({
        id: uuidv4(),
        taskId,
        userId: meta.userId,
        taskType: sub.taskType,
        pointsAmount,
        model: modelKey,
        pointsDeducted: false,
        status: 'pending',
        projectId: meta.projectId || null,
        versionId: meta.versionId || null,
        itemId: meta.sceneId ? String(meta.sceneIndex) : null,
        versionGroupId: meta.versionGroupId || null,
        newVersionId: null,
      })
      console.log(`[providers/submit] [${sub.label}] 任务映射已存储:`, {
        taskId, userId: meta.userId, pointsAmount, projectId: meta.projectId,
        sceneIndex: meta.sceneIndex, sceneId: meta.sceneId, versionId: meta.versionId, versionGroupId: meta.versionGroupId,
      })
    } catch (error) {
      console.error(`[providers/submit] [${sub.label}] 存储任务映射失败:`, error)
    }
  }

  return { ok: true, taskId, taskType: sub.taskType, pointsAmount, webhook: !!webhookUrl }
}

/**
 * 计费秒数口径：与 submitTask 落行所用秒数完全同源（含各模型收敛/默认规则）。
 * 路由余额预检必须经此函数取秒数——methods.md §3a：同一事实不得存在两份手抄。
 */
export function resolveBillableSeconds(modelKey: string, rawDuration: string | undefined): number {
  return VIDEO_SUBMITTERS[modelKey]?.parseDuration(rawDuration) ?? 8
}

/** 模型可选分辨率档（UI 选择器与路由预检共用）；空数组 = 模型原生固定分辨率 */
export function videoModelSupportedResolutions(modelKey: string): VideoResolution[] {
  return VIDEO_SUBMITTERS[modelKey]?.supportedResolutions ?? []
}

/** 模型展示名（注册表单源，取代历史上散落的 getModelName 映射） */
export function videoModelLabel(modelKey: string): string {
  return VIDEO_SUBMITTERS[modelKey]?.label ?? 'Veo 3.1'
}
