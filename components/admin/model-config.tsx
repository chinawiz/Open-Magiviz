"use client"

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
import { Loader2, Cpu, Pencil, Trash2, PlugZap, RefreshCw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

// 自建端点管理（ADR-0001）：登记/编辑/启停/删除 + 测试连接 + 回退统计。
// key 只以掩码出现（API 契约守卫），编辑留空 = 保留原 key。

const CAPABILITIES = ['script', 'storyboard_text', 'image'] as const

interface PublicEndpoint {
  id: string
  capability: string
  protocol: string
  baseUrl: string
  modelId: string
  timeoutMs: number
  enabled: boolean
  lastTestAt: string | null
  lastTestOk: boolean | null
  note: string | null
  apiKeyMasked: string
}

interface FallbackStat {
  stage: string
  capability: string
  count: number
  lastAt: string | null
}

interface FormState {
  id: string | null
  capability: string
  protocol: string
  baseUrl: string
  modelId: string
  apiKey: string
  timeoutMs: string
  note: string
}

const EMPTY_FORM: FormState = {
  id: null,
  capability: 'script',
  protocol: 'openai-chat',
  baseUrl: '',
  modelId: '',
  apiKey: '',
  timeoutMs: '60000',
  note: '',
}

async function requestModels(): Promise<{ endpoints: PublicEndpoint[]; fallbackStats: FallbackStat[] }> {
  const res = await fetch('/api/admin/models')
  if (!res.ok) throw new Error(String(res.status))
  return res.json()
}

export function ModelConfig() {
  const t = useTranslations('admin.models')
  const [endpoints, setEndpoints] = useState<PublicEndpoint[]>([])
  const [stats, setStats] = useState<FallbackStat[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ key: string; ok: boolean; latencyMs?: number } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PublicEndpoint | null>(null)

  // 首次加载走 .then 异步边界（react-hooks/set-state-in-effect 合规）
  useEffect(() => {
    let active = true
    requestModels()
      .then(data => {
        if (!active) return
        setEndpoints(data.endpoints)
        setStats(data.fallbackStats)
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        toast.error(t('messages.load_failed'))
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [t])

  // 变更后的刷新（事件路径调用）
  const load = useCallback(async () => {
    try {
      const data = await requestModels()
      setEndpoints(data.endpoints)
      setStats(data.fallbackStats)
    } catch {
      toast.error(t('messages.load_failed'))
    }
  }, [t])

  const startCreate = () => setForm({ ...EMPTY_FORM })
  const startEdit = (e: PublicEndpoint) =>
    setForm({ id: e.id, capability: e.capability, protocol: e.protocol, baseUrl: e.baseUrl, modelId: e.modelId, apiKey: '', timeoutMs: String(e.timeoutMs), note: e.note ?? '' })

  const save = async () => {
    if (!form) return
    setSaving(true)
    try {
      const payload = {
        id: form.id,
        capability: form.capability,
        protocol: form.protocol,
        baseUrl: form.baseUrl.trim(),
        modelId: form.modelId.trim(),
        apiKey: form.apiKey.trim(),
        timeoutMs: Number(form.timeoutMs) || 60000,
        enabled: true,
        note: form.note,
      }
      const res = await fetch('/api/admin/models', {
        method: form.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(t(form.id ? 'messages.updated' : 'messages.saved'))
      setForm(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t('messages.save_failed'))
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (e: PublicEndpoint) => {
    try {
      const res = await fetch('/api/admin/models', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: e.id, enabled: !e.enabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(t('messages.switched'))
      await load()
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t('messages.switch_failed'))
    }
  }

  const remove = async () => {
    if (!deleteTarget) return
    try {
      const res = await fetch(`/api/admin/models?id=${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error)
      }
      toast.success(t('messages.deleted'))
      setDeleteTarget(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t('messages.delete_failed'))
    }
  }

  const testConnection = async (target: { id: string | null; baseUrl: string; modelId: string; apiKey: string; timeoutMs: string }) => {
    const key = target.id ?? 'form'
    setTestingId(key)
    setTestResult(null)
    try {
      const body = target.id
        ? { id: target.id }
        : { baseUrl: target.baseUrl, modelId: target.modelId, apiKey: target.apiKey, timeoutMs: Number(target.timeoutMs) || 10000 }
      const res = await fetch('/api/admin/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setTestResult({ key, ok: data.ok, latencyMs: data.latencyMs })
      if (!data.ok) toast.error(data.error ?? t('test_fail'))
    } catch (err) {
      setTestResult({ key, ok: false })
      toast.error(err instanceof Error ? err.message : t('test_fail'))
    } finally {
      setTestingId(null)
    }
  }

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
  }

  return (
    <div className="space-y-6">
      {CAPABILITIES.map(cap => {
        const list = endpoints.filter(e => e.capability === cap)
        const active = list.find(e => e.enabled)
        return (
          <Card key={cap}>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Cpu className="h-4 w-4" aria-hidden="true" />
                    {t(`capability.${cap}`)}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {t('active_model')}:{' '}
                    {active ? (
                      <span className="font-medium text-foreground">{t('self_hosted')} · {active.modelId}</span>
                    ) : (
                      <span className="font-medium text-foreground">{t('cloud_default')}</span>
                    )}
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={startCreate}>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  {t('add')}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {list.length === 0 && <p className="text-sm text-muted-foreground">{t('cloud_default')}</p>}
              {list.map(e => (
                <div key={e.id} className="flex items-center justify-between flex-wrap gap-2 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={e.enabled ? 'default' : 'secondary'}>{e.enabled ? t('enabled') : t('disabled')}</Badge>
                      <code className="text-sm truncate">{e.baseUrl}</code>
                      <code className="text-sm text-muted-foreground">· {e.modelId}</code>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('api_key')}: {e.apiKeyMasked} · {t('last_test')}:{' '}
                      {e.lastTestAt ? (
                        <>
                          {new Date(e.lastTestAt).toLocaleString()} · <span className={e.lastTestOk ? 'text-green-600' : 'text-destructive'}>{e.lastTestOk ? t('test_pass') : t('test_fail')}</span>
                        </>
                      ) : (
                        t('never')
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" disabled={testingId === e.id} onClick={() => testConnection({ id: e.id, baseUrl: '', modelId: '', apiKey: '', timeoutMs: '' })}>
                      {testingId === e.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PlugZap className="h-4 w-4" aria-hidden="true" />}
                      {testingId === e.id ? t('testing') : t('test_connection')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => toggle(e)}>{e.enabled ? t('disable') : t('enable')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => startEdit(e)}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(e)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )
      })}

      {form && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{form.id ? t('edit') : t('add')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t('step')}</Label>
                <Select value={form.capability} onValueChange={v => setForm({ ...form, capability: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CAPABILITIES.map(cap => <SelectItem key={cap} value={cap}>{t(`capability.${cap}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>协议 / Protocol</Label>
                <Select value={form.protocol} onValueChange={v => setForm({ ...form, protocol: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai-chat">{t('protocol.openai-chat')}</SelectItem>
                    <SelectItem value="openai-images">{t('protocol.openai-images')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ep-baseurl">{t('base_url')}</Label>
                <Input id="ep-baseurl" value={form.baseUrl} placeholder={t('base_url_placeholder')} onChange={e => setForm({ ...form, baseUrl: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-modelid">{t('model_id')}</Label>
                <Input id="ep-modelid" value={form.modelId} placeholder={t('model_id_placeholder')} onChange={e => setForm({ ...form, modelId: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-apikey">{t('api_key')}</Label>
                <Input id="ep-apikey" type="password" value={form.apiKey} placeholder={form.id ? t('api_key_hint') : ''} onChange={e => setForm({ ...form, apiKey: e.target.value })} />
                {form.id && <p className="text-xs text-muted-foreground">{t('api_key_hint')}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-timeout">{t('timeout')}</Label>
                <Input id="ep-timeout" type="number" value={form.timeoutMs} onChange={e => setForm({ ...form, timeoutMs: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-note">{t('note')}</Label>
                <Input id="ep-note" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {t('save')}
              </Button>
              <Button variant="outline" disabled={saving} onClick={() => testConnection({ id: null, baseUrl: form.baseUrl, modelId: form.modelId, apiKey: form.apiKey, timeoutMs: form.timeoutMs })}>
                {testingId === 'form' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PlugZap className="h-4 w-4" aria-hidden="true" />}
                {testingId === 'form' ? t('testing') : t('test_connection')}
              </Button>
              <Button variant="ghost" disabled={saving} onClick={() => { setForm(null); setTestResult(null) }}>{t('cancel')}</Button>
              {testResult?.key === 'form' && (
                <span className={testResult.ok ? 'text-sm text-green-600' : 'text-sm text-destructive'}>
                  {testResult.ok ? t('test_ok', { latency: testResult.latencyMs ?? 0 }) : t('test_fail')}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('fallback_title')}</CardTitle>
          <CardDescription>{t('fallback_desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('fallback_none')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('fallback_stage')}</TableHead>
                  <TableHead>{t('fallback_count')}</TableHead>
                  <TableHead>{t('fallback_last')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.map(s => (
                  <TableRow key={s.stage}>
                    <TableCell>{s.capability}</TableCell>
                    <TableCell>{s.count}</TableCell>
                    <TableCell>{s.lastAt ? new Date(s.lastAt).toLocaleString() : '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirm_delete_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('confirm_delete_description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>{t('delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
