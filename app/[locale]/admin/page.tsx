import { AdminOverview } from '@/components/admin/overview'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'admin.dashboard' })

  return {
    title: t('meta_title'),
    description: t('meta_description'),
  }
}

export default async function AdminOverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'admin.dashboard' })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('menu.overview')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('menu.overview_desc')}</p>
      </div>
      <AdminOverview />
    </div>
  )
}
