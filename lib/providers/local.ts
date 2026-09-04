/**
 * 自建端点客户端——统一契约的 local 侧实现（ADR-0001）。
 * 自建服务暴露 OpenAI 兼容接口；全部 HTTP 细节（URL 拼装、超时、错误归一）
 * 收敛在本模块，fetch 可注入。错误按阶段归一：connect / timeout / http / shape。
 * baseUrl 约定包含到 /v1（如 http://dgx:8000/v1），尾斜杠容忍。
 */

import { DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from '@/lib/llm'

export type LocalCallPhase = 'connect' | 'timeout' | 'http' | 'shape'

/** 自建端点调用失败的统一错误类型，phase 供回退统计与告警归因 */
export class LocalProviderError extends Error {
  phase: LocalCallPhase
  status?: number
  details?: unknown

  constructor(phase: LocalCallPhase, message: string, status?: number, details?: unknown) {
    super(message)
    this.name = 'LocalProviderError'
    this.phase = phase
    this.status = status
    this.details = details
  }
}

export interface LocalEndpointConfig {
  baseUrl: string
  apiKey: string
  modelId: string
  timeoutMs: number
}

export interface LocalChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface LocalChatInput {
  system?: string
  user?: string
  /** 完整消息形态（OpenAI 兼容 messages 的文本子集）；提供时忽略 system/user 单槽 */
  messages?: LocalChatMessage[]
  maxTokens?: number
  temperature?: number
}

interface MinimalResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}

type FetchLike = (url: string, init?: RequestInit) => Promise<MinimalResponse>

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function authHeaders(apiKey: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
}

/** 带超时的请求执行；超时归一 phase=timeout，网络层失败归一 phase=connect */
async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<MinimalResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new LocalProviderError('timeout', `自建端点超时（>${timeoutMs}ms）: ${url}`)
    }
    throw new LocalProviderError('connect', `自建端点连接失败: ${(err as Error)?.message ?? err}`)
  } finally {
    clearTimeout(timer)
  }
}

/** 调自建端点的 chat completions，返回首条消息文本（与 lib/llm 的云端语义对齐） */
export async function localChatCompletion(
  endpoint: LocalEndpointConfig,
  input: LocalChatInput,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const url = `${normalizeBaseUrl(endpoint.baseUrl)}/chat/completions`
  const messages =
    input.messages ??
    [
      ...(input.system ? [{ role: 'system' as const, content: input.system }] : []),
      ...(input.user ? [{ role: 'user' as const, content: input.user }] : []),
    ]
  if (messages.length === 0) {
    throw new LocalProviderError('shape', 'localChatCompletion 需要至少一条消息（system/user/messages）')
  }
  const res = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: 'POST',
      headers: authHeaders(endpoint.apiKey),
      body: JSON.stringify({
        model: endpoint.modelId,
        messages,
        max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: input.temperature ?? DEFAULT_TEMPERATURE,
      }),
    },
    endpoint.timeoutMs,
  )

  if (!res.ok) {
    const errorText = await res.text()
    throw new LocalProviderError('http', `自建端点 HTTP ${res.status}: ${url}`, res.status, errorText)
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> }
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new LocalProviderError('shape', `自建端点响应形状不符（缺 choices[0].message.content）: ${url}`)
  }
  return content
}

export interface ProbeResult {
  ok: boolean
  latencyMs: number
  error?: string
}

/** 零成本探活：GET {baseUrl}/models，不真出图不烧 token（测试连接用） */
export async function probeEndpoint(
  endpoint: LocalEndpointConfig,
  fetchImpl: FetchLike = fetch,
): Promise<ProbeResult> {
  const startedAt = Date.now()
  const url = `${normalizeBaseUrl(endpoint.baseUrl)}/models`
  try {
    const res = await fetchWithTimeout(fetchImpl, url, { method: 'GET', headers: authHeaders(endpoint.apiKey) }, endpoint.timeoutMs)
    const latencyMs = Date.now() - startedAt
    if (!res.ok) {
      const errorText = await res.text()
      return { ok: false, latencyMs, error: `HTTP ${res.status}: ${errorText.slice(0, 200)}` }
    }
    return { ok: true, latencyMs }
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - startedAt, error: (err as Error).message }
  }
}

// ── OpenAI 兼容 images 协议（图像自建，ADR-0001 一期：仅文生图）──

export interface LocalImagesInput {
  prompt: string
  n?: number
}

export interface LocalImageResult {
  /** 网关返回 b64_json 时的解码前内容 */
  b64?: string
  /** 网关直接返回 URL 时（可能是局域网地址，调用方需转存） */
  url?: string
}

/** 调自建端点的 images generations（同步文生图），返回归一化的图像结果列表 */
export async function localImagesGenerate(
  endpoint: LocalEndpointConfig,
  input: LocalImagesInput,
  fetchImpl: FetchLike = fetch,
): Promise<LocalImageResult[]> {
  const url = `${normalizeBaseUrl(endpoint.baseUrl)}/images/generations`
  const res = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: 'POST',
      headers: authHeaders(endpoint.apiKey),
      body: JSON.stringify({
        model: endpoint.modelId,
        prompt: input.prompt,
        n: input.n ?? 1,
      }),
    },
    endpoint.timeoutMs,
  )

  if (!res.ok) {
    const errorText = await res.text()
    throw new LocalProviderError('http', `自建端点 HTTP ${res.status}: ${url}`, res.status, errorText)
  }

  const data = (await res.json()) as { data?: Array<{ b64_json?: unknown; url?: unknown }> }
  const items = Array.isArray(data?.data) ? data.data : []
  const results: LocalImageResult[] = []
  for (const item of items) {
    if (typeof item?.b64_json === 'string') results.push({ b64: item.b64_json })
    else if (typeof item?.url === 'string') results.push({ url: item.url })
  }
  if (results.length === 0) {
    throw new LocalProviderError('shape', `自建端点响应形状不符（data 中无 b64_json/url）: ${url}`)
  }
  return results
}
