import { UserStats } from '@/components/admin/user-stats'
import { getTranslations } from 'next-intl/server'

export default async function AdminUsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'admin.dashboard' })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('menu.users')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('menu.users_desc')}</p>
      </div>
      <UserStats />
    </div>
  )
}
