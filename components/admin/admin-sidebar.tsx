"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { BarChart3, UserCog, ListChecks, DollarSign, TrendingUp, MailOpen } from 'lucide-react'
import { cn } from '@/lib/utils'

const ITEMS = [
  { href: '/admin', labelKey: 'menu.overview', icon: BarChart3 },
  { href: '/admin/users', labelKey: 'menu.users', icon: UserCog },
  { href: '/admin/tasks', labelKey: 'menu.tasks', icon: ListChecks },
  { href: '/admin/finance', labelKey: 'menu.finance', icon: DollarSign },
  { href: '/admin/growth', labelKey: 'menu.growth', icon: TrendingUp },
  { href: '/admin/newsletter', labelKey: 'menu.newsletter', icon: MailOpen },
] as const

export function AdminSidebar() {
  const t = useTranslations('admin.dashboard')
  const pathname = usePathname()

  return (
    <nav aria-label="Admin" className="lg:w-52 lg:shrink-0">
      <ul className="flex lg:flex-col gap-1 overflow-x-auto pb-2 lg:pb-0 lg:sticky lg:top-20">
        {ITEMS.map(({ href, labelKey, icon: Icon }) => {
          const active = pathname === href
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {t(labelKey)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
