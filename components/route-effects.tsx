'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

// <html lang> 由根布局在服务端首载时按 next-intl 请求头输出一次；客户端切换语言
// （/en/* ↔ /zh/* 的路由内跳转）不会重新渲染根布局，lang 会停留在旧语言。
export function HtmlLangSync({ locale }: { locale: string }) {
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  return null
}

// App Router 的部分客户端导航不回到页顶（复现：页脚法律链接跳转后落在新页中部，
// 章节标题被 sticky 导航遮挡），这里对每次路由变化统一兜底。
// behavior 用 'instant' 绕过 html 上的 scroll-behavior:smooth，避免每次跳转都放一遍回滚动画。
export function ScrollToTopOnNavigate() {
  const pathname = usePathname()
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])
  return null
}
