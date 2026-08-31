import type React from "react"
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Script from 'next/script'
import { Manrope } from 'next/font/google'
import { Toaster as SonnerToaster } from 'sonner'
import { Toaster } from "@/components/ui/toaster"
import { AnalyticsProvider, PostHogPageView } from "@/components/analytics"

// 全站首个真正落地的标题字体：此前 font-headline 在 tailwind 中未定义，一直是 no-op（UI 审计 P2）
const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-headline',
  display: 'swap',
})

const locales = ['en', 'zh']

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params

  // 验证locale是否有效
  if (!locales.includes(locale)) {
    notFound()
  }

  const t = await getTranslations({ locale, namespace: 'metadata' })

  // 获取基础URL，如果未设置环境变量则为空
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''
  const currentUrl = baseUrl ? `${baseUrl}/${locale}` : ''

  return {
    title: {
      default: t('title'),
      template: `%s | ${t('title')}`
    },
    description: t('description'),
    keywords: locale === 'zh'
      ? 'AI视频创作,视频生成,影视制作,动漫制作,广告视频,科普视频,故事剧情,智能创作,创意成片,视频编辑,AI工具,影视创作平台,在线视频制作,自动化视频'
      : 'AI Video Creation,Video Generation,Film Production,Anime Production,Advertising Video,Educational Video,Story Plot,Intelligent Creation,Creative Film,Video Editing,AI Tools,Film Creation Platform,Online Video Production,Automated Video',
    authors: [{ name: 'MeiHao Team' }],
    creator: 'MeiHao',
    publisher: 'MeiHao',
    formatDetection: {
      email: false,
      address: false,
      telephone: false,
    },
    manifest: '/manifest.json',
    icons: {
      icon: '/favicon.ico',
      shortcut: '/favicon.ico',
      apple: '/favicon.ico',
    },
    metadataBase: baseUrl ? new URL(baseUrl) : null,
    alternates: baseUrl ? {
      canonical: currentUrl,
      languages: {
        'zh': `${baseUrl}/zh`,
        'en': `${baseUrl}/en`,
      },
    } : undefined,
    openGraph: {
      type: 'website',
      locale: locale === 'zh' ? 'zh_CN' : 'en_US',
      url: currentUrl,
      title: t('title'),
      description: t('description'),
      siteName: 'MeiHao',
      images: baseUrl ? [
        {
          url: `${baseUrl}/images/home-og.png`,
          width: 1200,
          height: 630,
          alt: t('title'),
        },
      ] : [],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
      creator: '@zyailive',
      images: baseUrl ? [`${baseUrl}/images/home-og.png`] : [],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
    verification: {
      google: process.env.GOOGLE_SITE_VERIFICATION,
      yandex: process.env.YANDEX_VERIFICATION,
      yahoo: process.env.YAHOO_VERIFICATION,
    },
    category: 'technology',
    classification: 'AI Video Creation, Video Production, Film Making, Creative Tools',
    other: {
      'theme-color': '#E6A37A',
      'apple-mobile-web-app-capable': 'yes',
      'apple-mobile-web-app-status-bar-style': 'black-translucent',
      'apple-mobile-web-app-title': 'MeiHao',
    },
  }
}

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  // 在Next.js 16中，params需要被await
  const { locale } = await params
  
  // 验证locale是否有效
  if (!locales.includes(locale)) {
    notFound()
  }

  // 使用getMessages从i18n配置获取翻译，传递locale参数
  const messages = await getMessages({ locale })

  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      <AnalyticsProvider>
        <div data-locale={locale} className={manrope.variable}>
          {children}
        </div>
        <PostHogPageView />
      </AnalyticsProvider>
      {/* 全站此前从未挂载 Toaster：sonner 与 use-toast 两套 toast 调用一直静默无效（见经验库 infra#18） */}
      <SonnerToaster position="top-center" theme="system" />
      <Toaster />
      {/* MS Clarity 会话回放：无流量上限免费；NEXT_PUBLIC_CLARITY_ID 未配置时整段不输出 */}
      {process.env.NEXT_PUBLIC_CLARITY_ID && (
        <Script
          id="ms-clarity"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${process.env.NEXT_PUBLIC_CLARITY_ID}");`,
          }}
        />
      )}
    </NextIntlClientProvider>
  )
}
