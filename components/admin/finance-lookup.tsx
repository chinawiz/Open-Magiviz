"use client"

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Search, DollarSign, Coins, Loader2, Undo2, Scale } from 'lucide-react'
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
  refundAmount: number | null
  refundedAt: string | null
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

interface ReconData {
  gateway: {
    subscriptionRevenue: number
    pointsRevenue: number
    pointsSold: number
    refundedAmount: number
    refundedCount: number
    stuckPending: number
  }
  ledger: {
    pointsDelivered: number
  }
  diff: number
}

export function FinanceLookup() {
  const t = useTranslations('admin.finance')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<FinanceUser | null>(null)
  const [payments, setPayments] = useState<FinancePayment[]>([])
  const [history, setHistory] = useState<FinancePointsHistory[]>([])
  const [recon, setRecon] = useState<ReconData | null>(null)
  const [reconLoading, setReconLoading] = useState(true)

  // 退款调减对话框状态
  const [clawbackPayment, setClawbackPayment] = useState<FinancePayment | null>(null)
  const [clawbackPoints, setClawbackPoints] = useState('')
  const [clawbackNote, setClawbackNote] = useState('')
  const [clawbackConfirmOpen, setClawbackConfirmOpen] = useState(false)
  const [clawbackSubmitting, setClawbackSubmitting] = useState(false)

  const fetchRecon = async () => {
    setReconLoading(true)
    try {
      const response = await fetch('/api/admin/finance/recon')
      if (response.ok) {
        setRecon(await response.json())
      }
    } catch (error) {
      console.error('获取对账数据失败:', error)
    } finally {
      setReconLoading(false)
    }
  }

  useEffect(() => {
    fetchRecon()
  }, [])

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

  const openClawback = (payment: FinancePayment) => {
    setClawbackPayment(payment)
    // 预填该单售出积分的负数（可编辑——订阅退款无积分需手动改）
    setClawbackPoints(String(-(payment.pointsAmount || 0)))
    setClawbackNote('')
    setClawbackConfirmOpen(false)
  }

  const handleClawback = async () => {
    if (!clawbackPayment || !user || clawbackSubmitting) return
    const value = parseInt(clawbackPoints)
    if (!value || isNaN(value) || value >= 0) {
      toast.error(t('clawback.invalid_points'))
      return
    }
    setClawbackSubmitting(true)
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'adjustPoints',
          points: value,
          pointsType: 'purchased',
          description: clawbackNote.trim() || t('clawback.default_note', { intent: clawbackPayment.paymentIntentId || clawbackPayment.id }),
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`)
      }
      toast.success(t('clawback.success'))
      setClawbackPayment(null)
      // 刷新流水（积分变了）
      handleSearch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('clawback.failed'))
    } finally {
      setClawbackSubmitting(false)
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
      {/* 对账视图：网关侧 vs 台账侧勾稽 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" aria-hidden="true" />
              {t('recon.title')}
            </CardTitle>
            <CardDescription>{t('recon.description')}</CardDescription>
          </div>
          <Button onClick={fetchRecon} variant="outline" size="sm">
            {t('actions.refresh')}
          </Button>
        </CardHeader>
        <CardContent>
          {reconLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">{t('recon.sub_revenue')}</div>
                <div className="text-lg font-bold">{formatCents(recon?.gateway.subscriptionRevenue || 0, 'usd')}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t('recon.points_revenue')}</div>
                <div className="text-lg font-bold">{formatCents(recon?.gateway.pointsRevenue || 0, 'usd')}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t('recon.points_sold')}</div>
                <div className="text-lg font-bold">{recon?.gateway.pointsSold ?? '-'}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t('recon.points_delivered')}</div>
                <div className="text-lg font-bold">{recon?.ledger.pointsDelivered ?? '-'}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t('recon.diff')}</div>
                <div className={`text-lg font-bold ${(recon?.diff || 0) === 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {recon ? (recon.diff > 0 ? `+${recon.diff}` : recon.diff) : '-'}
                </div>
                <p className="text-xs text-muted-foreground">{t('recon.diff_hint')}</p>
              </div>
              <div>
                <div className="text-muted-foreground">{t('recon.refunded')}</div>
                <div className="text-lg font-bold">
                  {formatCents(recon?.gateway.refundedAmount || 0, 'usd')}
                  <span className="text-xs text-muted-foreground ml-1">×{recon?.gateway.refundedCount ?? 0}</span>
                </div>
                {(recon?.gateway.stuckPending || 0) > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {t('recon.stuck_pending', { count: recon!.gateway.stuckPending })}
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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
                      <TableHead className="min-w-[100px]">{t('payments.col_actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                          {t('payments.empty')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-xs">{p.paymentIntentId || p.id}</TableCell>
                          <TableCell className="text-sm">{p.paymentType}</TableCell>
                          <TableCell>
                            {statusBadge(p.paymentStatus)}
                            {p.refundAmount ? (
                              <div className="text-xs text-red-500 mt-1">
                                {t('payments.refund_amount', { amount: formatCents(p.refundAmount, p.currency) })}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-sm font-medium whitespace-nowrap">
                            {formatCents(p.amount, p.currency)}
                          </TableCell>
                          <TableCell className="text-sm">{p.pointsAmount ?? '-'}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            {new Date(p.createdAt).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            {p.paymentStatus === 'refunded' && (p.pointsAmount || 0) > 0 ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openClawback(p)}
                                title={t('clawback.open_title')}
                              >
                                <Undo2 className="h-4 w-4" />
                              </Button>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
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

      {/* 退款调减对话框（双确认） */}
      <Dialog open={!!clawbackPayment} onOpenChange={(open) => !open && setClawbackPayment(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('clawback.title')}</DialogTitle>
            <DialogDescription>
              {t('clawback.description', { intent: clawbackPayment?.paymentIntentId || clawbackPayment?.id || '' })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="clawbackPoints">{t('clawback.points_label')}</Label>
              <Input
                id="clawbackPoints"
                type="number"
                value={clawbackPoints}
                onChange={(e) => setClawbackPoints(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">{t('clawback.points_hint')}</p>
            </div>
            <div>
              <Label htmlFor="clawbackNote">{t('clawback.note_label')}</Label>
              <Textarea
                id="clawbackNote"
                placeholder={t('clawback.note_placeholder')}
                value={clawbackNote}
                onChange={(e) => setClawbackNote(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setClawbackPayment(null)}>
              {t('clawback.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => setClawbackConfirmOpen(true)}
              disabled={clawbackSubmitting}
            >
              {clawbackSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
              {t('clawback.submit')}
            </Button>
          </div>
        </DialogContent>

        <AlertDialog open={clawbackConfirmOpen} onOpenChange={setClawbackConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('clawback.confirm_title')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('clawback.confirm_description', { points: clawbackPoints, email: user?.email || '' })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('clawback.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault()
                  handleClawback()
                }}
                disabled={clawbackSubmitting}
              >
                {t('clawback.submit')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Dialog>
    </div>
  )
}
