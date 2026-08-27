import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { PricingPageContent } from '@/components/pricing/pricing-page-content'

const locales = ['en', 'zh']

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params

  if (!locales.includes(locale)) {
    notFound()
  }

  const t = await getTranslations({ locale, namespace: 'metadata.pricing' })
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''
  const currentUrl = baseUrl ? `${baseUrl}/${locale}/pricing` : ''

  return {
    title: t('title'),
    description: t('description'),
    keywords: locale === 'zh'
      ? '价格,付费,订阅,会员,AI视频创作,视频生成,套餐'
      : 'pricing,subscription,membership,AI video creation,video generation,plan',
    alternates: baseUrl ? {
      canonical: currentUrl,
      languages: {
        'zh': `${baseUrl}/zh/pricing`,
        'en': `${baseUrl}/en/pricing`,
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
      images: baseUrl ? [`${baseUrl}/images/home-og.png`] : [],
    },
    robots: {
      index: true,
      follow: true,
    },
  }
}

export default function PricingPage() {
  return <PricingPageContent />
}
