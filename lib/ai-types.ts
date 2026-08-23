/**
 * 外部 AI 服务（Kie.ai / fal / Gemini 等）请求与响应类型。
 * 这些类型用于收敛 app/api/ai/* 路由中散落的 `any`，把外部 JSON 载荷收敛成可校验的结构。
 * 外部 API 字段以实际返回为准，主体字段在这里声明，其余保持宽松（index signature）。
 */

// —— 外部任务创建响应（Kie.ai createTask） ——
export interface KieCreateResponse {
  code?: number
  msg?: string
  data?: {
    taskId?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

// —— 外部任务状态查询 / 回调响应的统一形状 ——
// 覆盖了 Veo / Kling / Seedance / Wan / HappyHorse / Gemini Omni 多种返回格式。
// 注意：部分回调（如视频通用回调）会把 resultUrls / videoUrl 直接放在顶层，
// 因此顶层也声明这些可选字段，避免轮询/回调代码里 `taskResult.resultUrls` 访问报错。
export interface KieApiResponse {
  code?: number
  msg?: string
  taskId?: string
  task_id?: string
  state?: string
  taskStatus?: string
  successFlag?: number
  resultJson?: string
  resultUrls?: string[]
  videoUrl?: string
  url?:	 string
  urls?: string[]
  originUrls?: string[]
  duration?: string
  aspectRatio?: string
  resolution?: string
  fallbackFlag?: boolean
  // 部分回调（如 veo-webhook）直接把 data 作为该类型传入，保留与嵌套 data 一致的字段
  result?: {
    resultUrls?: string[]
    videoUrl?: string
    url?: string
    urls?: string[]
    failMsg?: string
    errorMessage?: string
    message?: string
    duration?: string
    aspectRatio?: string
    resolution?: string
    [key: string]: unknown
  }
  // 部分回调/轮询（如 Veo 轮询）直接把响应放在 response 字段中
  response?: {
    resultUrls?: string[]
    videoUrl?: string
    url?: string
    urls?: string[]
    errorMessage?: string
    error?: string
    [key: string]: unknown
  }
  info?: {
    resultUrls?: string[]
    originUrls?: string[]
    resolution?: string
    [key: string]: unknown
  }
  errorMessage?: string
  error?: string
  message?: string
  data?: {
    taskId?: string
    task_id?: string
    state?: string
    taskStatus?: string
    successFlag?: number
    resultJson?: string
    result?: {
      resultUrls?: string[]
      videoUrl?:  string
      url?: string
      urls?: string[]
      failMsg?: string
      errorMessage?: string
      message?: string
      duration?: string
      aspectRatio?: string
      resolution?: string
      [key: string]: unknown
    }
    response?: {
      resultUrls?: string[]
      videoUrl?: string
      url?: string
      urls?: string[]
      failMsg?: string
      errorMessage?: string
      error?: string
      [key: string]: unknown
    }
    info?: {
      resultUrls?: string[]
      originUrls?: string[]
      resolution?: string
      [key: string]: unknown
    }
    errorMessage?: string
    error?: string
    failMsg?: string
    message?: string
    fallbackFlag?: boolean
    [key: string]: unknown
  }
  [key: string]: unknown
}

/**
 * 通用 JSON 深拷贝助手：用于读取 DB 中 JSON/字符串形式的 JSON 列。
 * 返回 null 表示空值或解析失败，调用方通常用 `safeJsonCopy<T>(x) || []` 兜底。
 */
export const safeJsonCopy = <T = Record<string, unknown>>(value: unknown): T | null => {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }
  return JSON.parse(JSON.stringify(value)) as T
}

// —— Kie.ai 任务生成请求体（图生图 / 图生视频共用，字段按需裁剪） ——
// `input` 设为可选：Veo / Gemini Omni 等部分模型直接把 image_urls/prompt 放在顶层，没有 input 包裹。
export interface KieRequestBody {
  model: string
  input?: {
    prompt?: string
    image_input?: string[]
    image_urls?: string[]
    aspect_ratio?: string
    resolution?: string
    output_format?: string
    first_frame_url?: string
    last_frame_url?: string | undefined
    duration?: number | string
    generate_audio?: boolean
    web_search?: boolean
    prompt_extend?: boolean
    watermark?: boolean
    nsfw_checker?: boolean
    driving_audio_url?: string
    reference_video_urls?: string[]
    reference_audio_urls?: string[]
    [key: string]: unknown
  }
  generationType?: string
  enableTranslation?: boolean
  callBackUrl?: string
  imageUrls?: string[]
  [key: string]: unknown
}

// —— 单张生成结果（角色图 / 分镜图） ——
export interface GeneratedImage {
  url: string
}

export interface SingleGenerationResult {
  success: boolean
  images?: GeneratedImage[]
  requestId?: string
  error?: string
}

// —— 单条场景数据（剧情详情 / 分镜 / 剧情视频共用，宽松扩展） ——
export interface SceneDataItem {
  id?: number | string
  sceneId?: string
  title?: string
  description?: string
  plot?: string
  duration?: number
  aspectRatio?: string
  imageUrl?: string
  [key: string]: unknown
}

// —— LLM 剧情详情生成结果 ——
export interface StoryGenerationResult {
  scenes?: SceneDataItem[]
  characters?: unknown[]
  title?: string
  summary?: string
  videoStyle?: string
  aspectRatio?: string
  [key: string]: unknown
}

// —— 批量生成结果条目 ——
export interface BatchResultItem {
  characterId?: string | null
  sceneId?: string | null
  images?: GeneratedImage[] | { firstFrame?: { url: string }; lastFrame?: { url: string }; default?: { url: string } }
  requestId?: string
  requestIds?: string[]
  error?: string
}
