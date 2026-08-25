import type { PollResult } from './types'

/**
 * Kie.ai 任务查询适配器：把三种端点响应形状归一为 PollResult。
 * 端点与解析逻辑与各生成路由的轮询实现一一对应：
 * - jobsRecordInfo（图片）：{code, data:{state:'success'|'fail', resultJson:'{"resultUrls":[...]}', failMsg}}
 * - veoRecordInfo（Veo 系视频）：{code, data:{successFlag:1|-1|0, response:{resultUrls:[]}, failMsg}}
 * - jobsGet（Seedance/Kling/Wan/HappyHorse/GeminiOmni/MiniMax 视频）：
 *   {code, data:{taskStatus|task_status:'SUCCESS'|'FAILED'|..., result:{resultUrls:[]}}}
 */

export type KieQueryKind = 'jobsRecordInfo' | 'veoRecordInfo' | 'jobsGet'

const KIE_BASE = 'https://api.kie.ai/api/v1'

const ENDPOINTS: Record<KieQueryKind, string> = {
  jobsRecordInfo: `${KIE_BASE}/jobs/recordInfo`,
  veoRecordInfo: `${KIE_BASE}/veo/record-info`,
  jobsGet: `${KIE_BASE}/jobs/get`,
}

function asVerdictFromState(state: unknown): PollResult['verdict'] {
  if (state === 'success' || state === 'SUCCESS') return 'success'
  if (state === 'fail' || state === 'FAIL' || state === 'failed' || state === 'FAILED') return 'fail'
  return 'processing'
}

export async function pollKieTask(
  queryKind: KieQueryKind,
  taskId: string,
  timeoutMs = 15000,
): Promise<PollResult> {
  const res = await fetch(`${ENDPOINTS[queryKind]}?taskId=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`Kie ${queryKind} → HTTP ${res.status}`)
  const data = (await res.json()) as any

  if (data?.code !== 200 || !data?.data) {
    return { verdict: 'unknown', resultUrls: [] }
  }
  const d = data.data

  if (queryKind === 'veoRecordInfo') {
    if (d.successFlag === 1) {
      return { verdict: 'success', resultUrls: d.response?.resultUrls || [] }
    }
    if (d.successFlag === -1) return { verdict: 'fail', resultUrls: [] }
    return { verdict: 'processing', resultUrls: [] }
  }

  if (queryKind === 'jobsRecordInfo') {
    const verdict = asVerdictFromState(d.state)
    if (verdict === 'success' && d.resultJson) {
      try {
        const parsed = JSON.parse(d.resultJson)
        return { verdict, resultUrls: parsed?.resultUrls || [] }
      } catch {
        return { verdict: 'success', resultUrls: [] }
      }
    }
    return { verdict, resultUrls: [] }
  }

  // jobsGet
  const verdict = asVerdictFromState(d.taskStatus || d.task_status)
  return { verdict, resultUrls: verdict === 'success' ? (d.result?.resultUrls || []) : [] }
}
