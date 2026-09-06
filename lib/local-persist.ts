/**
 * 本地（同步）图像生成的服务端落库——对齐 Kie webhook 语义（ADR-0001 一期遗留补齐）。
 * Kie 流由 webhook 在服务端写 project_data（前端关闭也不丢失）；local 流的结果此前只活在
 * 同步 HTTP 响应里，页面中断/刷新即丢。生成成功后调用 persistLocalImageUrl 直接写库，
 * 客户端靠既有项目态轮询/续跑逻辑自然取回 URL。写库失败只记日志不抛出（不阻塞返回）。
 */
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { projectData, videoProjects } from '@/lib/schema'
import { safeJsonCopy } from '@/lib/ai-types'
import type { CharacterItem, StoryboardItem } from '@/lib/types'

export function applyImageUrlToCharacters(
  characters: CharacterItem[],
  itemId: string | null | undefined,
  imageUrl: string,
): { next: CharacterItem[]; ok: boolean } {
  const idx = characters.findIndex((c: CharacterItem) => String(c.id) === String(itemId))
  if (idx < 0) return { next: characters, ok: false }
  const next = [...characters]
  next[idx] = { ...next[idx], imageUrl }
  return { next, ok: true }
}

export function applyImageUrlToStoryboards(
  storyboards: StoryboardItem[],
  itemId: string | null | undefined,
  imageUrl: string,
): { next: StoryboardItem[]; ok: boolean } {
  let idx = storyboards.findIndex(
    (s: StoryboardItem) => String(s.id) === String(itemId) || String(s.sceneId) === String(itemId),
  )
  if (idx < 0) {
    const n = parseInt(String(itemId), 10)
    if (!isNaN(n) && n >= 0 && n < storyboards.length) idx = n
  }
  if (idx < 0) return { next: storyboards, ok: false }
  const next = [...storyboards]
  next[idx] = { ...next[idx], imageUrl }
  return { next, ok: true }
}

/** 把本地生成的图像 URL 写入 project_data 对应条目，并推进 video_projects.currentStep。 */
export async function persistLocalImageUrl(opts: {
  projectId?: string | null
  versionId?: string | null
  kind: 'character' | 'storyboard'
  itemId?: string | null
  imageUrl: string
}): Promise<boolean> {
  const { versionId, kind, itemId, imageUrl } = opts
  if (!versionId || !imageUrl) return false
  try {
    const [row] = await db.select().from(projectData).where(eq(projectData.id, versionId)).limit(1)
    if (!row) return false

    if (kind === 'character') {
      const characters: CharacterItem[] = safeJsonCopy<CharacterItem[]>(row.characterData) || []
      const applied = applyImageUrlToCharacters(characters, itemId, imageUrl)
      if (!applied.ok) {
        console.error('[local-persist] 主角条目未匹配:', { versionId, itemId })
        return false
      }
      await db
        .update(projectData)
        .set({ characterData: applied.next, updatedAt: new Date() })
        .where(eq(projectData.id, row.id))
    } else {
      const storyboards: StoryboardItem[] = safeJsonCopy<StoryboardItem[]>(row.storyboardData) || []
      const applied = applyImageUrlToStoryboards(storyboards, itemId, imageUrl)
      if (!applied.ok) {
        console.error('[local-persist] 分镜条目未匹配:', { versionId, itemId })
        return false
      }
      await db
        .update(projectData)
        .set({ storyboardData: applied.next, updatedAt: new Date() })
        .where(eq(projectData.id, row.id))
    }

    if (opts.projectId) {
      await db
        .update(videoProjects)
        .set({ currentStep: kind === 'character' ? 'character' : 'storyboard', updatedAt: new Date() })
        .where(eq(videoProjects.id, opts.projectId))
    }
    return true
  } catch (error) {
    // 持久化失败不影响生成结果返回（客户端仍持有 URL），只记日志供排查
    console.error('[local-persist] 写入 projectData 失败（不影响返回）:', error)
    return false
  }
}

/** 本地视频完成：按场景序号映射 sceneId 后把 R2 URL 写入 sceneVideoData（对齐客户端保存形状）。 */
export async function persistLocalVideoUrl(opts: {
  projectId?: string | null
  versionId?: string | null
  /** 生成任务行的 sceneIndex（0 起）；据此映射 scriptScenes 的 sceneId */
  sceneIndex?: number | null
  videoUrl: string
}): Promise<boolean> {
  const { versionId, sceneIndex, videoUrl } = opts
  if (!versionId || !videoUrl) return false
  try {
    const [row] = await db.select().from(projectData).where(eq(projectData.id, versionId)).limit(1)
    if (!row) return false

    const scriptScenes = safeJsonCopy<Array<{ sceneId?: number | string }>>(row.scriptScenes) || []
    const entry = scriptScenes[sceneIndex ?? -1]
    const sceneId = entry?.sceneId != null ? String(entry.sceneId) : String((sceneIndex ?? 0) + 1)

    const sceneVideos = safeJsonCopy<Array<{ sceneId: number | string; videoUrl: string; isTemporary?: boolean }>>(row.sceneVideoData) || []
    const idx = sceneVideos.findIndex((v) => String(v.sceneId) === sceneId)
    if (idx >= 0) {
      sceneVideos[idx] = { ...sceneVideos[idx], videoUrl, isTemporary: true }
    } else {
      sceneVideos.push({ sceneId: Number(sceneId) || sceneId, videoUrl, isTemporary: true })
    }
    await db
      .update(projectData)
      .set({ sceneVideoData: sceneVideos, updatedAt: new Date() })
      .where(eq(projectData.id, row.id))
    return true
  } catch (error) {
    console.error('[local-persist] 写入 sceneVideoData 失败（不影响返回）:', error)
    return false
  }
}
