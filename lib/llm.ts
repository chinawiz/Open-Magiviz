/**
 * 统一的 LLM（ZenMux 兼容 OpenAI 协议）调用工具。
 * 集中管理 API 地址、密钥读取、默认模型与 JSON 容错解析，
 * 供所有 AI 路由复用，避免在各路由中重复硬编码。
 */

export const ZENMUX_API_URL = 'https://zenmux.ai/api/v1/chat/completions'
export const DEFAULT_MODEL = 'google/gemini-3-flash-preview'
export const DEFAULT_MAX_TOKENS = 4096
export const DEFAULT_TEMPERATURE = 0.7

/** 模型调用失败时的统一错误类型，携带 HTTP 状态与原始错误文本 */
export class LLMError extends Error {
  status: number
  details?: unknown

  constructor(message: string, status = 500, details?: unknown) {
    super(message)
    this.name = 'LLMError'
    this.status = status
    this.details = details
  }
}

export interface ChatCompletionOptions {
  /** 系统提示词（可省略） */
  system?: string
  /** 用户提示词 */
  user: string
  /** 模型名，缺省使用 DEFAULT_MODEL */
  model?: string
  maxTokens?: number
  temperature?: number
  /** 允许覆盖默认 API Key（测试/多租户场景） */
  apiKey?: string
  /** 允许覆盖默认端点（自建路由测试/兼容网关场景）；缺省 ZenMux */
  baseUrl?: string
}

/** 调用 ZenMux 聊天补全接口，返回首个 message 的文本内容 */
export async function callChatCompletion(opts: ChatCompletionOptions): Promise<string> {
  const apiKey = opts.apiKey ?? process.env.ZENMUX_API_KEY
  if (!apiKey) {
    throw new LLMError('ZenMux API key not configured (ZENMUX_API_KEY)', 500)
  }

  const payload = {
    model: opts.model ?? DEFAULT_MODEL,
    messages: [
      ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
      { role: 'user' as const, content: opts.user },
    ],
    maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
  }

  const response = await fetch(opts.baseUrl ?? ZENMUX_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    // 透传上游 HTTP 状态（401/402/429/5xx 等），便于调用方按状态码区分限流/鉴权/服务错误
    throw new LLMError('Failed to generate from AI service', response.status, errorText)
  }

  const data = await response.json()
  return data?.choices?.[0]?.message?.content
}

/** 从模型返回文本中解析 JSON（兼容 ```json ... ``` 等包裹） */
export function parseJsonFromContent(content: string): unknown {
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  const candidate = jsonMatch ? jsonMatch[0] : content
  return JSON.parse(candidate)
}
