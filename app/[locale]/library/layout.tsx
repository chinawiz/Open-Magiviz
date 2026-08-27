import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'library_page' })

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''
  const currentUrl = baseUrl ? `${baseUrl}/${locale}/library` : ''
  const title = t('title')
  const description = t('description')

  return {
    title,
    description,
    keywords: locale === 'zh'
      ? '素材库,AI素材,创作历史,角色库,分镜库,视频库,MeiHao'
      : 'library,AI library,creation history,characters,storyboards,videos,MeiHao',
    metadataBase: baseUrl ? new URL(baseUrl) : null,
    alternates: baseUrl
      ? {
          canonical: currentUrl,
          languages: {
            zh: `${baseUrl}/zh/library`,
            en: `${baseUrl}/en/library`,
          },
        }
      : undefined,
    openGraph: {
      type: 'website',
      locale: locale === 'zh' ? 'zh_CN' : 'en_US',
      url: currentUrl,
      title,
      description,
      siteName: 'MeiHao',
      images: baseUrl !== '' ? [{ url: `${baseUrl}/images/home-og.png`, width: 1200, height: 630, alt: title }] : [],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      creator: '@zyailive',
      images: baseUrl ? [`${baseUrl}/images/home-og.png`] : [],
    },
  }
}

export default function LibraryLayout({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
