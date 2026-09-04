import { resolveActiveRoutes } from './router'
import { pickLocalEntry, toEndpointConfig, normalizeLocalError } from './chat-active'
import { localImagesGenerate } from './local'
import { uploadImageBufferToR2 } from '@/lib/r2-upload'
import { v4 as uuidv4 } from 'uuid'

/**
 * 自建图像尝试（ADR-0001）。三态：
 * - inactive：未启用自建，或调用方声明 skip（带参考图/角色图的 img2img 一期保留云端，
 *   自建契约仅覆盖文生图）→ 调用方走云端，不算回退；
 * - ok：自建成功，结果已转存 R2 公网直链（下游图生视频要求公网可达）；
 * - failed：自建失败（含转存失败）→ 调用方走云端并记 fallbackApplied。
 */

export type LocalImageAttempt =
  | { status: 'inactive' }
  | { status: 'ok'; images: Array<{ url: string }>; model: string }
  | { status: 'failed'; localError: string }

export async function attemptLocalImages(
  prompt: string,
  opts?: { skip?: boolean },
): Promise<LocalImageAttempt> {
  if (opts?.skip) return { status: 'inactive' }

  const routes = await resolveActiveRoutes('image')
  const localEntry = pickLocalEntry(routes)
  if (!localEntry) return { status: 'inactive' }

  const config = toEndpointConfig(localEntry)
  try {
    const generated = await localImagesGenerate(config, { prompt })
    const images = await Promise.all(generated.map(relayToR2))
    return { status: 'ok', images, model: config.modelId }
  } catch (err) {
    const localError = normalizeLocalError(err)
    console.error('[image-active] 自建图像端点失败，回退云端:', localError)
    return { status: 'failed', localError }
  }
}

/** b64 或（可能局域网的）URL → 字节 → R2 公网直链。转存是自建链路的一部分，失败即回退。 */
async function relayToR2(result: { b64?: string; url?: string }): Promise<{ url: string }> {
  const bytes = result.b64
    ? Buffer.from(result.b64, 'base64')
    : Buffer.from(await (await fetch(result.url!, { signal: AbortSignal.timeout(30_000) })).arrayBuffer())
  const key = `generated/local-images/${Date.now()}-${uuidv4()}.png`
  const url = await uploadImageBufferToR2(bytes, key, 'image/png')
  return { url }
}
