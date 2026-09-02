/**
 * Creem 内容安全审核（Moderation API）——所有 prompt 生成入口的前置闸。
 *
 * 文档：https://docs.creem.io/features/moderation
 * 审核合规硬约束：
 * - flag 与 deny 同待遇：一律拒绝生成（文档明示 flag 受 Creem 重点监控）；
 * - fail-closed：审核服务超时/5xx/生产缺 key 时拒绝生成——fail-open 视为政策违规。
 *   唯一放宽：非生产环境未配置 key 时放行并告警（本地开发便利）。
 * 计费：$0.30/千 units，1 unit = 1000 字符；近期重复 prompt 命中缓存 0 units。
 * 范围：只审用户自由文本（prompt/描述），不审模板与系统指令。
 */

export type ModerationOutcome =
  | { ok: true }
  | { ok: false; code: 'prompt_rejected' | 'moderation_unavailable' }

const MODERATION_TIMEOUT_MS = 5000

/** 生产端点；sandbox 阶段可设 CREEM_MODERATION_API_BASE=https://test-api.creem.io 配 test key */
function moderationEndpoint(): string {
  const base = (process.env.CREEM_MODERATION_API_BASE || 'https://api.creem.io').replace(/\/$/, '')
  return `${base}/v1/moderation/prompt`
}

/** 拼接多个用户文本字段时的总量上限（避免超大 payload 触发不可靠 flag） */
export const MODERATION_MAX_CHARS = 24000

export async function moderatePrompt(
  prompt: string,
  opts: { externalId?: string } = {},
): Promise<ModerationOutcome> {
  const apiKey = process.env.CREEM_MODERATION_API_KEY
  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[moderation] 生产环境未配置 CREEM_MODERATION_API_KEY——fail-closed（fail-open 视为 Creem 政策违规）')
      return { ok: false, code: 'moderation_unavailable' }
    }
    console.warn('[moderation] 未配置 CREEM_MODERATION_API_KEY，非生产环境放行')
    return { ok: true }
  }

  if (!prompt || !prompt.trim()) return { ok: true }

  try {
    const res = await fetch(moderationEndpoint(), {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, external_id: opts.externalId }),
      signal: AbortSignal.timeout(MODERATION_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error('[moderation] 审核服务 HTTP 异常——fail-closed:', res.status)
      return { ok: false, code: 'moderation_unavailable' }
    }
    const data = (await res.json()) as { decision?: string }
    if (data?.decision === 'allow') return { ok: true }
    console.warn('[moderation] 拦截生成请求:', { decision: data?.decision, externalId: opts.externalId })
    return { ok: false, code: 'prompt_rejected' }
  } catch (err) {
    console.error('[moderation] 审核服务不可达——fail-closed:', err)
    return { ok: false, code: 'moderation_unavailable' }
  }
}

/** 把多个用户文本字段拼成待审核文本（过滤空值，超长截断） */
export function combineTextsForModeration(parts: Array<string | undefined | null>): string {
  return parts
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .join('\n')
    .slice(0, MODERATION_MAX_CHARS)
}

/** 路由统一错误响应体（errorKey 供前端特化处理，error 为用户可见文案） */
export function moderationErrorResponse(m: Extract<ModerationOutcome, { ok: false }>): {
  status: number
  body: { error: string; errorKey: string }
} {
  return m.code === 'prompt_rejected'
    ? { status: 400, body: { error: '内容未通过安全审核，请修改提示词后重试', errorKey: 'content_flagged' } }
    : { status: 503, body: { error: '内容安全审核服务暂时不可用，请稍后重试', errorKey: 'moderation_unavailable' } }
}
