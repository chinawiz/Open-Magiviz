"use client"

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import { RefreshCw, Search, ListChecks, Loader2, Wrench } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { format } from 'date-fns'

interface TaskRow {
  id: string
  taskId: string
  taskType: string
  model: string | null
  status: string
  pointsDeducted: boolean
  pointsAmount: number
  createdAt: string
  updatedAt: string | null
  userId: string
  userEmail: string
  userName: string | null
}

export function TasksMonitor() {
  const t = useTranslations('admin.tasks')
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [settleTarget, setSettleTarget] = useState<TaskRow | null>(null)
  const [settling, setSettling] = useState(false)

  const fetchTasks = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search.trim()) params.append('email', search.trim())
      if (statusFilter !== 'all') params.append('status', statusFilter)
      const response = await fetch(`/api/admin/tasks?${params}`)
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }
      const data = await response.json()
      setTasks(data.tasks)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('messages.fetch_failed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTasks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  const handleSettle = async () => {
    if (!settleTarget || settling) return
    setSettling(true)
    try {
      const response = await fetch('/api/admin/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: settleTarget.taskId }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`)
      }
      toast.success(t(`settle_result.${data.result}`))
      setSettleTarget(null)
      fetchTasks()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('messages.settle_failed'))
    } finally {
      setSettling(false)
    }
  }

  const statusBadge = (status: string) => {
    if (status === 'success') return <Badge>{t(`status_${status}`)}</Badge>
    if (status === 'failed') return <Badge variant="destructive">{t(`status_${status}`)}</Badge>
    return <Badge variant="secondary">{t(`status_${status}`)}</Badge>
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5" aria-hidden="true" />
              {t('list.title')}
            </CardTitle>
            <CardDescription>{t('list.description')}</CardDescription>
          </div>
          <Button onClick={fetchTasks} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('actions.refresh')}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('list.search_placeholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') fetchTasks()
                }}
                className="pl-8"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('list.all_statuses')}</SelectItem>
                <SelectItem value="pending">{t('status_pending')}</SelectItem>
                <SelectItem value="success">{t('status_success')}</SelectItem>
                <SelectItem value="failed">{t('status_failed')}</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={fetchTasks} variant="outline">
              {t('actions.search')}
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[220px]">{t('list.col_task')}</TableHead>
                    <TableHead className="min-w-[120px]">{t('list.col_type')}</TableHead>
                    <TableHead className="min-w-[100px]">{t('list.col_model')}</TableHead>
                    <TableHead className="min-w-[90px]">{t('list.col_status')}</TableHead>
                    <TableHead className="min-w-[110px]">{t('list.col_points')}</TableHead>
                    <TableHead className="min-w-[180px]">{t('list.col_user')}</TableHead>
                    <TableHead className="min-w-[130px]">{t('list.col_created')}</TableHead>
                    <TableHead className="min-w-[110px]">{t('list.col_actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        {t('list.empty')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    tasks.map((task) => (
                      <TableRow key={task.id}>
                        <TableCell className="font-mono text-xs">{task.taskId}</TableCell>
                        <TableCell className="text-sm">{task.taskType}</TableCell>
                        <TableCell className="text-sm">{task.model || '-'}</TableCell>
                        <TableCell>{statusBadge(task.status)}</TableCell>
                        <TableCell className="text-sm">
                          {task.pointsAmount}
                          <span className="text-xs text-muted-foreground ml-1">
                            {task.pointsDeducted ? t('list.deducted') : t('list.not_deducted')}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{task.userName || '-'}</div>
                          <div className="text-xs text-muted-foreground">{task.userEmail}</div>
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {format(new Date(task.createdAt), 'yyyy-MM-dd HH:mm')}
                        </TableCell>
                        <TableCell>
                          {task.status === 'pending' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSettleTarget(task)}
                              title={t('actions.settle')}
                            >
                              <Wrench className="h-4 w-4" />
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
          )}
        </CardContent>
      </Card>

      {/* 手动补偿双确认 */}
      <AlertDialog open={!!settleTarget} onOpenChange={(open) => !open && setSettleTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settle_confirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settle_confirm.description', { taskId: settleTarget?.taskId || '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('settle_confirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleSettle} disabled={settling}>
              {settling && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
              {t('settle_confirm.proceed')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
