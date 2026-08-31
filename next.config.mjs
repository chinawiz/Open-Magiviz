import createNextIntlPlugin from 'next-intl/plugin'
import { withSentryConfig } from '@sentry/nextjs'

const withNextIntl = createNextIntlPlugin('./i18n/request.js')

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
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
      silent: true,
      disableLogger: true,
    })
  : withIntl

