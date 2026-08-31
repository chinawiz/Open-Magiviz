/**
 * Sentry 浏览器端接线（Next 自动加载本文件）。
 * 未配置 NEXT_PUBLIC_SENTRY_DSN 时 no-op；Replay 低采样率，只留疑难会话。
 */
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  void import('@sentry/nextjs').then((Sentry) => {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0.05,
      replaysOnErrorSampleRate: 1.0,
    })
  })
}
