import { task } from "@trigger.dev/sdk"
import { spawnSync } from "node:child_process"
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { db } from "@/lib/db"
import { aiGenerationTasks, projectData, videoProjects } from "@/lib/schema"
import { eq } from "drizzle-orm"
import { uploadToR2, downloadFile } from "@/trigger/migrate-assets"
import { notifyComposeSuccess, notifyTaskFail } from "@/lib/pusher"
import { resolveTargetVersion, clearVersionGroup } from "@/lib/versionMapper"
import { markTaskSuccess } from "@/lib/task-points"
import { trackFunnelEvent } from "@/lib/observability/track"

/**
 * F2 成片合成自托管（替代 FAL ffmpeg-api/compose）。
 *
 * 链路：下载场景视频 → 本地 ffmpeg 统一转码拼接（规格对齐路由的 outputFormat，
 * 默认 1920x1080/30fps，等比缩放+黑边）→ 首帧缩略图 → 直传 R2 拿永久 URL
 * → 写 projectData/videoProjects → markTaskSuccess → Pusher → 清理版本组。
 *
 * 与 FAL 路径的差异：
 * - 输出直接是 R2 永久 URL（FAL 路径还要再触发一次搬运任务）；
 * - 无回调丢失面（任务自带重试，成功/失败都由任务落终态）；
 * - ffmpeg 二进制来自 ffmpeg-static（可用 FFMPEG_PATH 环境变量覆盖为容器自带）。
 *
 * 范围边界：仅支持视频轨顺序拼接（当前前端只发视频轨）；
 * 若将来需要独立音频轨混音，再扩展 amix 滤镜或回退 FAL 路径。
 */

/** 解析 ffmpeg 可执行文件路径（FFMPEG_PATH 覆盖 > ffmpeg-static 包内二进制）。
 *  兼容 CJS（require）与 ESM（动态 import）两种打包输出。 */
async function resolveFfmpegPath(): Promise<string> {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("ffmpeg-static") as string
  } catch {
    const mod = await import("ffmpeg-static")
    return ((mod as { default?: string }).default ?? mod) as unknown as string
  }
}

async function runFfmpeg(args: string[], workspace: string): Promise<void> {
  const r = spawnSync(await resolveFfmpegPath(), args, { encoding: "utf8", cwd: workspace })
  if (r.status !== 0) {
    throw new Error(`ffmpeg 退出码 ${r.status}: ${(r.stderr || "").slice(-400)}`)
  }
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
}

export const composeFinalVideo = task({
  id: "compose-final-video",
  run: async (payload: {
    taskId: string
    userId: string
    projectId?: string | null
    versionId?: string | null
    versionGroupId?: string | null
    /** 按播放顺序排列的场景视频 URL */
    videoUrls: string[]
    /** 总时长（秒），与路由 calculateTotalDuration 一致 */
    totalDurationSec: number
    outputFormat?: { width: number; height: number; fps: number }
  }) => {
    const { taskId, userId, projectId, versionId: taskVersionId, versionGroupId, videoUrls, totalDurationSec } = payload
    const format = { width: 1920, height: 1080, fps: 30, ...payload.outputFormat }

    const startedAt = Date.now()
    const workspace = await mkdtemp(path.join(tmpdir(), "compose-"))
    try {
      console.log(`[compose-final-video] 开始合成`, { taskId, projectId, clips: videoUrls.length, format })

      // 1. 下载场景视频
      const localFiles: string[] = []
      for (let i = 0; i < videoUrls.length; i++) {
        const buf = await downloadFile(videoUrls[i])
        const file = path.join(workspace, `scene-${i + 1}.mp4`)
        await writeFile(file, buf)
        localFiles.push(file)
      }

      // 2. 统一转码拼接（等比缩放 + 黑边 + 固定帧率，规避各模型编码/分辨率差异）
      const concatFile = path.join(workspace, "concat.txt")
      await writeFile(concatFile, localFiles.map(f => `file '${f}'`).join("\n"))
      const finalFile = path.join(workspace, "final.mp4")
      await runFfmpeg([
        "-y",
        "-f", "concat", "-safe", "0", "-i", concatFile,
        "-vf", `scale=${format.width}:${format.height}:force_original_aspect_ratio=decrease,pad=${format.width}:${format.height}:(ow-iw)/2:(oh-ih)/2,fps=${format.fps}`,
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        finalFile,
      ], workspace)

      // 3. 首帧缩略图
      const thumbFile = path.join(workspace, "thumb.png")
      await runFfmpeg(["-y", "-ss", "0", "-i", finalFile, "-frames:v", "1", thumbFile], workspace)

      // 4. 直传 R2（永久 URL，省去 FAL 路径的二次搬运）
      const { readFile } = await import("node:fs/promises")
      const videoKey = `projects/${projectId || "unknown"}/final-video/${taskId}.mp4`
      const thumbKey = `projects/${projectId || "unknown"}/final-thumbnail/${taskId}.png`
      const [finalUrl, thumbUrl] = await Promise.all([
        uploadToR2(await readFile(finalFile), videoKey, "video/mp4"),
        uploadToR2(await readFile(thumbFile), thumbKey, "image/png"),
      ])
      const fileSizeStr = formatFileSize((await stat(finalFile)).size)

      // 5. 确定目标版本（与 compose-webhook 相同的版本解析逻辑）
      let targetVersionId = taskVersionId || ""
      let newVersion = 1
      if (projectId) {
        const resolved = await resolveTargetVersion(projectId, versionGroupId, taskVersionId, "final_video")
        targetVersionId = resolved.targetVersionId
        newVersion = resolved.newVersion
      }

      // 6. 写 projectData + videoProjects
      if (projectId && targetVersionId) {
        await db.update(projectData).set({
          finalVideoUrl: finalUrl,
          finalVideoThumbnail: thumbUrl,
          finalVideoSize: fileSizeStr,
          finalVideoDuration: totalDurationSec,
          updatedAt: new Date(),
        }).where(eq(projectData.id, targetVersionId))

        await db.update(videoProjects).set({
          currentStep: "final_video",
          status: "completed",
          thumbnailUrl: thumbUrl,
          completedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(videoProjects.id, projectId))
      }

      // 7. 任务终态 + 推送 + 清理版本组（合成 0 积分，与 FAL 路径一致）
      await markTaskSuccess(taskId)
      await notifyComposeSuccess({
        taskId,
        videoUrl: finalUrl,
        thumbnailUrl: thumbUrl,
        duration: totalDurationSec,
        fileSize: fileSizeStr,
        projectId: projectId ?? undefined,
        versionId: targetVersionId,
        version: newVersion,
        versionGroupId: versionGroupId ?? undefined,
      })
      if (versionGroupId && projectId) {
        await clearVersionGroup(projectId, versionGroupId).catch((err) => {
          console.error(`[compose-final-video] 清理版本组失败:`, err)
        })
      }

      trackFunnelEvent({ stage: 'final', userId, projectId: projectId ?? null, success: true, durationMs: Date.now() - startedAt, provider: 'local', model: 'ffmpeg', taskId })

      console.log(`[compose-final-video] 合成完成`, { taskId, finalUrl, fileSizeStr })
      return { success: true, videoUrl: finalUrl, thumbnailUrl: thumbUrl, fileSize: fileSizeStr }
    } catch (error) {
      trackFunnelEvent({ stage: 'final', userId, projectId: projectId ?? null, success: false, durationMs: Date.now() - startedAt, provider: 'local', model: 'ffmpeg', taskId, error: String(error).slice(0, 200) })
      console.error(`[compose-final-video] 合成失败（将重试）:`, error)
      await notifyTaskFail({ taskId, error: "视频合成失败" }).catch(() => {})
      throw error // 抛出让 Trigger.dev 重试；3 次耗尽后任务保持可人工补偿
    } finally {
      await rm(workspace, { recursive: true, force: true }).catch(() => {})
    }
  },
})
