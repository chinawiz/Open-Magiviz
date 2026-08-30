"use client"

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Search, DollarSign, Coins, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

interface FinanceUser {
  id: string
  name: string | null
  email: string
  points: number | null
  purchasedPoints: number | null
  giftedPoints: number | null
  subscriptionStatus: string | null
  subscriptionPlan: string | null
  subscriptionCurrentPeriodEnd: string | null
  cardVerifiedAt: string | null
  bannedAt: string | null
  bannedReason: string | null
  createdAt: string
}

interface FinancePayment {
  id: string
  paymentIntentId: string | null
  paymentStatus: string
  paymentType: string
  amount: number
  currency: string
  pointsAmount: number | null
  productName: string | null
  createdAt: string
}

interface FinancePointsHistory {
  id: string
  points: number
  pointsType: string
  action: string
  description: string | null
  createdAt: string
}

export function FinanceLookup() {
  const t = useTranslations('admin.finance')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<FinanceUser | null>(null)
  const [payments, setPayments] = useState<FinancePayment[]>([])
  const [history, setHistory] = useState<FinancePointsHistory[]>([])

  const handleSearch = async () => {
    if (!email.trim() || loading) return
    setLoading(true)
    setUser(null)
    try {
      const response = await fetch(`/api/admin/finance?email=${encodeURIComponent(email.trim())}`)
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`)
      }
      setUser(data.user)
      setPayments(data.payments)
      setHistory(data.pointsHistory)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('messages.fetch_failed'))
    } finally {
      setLoading(false)
    }
  }

  const formatCents = (cents: number, currency: string) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
  }

  const statusBadge = (status: string) => {
    if (status === 'succeeded') return <Badge>{t(`status_${status}`)}</Badge>
    if (status === 'failed' || status === 'refunded') return <Badge variant="destructive">{t(`status_${status}`)}</Badge>
    return <Badge variant="secondary">{t(`status_${status}`)}</Badge>
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" aria-hidden="true" />
            {t('lookup.title')}
          </CardTitle>
          <CardDescription>{t('lookup.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('lookup.search_placeholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch()
                }}
                className="pl-8"
                type="email"
              />
            </div>
            <Button onClick={handleSearch} disabled={loading || !email.trim()}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
              {t('lookup.search_button')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {user && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('summary.title')}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">{t('summary.email')}</div>
                <div className="font-medium break-all">{user.email}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t('summary.points')}</div>
                <div className="font-medium">
                  {user.points} <span className="text-xs text-muted-foreground">({t('summary.purchased')}: {user.purchasedPoints} / {t('summary.gifted')}: {user.giftedPoints})</span>
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">{t('summary.subscription')}</div>
                <div className="font-medium">
                  {user.subscriptionStatus
                    ? `${user.subscriptionPlan || ''} · ${user.subscriptionStatus}`
                    : t('summary.no_subscription')}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">{t('summary.card_verified')}</div>
                <div className="font-medium">
                  {user.cardVerifiedAt ? t('summary.yes') : t('summary.no')}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign className="h-4 w-4" aria-hidden="true" />
                {t('payments.title')}
              </CardTitle>
              <CardDescription>{t('payments.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[180px]">{t('payments.col_intent')}</TableHead>
                      <TableHead className="min-w-[110px]">{t('payments.col_type')}</TableHead>
                      <TableHead className="min-w-[100px]">{t('payments.col_status')}</TableHead>
                      <TableHead className="min-w-[100px]">{t('payments.col_amount')}</TableHead>
                      <TableHead className="min-w-[90px]">{t('payments.col_points')}</TableHead>
                      <TableHead className="min-w-[130px]">{t('payments.col_created')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                          {t('payments.empty')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-xs">{p.paymentIntentId || p.id}</TableCell>
                          <TableCell className="text-sm">{p.paymentType}</TableCell>
                          <TableCell>{statusBadge(p.paymentStatus)}</TableCell>
                          <TableCell className="text-sm font-medium whitespace-nowrap">
                            {formatCents(p.amount, p.currency)}
                          </TableCell>
                          <TableCell className="text-sm">{p.pointsAmount ?? '-'}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            {new Date(p.createdAt).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Coins className="h-4 w-4" aria-hidden="true" />
                {t('history.title')}
              </CardTitle>
              <CardDescription>{t('history.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[80px]">{t('history.col_change')}</TableHead>
                      <TableHead className="min-w-[90px]">{t('history.col_type')}</TableHead>
                      <TableHead className="min-w-[130px]">{t('history.col_action')}</TableHead>
                      <TableHead className="min-w-[220px]">{t('history.col_description')}</TableHead>
                      <TableHead className="min-w-[130px]">{t('history.col_created')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                          {t('history.empty')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      history.map((h) => (
                        <TableRow key={h.id}>
                          <TableCell className={`text-sm font-medium ${h.points >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {h.points >= 0 ? `+${h.points}` : h.points}
                          </TableCell>
                          <TableCell className="text-sm">{h.pointsType}</TableCell>
                          <TableCell className="text-sm">{h.action}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{h.description || '-'}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            {new Date(h.createdAt).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
