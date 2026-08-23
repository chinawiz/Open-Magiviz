"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Sparkles, Menu, X, Layers } from "lucide-react"
import { useSession, signOut } from "next-auth/react"
import type { Session } from "next-auth"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { PricingDialog } from "@/components/pricing-dialog"

export type SidebarTab = 'create' | 'projects' | 'library'

interface SidebarProps {
  activeTab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
}

// 用户信息卡片组件
function UserProfileCard({ session }: { session: Session }) {
  const t = useTranslations("sidebar")
  const userName = session?.user?.name || t('user')
  const userEmail = session?.user?.email || ''
  const subscriptionPlan = session?.user?.subscriptionPlan

  // 只有 Annual 订阅不显示升级卡片
  const isAnnualSubscriber = subscriptionPlan === 'annual'

  return (
    <div className="flex flex-col gap-3">
      {/* 升级卡片 - 简洁无背景 */}
      {!isAnnualSubscriber && (
        <div className="relative overflow-hidden rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="relative flex flex-col gap-2">
            {/* 顶部：图标 + 标题 */}
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <p className="text-sm font-medium text-primary">{t('upgradePro')}</p>
            </div>

            {/* 描述文案 */}
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t('upgradeDescription')}
            </p>

            {/* 升级按钮 */}
            <PricingDialog>
              <button className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                {t('upgradeNow')}
              </button>
            </PricingDialog>
          </div>
        </div>
      )}

      {/* 用户信息 */}
      <div className="flex items-center gap-3 px-1">
        {/* 头像 */}
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center overflow-hidden">
          <svg className="w-8 h-8 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="8" r="4" strokeWidth={1.5} />
            <path strokeWidth={1.5} d="M4 20c0-4 4-6 8-6s8 2 8 6" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{userName}</p>
          <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
        </div>
      </div>

      {/* 底部按钮 */}
      <div className="flex gap-2">
        <button
          onClick={() => window.open('/profile', '_blank')}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-muted-foreground text-xs font-medium hover:bg-muted transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          {t('profile')}
        </button>
        <button
          onClick={() => signOut()}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-muted-foreground text-xs font-medium hover:bg-muted transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          {t('signOut')}
        </button>
      </div>
    </div>
  )
}

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const { data: session, status } = useSession()
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations("sidebar")

  const routes: Record<SidebarTab, string> = {
    create: `/${locale}/create`,
    projects: `/${locale}/projects`,
    library: `/${locale}/library`,
  }

  const handleTabClick = (tab: SidebarTab) => {
    onTabChange(tab)
    router.replace(routes[tab], { scroll: false })
  }

  return (
    <>
      {/* 桌面端左侧导航栏 */}
      <div className="hidden md:flex flex-col w-64 bg-background/50 backdrop-blur-sm">
        <div className="p-6">
          <nav className="space-y-2">
            <button
              onClick={() => handleTabClick('create')}
              className={cn(
                "w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg transition-all",
                activeTab === 'create'
                  ? "bg-primary text-primary-foreground shadow-lg"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              <Sparkles className="w-5 h-5" />
              <span className="font-medium">{t('exploreVideo')}</span>
            </button>

            {/* 素材库 */}
            <button
              onClick={() => handleTabClick('library')}
              className={cn(
                "w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg transition-all",
                activeTab === 'library'
                  ? "bg-primary text-primary-foreground shadow-lg"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              <Layers className="w-5 h-5" />
              <span className="font-medium">{t('myLibrary')}</span>
            </button>

            {/* 我的项目 */}
            <button
              onClick={() => handleTabClick('projects')}
              className={cn(
                "w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg transition-all",
                activeTab === 'projects'
                  ? "bg-primary text-primary-foreground shadow-lg"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span className="font-medium">{t('myProjects')}</span>
            </button>
          </nav>
        </div>

        {/* 底部用户信息 - 仅登录后显示 */}
        {status === 'authenticated' && (
          <div className="mt-auto p-6">
            <UserProfileCard session={session} />
          </div>
        )}
      </div>

      {/* 移动端：屏幕中间的打开按钮，默认隐藏侧边栏 */}
      <div className="md:hidden">
        {/* Floating open button (center vertically on the left) */}
        <button
          aria-label={t('openSidebar')}
          onClick={() => setIsOpen(true)}
          className="fixed left-0 top-1/2 -translate-y-1/2 z-10 p-2 rounded-r-full bg-primary text-primary-foreground shadow-lg"
        >
          <Menu className="w-4 h-4" />
        </button>

        {/* Slide-over sidebar */}
        {isOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40 bg-black/40"
              onClick={() => setIsOpen(false)}
              aria-hidden
            />

            {/* Drawer */}
            <aside className="fixed left-0 top-0 z-50 h-full w-64 bg-background/95 backdrop-blur-sm p-6 flex flex-col">
              <div className="flex items-start justify-between">
                <div />
                <button
                  aria-label={t('closeSidebar')}
                  onClick={() => setIsOpen(false)}
                  className="p-2 rounded-md text-muted-foreground hover:text-foreground"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <nav className="mt-6 space-y-2 flex-1 overflow-y-auto">
                <button
                  onClick={() => {
                    handleTabClick('create')
                    setIsOpen(false)
                  }}
                  className={cn(
                    "w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg transition-all",
                    activeTab === 'create'
                      ? "bg-primary text-primary-foreground shadow-lg"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Sparkles className="w-5 h-5" />
                  <span className="font-medium">{t('exploreVideo')}</span>
                </button>

                {/* 素材库 */}
                <button
                  onClick={() => {
                    handleTabClick('library')
                    setIsOpen(false)
                  }}
                  className={cn(
                    "w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg transition-all",
                    activeTab === 'library'
                      ? "bg-primary text-primary-foreground shadow-lg"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Layers className="w-5 h-5" />
                  <span className="font-medium">{t('myLibrary')}</span>
                </button>

                {/* 我的项目 */}
                <button
                  onClick={() => {
                    handleTabClick('projects')
                    setIsOpen(false)
                  }}
                  className={cn(
                    "w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg transition-all",
                    activeTab === 'projects'
                      ? "bg-primary text-primary-foreground shadow-lg"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  <span className="font-medium">{t('myProjects')}</span>
                </button>
              </nav>

              {/* 底部用户信息 - 仅登录后显示 */}
              {status === 'authenticated' && (
                <div className="mt-auto pt-6">
                  <UserProfileCard session={session} />
                </div>
              )}
            </aside>
          </>
        )}
      </div>
    </>
  )
}
