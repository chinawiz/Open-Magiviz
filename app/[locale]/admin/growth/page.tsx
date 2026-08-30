import { ReferralManagement } from '@/components/admin/referral-management'
import { AffiliateManagement } from '@/components/admin/affiliate-management'
import { getTranslations } from 'next-intl/server'

export default async function AdminGrowthPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'admin.dashboard' })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t('menu.growth')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('menu.growth_desc')}</p>
      </div>
      <section>
        <h2 className="text-lg font-semibold mb-3">{t('menu.referral')}</h2>
        <ReferralManagement />
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-3">{t('menu.affiliate')}</h2>
        <AffiliateManagement />
      </section>
    </div>
  )
}
