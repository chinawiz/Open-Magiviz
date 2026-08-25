import type { PollResult } from './types'

/**
 * FAL 任务查询适配器（当前仅 compose 用到）。
 * 未配置 FAL 密钥时返回 unknown，由调用方决定留待下次或人工处理。
 */
export async function pollFalTask(taskId: string, timeoutMs = 15000): Promise<PollResult> {
  const falKey = process.env.FAL_KEY || process.env.FAL_API_KEY
  if (!falKey) return { verdict: 'unknown', resultUrls: [] }

  const res = await fetch(
    `https://queue.fal.run/fal-ai/ffmpeg-api/compose/requests/${encodeURIComponent(taskId)}/status`,
    { headers: { Authorization: `Key ${falKey}` }, signal: AbortSignal.timeout(timeoutMs) },
  )
  if (!res.ok) throw new Error(`FAL status → HTTP ${res.status}`)
  const data = (await res.json()) as { status?: string }
  if (data.status === 'COMPLETED') return { verdict: 'success', resultUrls: [] }
  if (data.status === 'FAILED') return { verdict: 'fail', resultUrls: [] }
  return { verdict: 'processing', resultUrls: [] }
}
