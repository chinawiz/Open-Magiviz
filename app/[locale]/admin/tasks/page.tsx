import { TasksMonitor } from '@/components/admin/tasks-monitor'
import { getTranslations } from 'next-intl/server'

export default async function AdminTasksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'admin.dashboard' })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('menu.tasks')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('menu.tasks_desc')}</p>
      </div>
      <TasksMonitor />
    </div>
  )
}
