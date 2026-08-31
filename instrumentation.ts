/**
 * Sentry 服务端接线（Next 15+ instrumentation hook）。
 * 未配置 NEXT_PUBLIC_SENTRY_DSN 时不初始化，构建与运行时保持零开销；
 * DSN 在 Vercel 环境变量配置后重部署即生效。
 */
import type * as SentryType from '@sentry/nextjs'

export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const Sentry = await import('@sentry/nextjs')
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
  })
}

export async function onRequestError(
  ...args: Parameters<typeof SentryType.captureRequestError>
) {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return
  const Sentry = await import('@sentry/nextjs')
  return Sentry.captureRequestError(...args)
}
