import { ModelConfig } from '@/components/admin/model-config'
import { getTranslations } from 'next-intl/server'

export default async function AdminModelsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'admin.dashboard' })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('menu.models')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('menu.models_desc')}</p>
      </div>
      <ModelConfig />
    </div>
  )
}
