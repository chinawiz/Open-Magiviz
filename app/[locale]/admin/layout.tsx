import { requireAdmin } from '@/lib/auth-utils'
import { AdminSidebar } from '@/components/admin/admin-sidebar'
import { Navbar } from '@/components/navbar'
import { Footer } from '@/components/footer'

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  // 页面守卫收敛到 layout：一次拦截覆盖全部 admin 子路由
  await requireAdmin(locale)

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col lg:flex-row gap-6">
          <AdminSidebar />
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </div>
      <Footer />
    </div>
  )
}
