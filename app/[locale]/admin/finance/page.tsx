import { FinanceLookup } from '@/components/admin/finance-lookup'
import { getTranslations } from 'next-intl/server'

export default async function AdminFinancePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'admin.dashboard' })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('menu.finance')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('menu.finance_desc')}</p>
      </div>
      <FinanceLookup />
    </div>
  )
}
