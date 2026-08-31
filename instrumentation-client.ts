/**
 * Sentry 浏览器端接线（Next 自动加载本文件）。
 * 未配置 NEXT_PUBLIC_SENTRY_DSN 时 init 为 no-op；Replay 低采样率，错误会话 100% 回放。
 */
import * as Sentry from '@sentry/nextjs'

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.05,
    replaysOnErrorSampleRate: 1.0,
  })
}

// SDK 要求的导航埋点钩子（构建日志 ACTION REQUIRED，缺失则路由切换不产生 span）
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
