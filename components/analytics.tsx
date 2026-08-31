'use client'

/**
 * PostHog 产品分析接线：未配置 NEXT_PUBLIC_POSTHOG_KEY 时整体 no-op。
 * 采集走 /ingest 同源代理（见 next.config.mjs rewrites），规避广告拦截器；
 * 页面浏览由 PostHogPageView 按路由变化手动上报（App Router 不触发原生 pageview）。
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
    if (!key) return
    posthog.init(key, {
      api_host: '/ingest',
      ui_host: 'https://us.posthog.com',
      capture_pageview: false,
      persistence: 'localStorage+cookie',
    })
  }, [])

  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return <>{children}</>
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}

export function PostHogPageView() {
  const pathname = usePathname()
  useEffect(() => {
    if (pathname && posthog.__loaded) {
      posthog.capture('$pageview', { $current_url: window.location.href })
    }
  }, [pathname])
  return null
}
