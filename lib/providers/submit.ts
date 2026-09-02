import { db } from '@/lib/db'
import { aiGenerationTasks } from '@/lib/schema'
import { v4 as uuidv4 } from 'uuid'
import { computeVideoPoints } from '@/lib/video-pricing'
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

interface VideoSubmitter {
  label: string
  taskType: string
  endpointUrl: string
  parseDuration(raw: string | undefined): number
  validate(input: SubmitInput, seconds: number): string | null
  buildBody(input: SubmitInput, seconds: number, webhookUrl?: string): KieRequestBody
}

const VIDEO_SUBMITTERS: Record<string, VideoSubmitter> = {
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
}

/** 提交视频生成任务：调供应商 + 落任务行（claim 行），返回供应商 taskId */
export async function submitTask(modelKey: string, input: SubmitInput, meta: SubmitMeta): Promise<SubmitOutcome> {
  const sub = VIDEO_SUBMITTERS[modelKey]
  if (!sub) return { ok: false, error: `Unsupported model: ${modelKey}` }

  const seconds = sub.parseDuration(input.duration)
  const invalid = sub.validate(input, seconds)
  if (invalid) return { ok: false, error: invalid }

  const webhookUrl = resolveSharedWebhook(meta)
  const body = sub.buildBody(input, seconds, webhookUrl)

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

  // pointsAmount 单一事实源：video-pricing（预检与落行同源，禁止手抄单价）
  const pointsAmount = computeVideoPoints(modelKey, seconds)

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
