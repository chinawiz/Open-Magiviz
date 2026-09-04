/**
 * 文本生成的生效模型路由包装（ADR-0001）。
 * 解析 capability 的有序候选：首条为自建端点时走 local adapter，
 * 失败/超时/形状不符自动落回注入的云端执行器；路由决策与回退元数据随结果返回，
 * 由调用方记 funnel 事件（provider=实际命中方、fallbackApplied、localError）。
 */

import { resolveActiveRoutes, type ActiveRouteEntry } from './router'
import { localChatCompletion, LocalProviderError, type LocalChatInput, type LocalEndpointConfig } from './local'

export interface RoutedChatResult {
  content: string
  /** 实际命中方：'local' 或云端 provider id（如 zenmux） */
  provider: string
  /** 实际命中的模型 id */
  model: string
  /** 自建失败后是否回退了云端 */
  fallbackApplied: boolean
  /** 回退发生时携带自建失败的归一原因（local:<phase>:<message>，截断） */
  localError?: string
}

/** 回退元数据载体：双失败重抛云端错误时挂在原错误上，保持 LLMError instanceof 语义 */
export interface RoutedMetaCarrier {
  routedMeta: Pick<RoutedChatResult, 'fallbackApplied' | 'localError'>
}

/** 从有序候选中取自建首条（endpoint 缺失视为未生效） */
export function pickLocalEntry(routes: ActiveRouteEntry[]): ActiveRouteEntry | null {
  const first = routes[0]
  return first?.provider === 'local' && first.endpoint ? first : null
}

/** 自建路由条目 → adapter 端点配置 */
export function toEndpointConfig(entry: ActiveRouteEntry): LocalEndpointConfig {
  const endpoint = entry.endpoint!
  return {
    baseUrl: endpoint.baseUrl,
    apiKey: endpoint.apiKey,
    modelId: endpoint.modelId,
    timeoutMs: endpoint.timeoutMs,
  }
}

/** 自建失败归一为 local:<phase>:<message>（截断 200，供 funnel 事件与日志） */
export function normalizeLocalError(err: unknown): string {
  const phase = err instanceof LocalProviderError ? err.phase : 'unknown'
  return `local:${phase}:${(err as Error).message}`.slice(0, 200)
}

export async function callChatCompletionActive(opts: {
  capability: 'script' | 'storyboard_text'
  /** 云端 provider id，funnel 记录用 */
  cloudProvider: string
  cloudModel: string
  input: LocalChatInput
  /** 云端执行器：各文本路由的云端调用形状不同（headers/payload/解析），由路由注入 */
  callCloud: () => Promise<string>
}): Promise<RoutedChatResult> {
  const routes = await resolveActiveRoutes(opts.capability)
  const localEntry = pickLocalEntry(routes)

  if (localEntry) {
    const endpointConfig = toEndpointConfig(localEntry)
    try {
      const content = await localChatCompletion(endpointConfig, opts.input)
      return { content, provider: 'local', model: endpointConfig.modelId, fallbackApplied: false }
    } catch (err) {
      const localError = normalizeLocalError(err)
      console.error(`[chat-active] ${opts.capability} 自建端点失败，回退云端:`, localError)
      try {
        const content = await opts.callCloud()
        return { content, provider: opts.cloudProvider, model: opts.cloudModel, fallbackApplied: true, localError }
      } catch (cloudErr) {
        // 双失败：保留回退痕迹后原样重抛云端错误（不破坏 LLMError instanceof 语义）
        const carrier = cloudErr as RoutedMetaCarrier
        carrier.routedMeta = { fallbackApplied: true, localError }
        throw cloudErr
      }
    }
  }

  const content = await opts.callCloud()
  return { content, provider: opts.cloudProvider, model: opts.cloudModel, fallbackApplied: false }
}
