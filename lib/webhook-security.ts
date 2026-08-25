import crypto from 'crypto'
import type { NextRequest } from 'next/server'

/**
 * 外部 AI 回调验签统一策略（安全设计 T-01/T-08 落地）：
 * - 生产环境 fail-closed：密钥缺失、签名头缺失、签名不符一律 401；
 * - 开发环境密钥未配置时告警放行，便于本地联调。
 *
 * Kie.ai 回调使用共享 HMAC 密钥（签名串为 `${taskId}.${timestamp}`，
 * 能力受限于供应商，是否支持全请求体签名待 U-01 核实）。
 * FAL 回调无供应商侧签名能力，改用提交时附加在回调 URL 上的共享 token。
 */

const isProduction = process.env.NODE_ENV === 'production'

export type WebhookRejection = { status: number; error: string }

function timingSafeEqualStr(expected: string, received: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/** Kie 系 webhook 验签；通过返回 null，否则返回拒绝响应 */
export function verifyKieWebhook(opts: {
  taskId: string
  timestamp: string | null
  signature: string | null
  secret: string | undefined
  label: string
}): WebhookRejection | null {
  if (!opts.secret) {
    if (isProduction) {
      console.error(`[${opts.label}] HMAC 密钥未配置，生产环境拒绝回调`)
      return { status: 401, error: 'Webhook signature not configured' }
    }
    console.warn(`[${opts.label}] HMAC 密钥未配置，开发环境跳过验签`)
    return null
  }
  if (!opts.timestamp || !opts.signature) {
    console.error(`[${opts.label}] 缺少签名头`)
    return { status: 401, error: 'Missing signature headers' }
  }
  const hmac = crypto.createHmac('sha256', opts.secret)
  hmac.update(`${opts.taskId}.${opts.timestamp}`)
  const expected = hmac.digest('base64')
  if (!timingSafeEqualStr(expected, opts.signature)) {
    console.error(`[${opts.label}] 签名验证失败`)
    return { status: 401, error: 'Invalid signature' }
  }
  return null
}

const FAL_WEBHOOK_TOKEN_SECRET = process.env.FAL_WEBHOOK_TOKEN_SECRET

/** 提交 FAL 任务时为回调 URL 附加共享 token（仅服务端持有） */
export function withFalWebhookToken(url: string | undefined): string | undefined {
  if (!url) return undefined
  if (!FAL_WEBHOOK_TOKEN_SECRET) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}token=${encodeURIComponent(FAL_WEBHOOK_TOKEN_SECRET)}`
}

/** 校验 FAL 回调 URL 上的 token；通过返回 null，否则返回拒绝响应 */
export function verifyFalWebhookToken(request: NextRequest): WebhookRejection | null {
  if (!FAL_WEBHOOK_TOKEN_SECRET) {
    if (isProduction) {
      console.error('[FAL Compose Webhook] FAL_WEBHOOK_TOKEN_SECRET 未配置，生产环境拒绝回调')
      return { status: 401, error: 'Webhook token not configured' }
    }
    console.warn('[FAL Compose Webhook] FAL_WEBHOOK_TOKEN_SECRET 未配置，开发环境跳过验签')
    return null
  }
  const token = request.nextUrl.searchParams.get('token') || ''
  if (!token || !timingSafeEqualStr(FAL_WEBHOOK_TOKEN_SECRET, token)) {
    console.error('[FAL Compose Webhook] token 校验失败')
    return { status: 401, error: 'Invalid webhook token' }
  }
  return null
}
