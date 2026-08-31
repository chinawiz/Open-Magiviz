import createNextIntlPlugin from 'next-intl/plugin'
import { withSentryConfig } from '@sentry/nextjs'

const withNextIntl = createNextIntlPlugin('./i18n/request.js')

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // PostHog 同源代理：规避广告拦截器直连丢事件（middleware matcher 已同步排除 /ingest）
  ...(process.env.NEXT_PUBLIC_POSTHOG_KEY
    ? {
        async rewrites() {
          return [
            { source: '/ingest/static/:path*', destination: 'https://us-assets.i.posthog.com/static/:path*' },
            { source: '/ingest/:path*', destination: 'https://us.i.posthog.com/:path*' },
          ]
        },
      }
    : {}),
}

/**
 * Sentry 仅在配置了 DSN 时包一层（sourcemap 上传需 SENTRY_AUTH_TOKEN，缺省静默跳过），
 * 未配置时构建路径与无 Sentry 完全一致。
 */
const withIntl = withNextIntl(nextConfig)

export default process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(withIntl, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // Turbopack + Vercel(N16) 把客户端产物放进 static/immutable/chunks，
      // 插件默认 glob 只认 static/chunks 会静默漏传（getsentry/sentry-javascript#21962）
      sourcemaps: {
        assets: ['.next/server', '.next/static'],
        deleteSourcemapsAfterUpload: true,
      },
    })
  : withIntl

