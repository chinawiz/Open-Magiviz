import {
  probeMediaUrl,
  validateVideoMeta,
  validateAudioMeta,
  SEEDANCE_LIMITS,
  type MediaMeta,
} from "@/lib/media-validation"

/** 待上传媒体条目中本模块用到的字段（与 operate.tsx 的 UploadingItem 结构兼容） */
export type SeedanceMediaItem = {
  filename: string
  localUrl?: string
  url?: string
  type: "image" | "audio" | "video"
}

/**
 * 校验已上传/上传中的视频/音频文件是否符合 Seedance 约束（自 operate.tsx 抽出，拆分 T2）。
 * - 探测每个文件的元数据（时长/宽高/像素/帧率）
 * - 校验数量上限与总时长
 * - 不通过返回失败原因，全部通过返回 ok
 */
export async function validateSeedanceMedia(
  items: SeedanceMediaItem[],
  t: (key: string, opts?: any) => string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const probed: Array<{ item: SeedanceMediaItem; meta: MediaMeta | null; err?: string }> = []
  for (const it of items) {
    const src = it.url || it.localUrl
    if (!src) {
      probed.push({ item: it, meta: null, err: "no source" })
      continue
    }
    try {
      const meta = await probeMediaUrl(src, it.type as "video" | "audio")
      probed.push({ item: it, meta })
    } catch (e: any) {
      probed.push({ item: it, meta: null, err: e?.message || String(e) })
    }
  }

  const videoItems = probed.filter((p) => p.item.type === "video")
  const audioItems = probed.filter((p) => p.item.type === "audio")

  if (videoItems.length > SEEDANCE_LIMITS.video.maxCount) {
    return {
      ok: false,
      message: t("mediaValidationVideoCount", {
        max: SEEDANCE_LIMITS.video.maxCount,
        got: videoItems.length,
      }),
    }
  }
  if (audioItems.length > SEEDANCE_LIMITS.audio.maxCount) {
    return {
      ok: false,
      message: t("mediaValidationAudioCount", {
        max: SEEDANCE_LIMITS.audio.maxCount,
        got: audioItems.length,
      }),
    }
  }

  const totalVideoDur = videoItems.reduce((s, p) => s + (p.meta?.duration || 0), 0)
  const totalAudioDur = audioItems.reduce((s, p) => s + (p.meta?.duration || 0), 0)
  if (totalVideoDur > SEEDANCE_LIMITS.video.maxTotalDuration + 0.01) {
    return {
      ok: false,
      message: t("mediaValidationVideoTotalDuration", {
        max: SEEDANCE_LIMITS.video.maxTotalDuration,
        got: totalVideoDur.toFixed(1),
      }),
    }
  }
  if (totalAudioDur > SEEDANCE_LIMITS.audio.maxTotalDuration + 0.01) {
    return {
      ok: false,
      message: t("mediaValidationAudioTotalDuration", {
        max: SEEDANCE_LIMITS.audio.maxTotalDuration,
        got: totalAudioDur.toFixed(1),
      }),
    }
  }

  for (const p of probed) {
    if (!p.meta) {
      return {
        ok: false,
        message: t("mediaValidationProbeFailed", { filename: p.item.filename, err: p.err }),
      }
    }
    const err =
      p.item.type === "video"
        ? validateVideoMeta(p.meta)
        : p.item.type === "audio"
        ? validateAudioMeta(p.meta)
        : null
    if (err) {
      return {
        ok: false,
        message: t("mediaValidationFileFailed", {
          filename: p.item.filename,
          type: p.item.type,
          reason: err.message,
        }),
      }
    }
  }
  return { ok: true }
}
