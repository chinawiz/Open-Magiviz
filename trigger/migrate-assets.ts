import { task } from "@trigger.dev/sdk"
import { db } from "@/lib/db"
import { projectData, assetMigrations } from "@/lib/schema"
import { eq, and } from "drizzle-orm"
import type { CharacterItem, StoryboardItem, SceneVideoItem } from "@/lib/types"
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3"
import { v4 as uuidv4 } from 'uuid'

/**
 * 资源类型
 */
type ResourceType =
  | "character"
  | "storyboard"
  | "storyboard-first"
  | "storyboard-last"
  | "scene-video"
  | "final-video"
  | "final-thumbnail"

/**
 * R2 S3 客户端
 */
const S3 = new S3Client({
  region: process.env.R2_REGION || "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY || "",
    secretAccessKey: process.env.R2_SECRET_KEY || "",
  },
})

/**
 * 上传文件到 R2 存储
 * @param buffer 文件内容 Buffer
 * @param key R2 存储路径（例如：projects/{projectId}/characters/{filename}）
 * @param contentType MIME 类型
 * @returns 永久 URL
 */
export async function uploadToR2(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  console.log(`[uploadToR2] 开始上传`, {
    key,
    bucket: process.env.R2_BUCKET,
    contentType,
    size: buffer.length,
  })

  await S3.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  )

  console.log(`[uploadToR2] 上传完成`)

  // 构建永久 URL
  const publicBase = process.env.R2_PUBLIC_URL?.replace(/\/$/, "") || ""
  if (publicBase) {
    const url = `${publicBase}/${key}`
    console.log(`[uploadToR2] 永久 URL (public): ${url}`)
    return url
  }

  // 如果没有配置 R2_PUBLIC_URL，使用 endpoint/bucket/key 格式
  if (process.env.R2_ENDPOINT && process.env.R2_BUCKET) {
    const endpointClean = process.env.R2_ENDPOINT.replace(/\/$/, "")
    const url = `${endpointClean}/${process.env.R2_BUCKET}/${key}`
    console.log(`[uploadToR2] 永久 URL (endpoint): ${url}`)
    return url
  }

  // 最后的回退方案
  console.log(`[uploadToR2] 无 public URL 配置，返回 key: ${key}`)
  return key
}

/**
 * 从 URL 下载文件
 */
export async function downloadFile(url: string): Promise<Buffer> {
  console.log(`[downloadFile] 开始下载: ${url}`)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  console.log(`[downloadFile] 下载完成, size: ${buffer.length} bytes`)
  return buffer
}

/**
 * 根据资源类型生成 R2 存储路径
 */
export function generateR2Key(
  projectId: string,
  resourceType: ResourceType,
  resourceId: string | null,
  extension: string
): string {
  const timestamp = Date.now()
  const id = resourceId || timestamp.toString()

  switch (resourceType) {
    case "character":
      return `projects/${projectId}/characters/${id}-${timestamp}.${extension}`
    case "storyboard":
      return `projects/${projectId}/storyboards/${id}-${timestamp}.${extension}`
    case "scene-video":
      return `projects/${projectId}/scene-videos/${id}-${timestamp}.${extension}`
    case "final-video":
      return `projects/${projectId}/final/video-${timestamp}.${extension}`
    case "final-thumbnail":
      return `projects/${projectId}/final/thumbnail-${timestamp}.${extension}`
    default:
      return `projects/${projectId}/uploads/${id}-${timestamp}.${extension}`
  }
}

/**
 * 根据 URL 推断 Content-Type
 */
export function inferContentType(url: string, extension?: string): string {
  const ext = extension || url.split(".").pop()?.toLowerCase() || ""

  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    pdf: "application/pdf",
  }

  return mimeTypes[ext] || "application/octet-stream"
}

/**
 * 从 URL 中提取文件扩展名
 */
export function getFileExtension(url: string): string {
  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname
    const lastDot = pathname.lastIndexOf(".")
    if (lastDot === -1) {
      return ""
    }
    const ext = pathname.substring(lastDot + 1).toLowerCase()
    // 移除查询参数
    const queryIndex = ext.indexOf("?")
    return queryIndex > -1 ? ext.substring(0, queryIndex) : ext
  } catch {
    return ""
  }
}

/**
 * 从 URL 中提取文件名
 */
export function getFileName(url: string): string {
  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname
    const lastSlash = pathname.lastIndexOf("/")
    const fileName = lastSlash > -1 ? pathname.substring(lastSlash + 1) : pathname
    // 移除查询参数
    const queryIndex = fileName.indexOf("?")
    return queryIndex > -1 ? fileName.substring(0, queryIndex) : fileName
  } catch {
    return "file"
  }
}

/**
 * 通用：将临时 URL 对应的文件迁移到 R2，并返回永久链接
 * 支持防重复迁移：同一 projectId + resourceType + sourceUrl 组合只迁移一次
 */
export async function migrateUrlToR2(params: {
  projectId: string
  tempUrl: string
  resourceType: ResourceType
  resourceId?: string | null
  defaultExtension: string
}) {
  const { projectId, tempUrl, resourceType, resourceId, defaultExtension } = params

  console.log(`[migrateUrlToR2] 开始迁移`, {
    projectId,
    resourceType,
    resourceId,
    defaultExtension,
    tempUrl: tempUrl.substring(0, 100) + '...',
  })

  // 0. 检查是否已经迁移过（防重复）
  const existingMigration = await db
    .select()
    .from(assetMigrations)
    .where(
      and(
        eq(assetMigrations.projectId, projectId),
        eq(assetMigrations.resourceType, resourceType),
        eq(assetMigrations.sourceUrl, tempUrl)
      )
    )
    .limit(1)

  if (existingMigration.length > 0) {
    const existing = existingMigration[0]
    if (existing.status === 'completed' && existing.permanentUrl) {
      console.log(`[migrateUrlToR2] 检测到已迁移，跳过（防重复）:`, {
        resourceType,
        sourceUrl: tempUrl.substring(0, 80) + '...',
        permanentUrl: existing.permanentUrl.substring(0, 80) + '...',
      })
      return {
        permanentUrl: existing.permanentUrl,
        r2Key: existing.r2Key || '',
        contentType: '',
        extension: defaultExtension,
        skipped: true,  // 标记为跳过，用于调用方识别
      }
    } else if (existing.status === 'pending' || existing.status === 'failed') {
      // 正在迁移中或之前失败，更新状态
      console.log(`[migrateUrlToR2] 继续之前的迁移任务:`, {
        resourceType,
        status: existing.status,
        retryCount: existing.retryCount,
      })
    }
  }

  // 1. 下载临时文件
  console.log(`[migrateUrlToR2] 下载文件 from: ${tempUrl}`)
  const buffer = await downloadFile(tempUrl)
  console.log(`[migrateUrlToR2] 文件下载完成, size: ${buffer.length} bytes`)

  const extension = getFileExtension(tempUrl) || defaultExtension
  const contentType = inferContentType(tempUrl, extension)
  console.log(`[migrateUrlToR2] 文件信息`, { extension, contentType })

  // 2. 生成 R2 key 并上传
  const r2Key = generateR2Key(projectId, resourceType, resourceId || null, extension)
  console.log(`[migrateUrlToR2] 上传到 R2`, { r2Key, bucket: process.env.R2_BUCKET })

  const permanentUrl = await uploadToR2(buffer, r2Key, contentType)
  console.log(`[migrateUrlToR2] 上传完成`, { permanentUrl: permanentUrl.substring(0, 100) + '...' })

  // 3. 记录迁移结果
  try {
    if (existingMigration.length > 0) {
      // 更新已有记录
      await db
        .update(assetMigrations)
        .set({
          permanentUrl,
          r2Key,
          status: 'completed',
          updatedAt: new Date(),
        })
        .where(eq(assetMigrations.id, existingMigration[0].id))
    } else {
      // 创建新记录
      await db.insert(assetMigrations).values({
        id: uuidv4(),
        projectId,
        resourceType,
        sourceUrl: tempUrl,
        permanentUrl,
        r2Key,
        status: 'completed',
        retryCount: 0,
      })
    }
  } catch (recordError) {
    console.error(`[migrateUrlToR2] 记录迁移结果失败:`, recordError)
    // 不阻塞主流程，继续返回结果
  }

  return {
    permanentUrl,
    r2Key,
    contentType,
    extension,
  }
}

export const migrateCharacterImage = task({
  id: "migrate-character-image",
  run: async (payload: {
    projectId: string
    projectDataId: string
    characterIndex: number
    characterId: string | null
    tempUrl: string
  }) => {
    const { projectId, projectDataId, characterIndex, characterId, tempUrl } = payload

    try {
      console.log(`[migrate-character-image] 开始迁移主角图片`, {
        projectId,
        projectDataId,
        characterIndex,
        characterId,
        tempUrl: tempUrl.substring(0, 80) + '...',
      })

      // 1. 迁移到 R2（下载 + 上传）
      const { permanentUrl, r2Key } = await migrateUrlToR2({
        projectId,
        tempUrl,
        resourceType: "character",
        resourceId: characterId,
        defaultExtension: "png",
      })

      console.log(`[migrate-character-image] 上传成功`, {
        r2Key,
        permanentUrl: permanentUrl.substring(0, 80) + '...',
      })

      // 2. 更新数据库 - 优先用 characterId 查找，否则用 characterIndex 兜底
      const [data] = await db
        .select({ characterData: projectData.characterData })
        .from(projectData)
        .where(eq(projectData.id, projectDataId))

      if (!data || !data.characterData || !Array.isArray(data.characterData)) {
        throw new Error('Character data not found or invalid')
      }

      // 根据 characterId 查找索引
      let targetIndex = -1
      const characterData = data.characterData as CharacterItem[]
      if (characterId) {
        targetIndex = characterData.findIndex((c: CharacterItem) => String(c.id) === String(characterId))
        console.log(`[migrate-character-image] 用 characterId=${characterId} 查找索引: ${targetIndex}`)
      }

      // 如果用 characterId 没找到，用 characterIndex 兜底
      if (targetIndex < 0 && characterIndex >= 0 && characterIndex < characterData.length) {
        targetIndex = characterIndex
        console.log(`[migrate-character-image] characterId 未匹配到，用 characterIndex=${characterIndex} 兜底`)
      }

      if (targetIndex < 0) {
        throw new Error(`未找到目标主角: characterId=${characterId}, characterIndex=${characterIndex}`)
      }

      // 更新指定索引的主角图片 URL
      const updatedCharacterData = [...characterData]
      if (updatedCharacterData[targetIndex]) {
        updatedCharacterData[targetIndex] = {
          ...updatedCharacterData[targetIndex],
          imageUrl: permanentUrl,
          isTemporary: false,
        }
      }

      await db
        .update(projectData)
        .set({
          characterData: updatedCharacterData,
          migrationStatus: 'completed',
          migrationCompletedAt: new Date(),
        })
        .where(eq(projectData.id, projectDataId))

      console.log(`[migrate-character-image] 数据库更新成功`, {
        projectDataId,
        characterIndex: targetIndex,
        characterId,
      })

      return {
        success: true,
        permanentUrl,
        r2Key,
      }
    } catch (error) {
      console.error(`[migrate-character-image] 迁移失败`, {
        projectId,
        projectDataId,
        characterIndex,
        characterId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  },
})

export const migrateStoryboardImage = task({
  id: "migrate-storyboard-image",
  run: async (payload: {
    projectId: string
    projectDataId: string
    storyboardIndex: number
    sceneId: string | null
    tempUrl: string
    frameType?: 'first' | 'last'  // 首尾帧模式专用
  }) => {
    const { projectId, projectDataId, storyboardIndex, sceneId, tempUrl, frameType } = payload

    try {
      console.log(`[migrate-storyboard-image] 开始迁移分镜图`, {
        projectId,
        projectDataId,
        storyboardIndex,
        sceneId,
        frameType,
        tempUrl: tempUrl.substring(0, 80) + '...',
      })

      // 1. 迁移到 R2（下载 + 上传）
      // 根据 frameType 使用不同的 resourceType，便于防重复检查
      const resourceType: ResourceType = frameType === 'first' 
        ? 'storyboard-first' 
        : frameType === 'last' 
          ? 'storyboard-last' 
          : 'storyboard'
      
      const { permanentUrl, r2Key, skipped } = await migrateUrlToR2({
        projectId,
        tempUrl,
        resourceType,
        resourceId: sceneId,
        defaultExtension: "png",
      })

      console.log(`[migrate-storyboard-image] 迁移${skipped ? '(跳过-已迁移)' : ''}成功`, {
        resourceType,
        r2Key,
        permanentUrl: permanentUrl.substring(0, 80) + '...',
      })

      // 2. 更新数据库 - 优先用 sceneId 查找，否则用 storyboardIndex 兜底
      const [data] = await db
        .select({ storyboardData: projectData.storyboardData })
        .from(projectData)
        .where(eq(projectData.id, projectDataId))

      if (!data || !data.storyboardData || !Array.isArray(data.storyboardData)) {
        throw new Error('Storyboard data not found or invalid')
      }

      // 根据 sceneId 查找索引
      let targetIndex = -1
      const storyboardData = data.storyboardData as StoryboardItem[]
      if (sceneId) {
        targetIndex = storyboardData.findIndex(
          (s: StoryboardItem) => String(s.sceneId) === String(sceneId) || String(s.id) === String(sceneId)
        )
        console.log(`[migrate-storyboard-image] 用 sceneId=${sceneId} 查找索引: ${targetIndex}`)
      }

      // 如果用 sceneId 没找到，用 storyboardIndex 兜底
      if (targetIndex < 0 && storyboardIndex >= 0 && storyboardIndex < storyboardData.length) {
        targetIndex = storyboardIndex
        console.log(`[migrate-storyboard-image] sceneId 未匹配到，用 storyboardIndex=${storyboardIndex} 兜底`)
      }

      if (targetIndex < 0) {
        throw new Error(`未找到目标分镜: sceneId=${sceneId}, storyboardIndex=${storyboardIndex}`)
      }

      // 更新指定索引的分镜图 URL
      const updatedStoryboardData = [...storyboardData]
      if (updatedStoryboardData[targetIndex]) {
        const existingStoryboard = updatedStoryboardData[targetIndex]
        
        // 首尾帧模式：分别更新 firstFrameUrl 或 lastFrameUrl
        if (frameType === 'first') {
          updatedStoryboardData[targetIndex] = {
            ...existingStoryboard,
            firstFrameUrl: permanentUrl,
            imageUrl: permanentUrl, // 首帧作为主图
            isTemporary: false,
          }
        } else if (frameType === 'last') {
          updatedStoryboardData[targetIndex] = {
            ...existingStoryboard,
            lastFrameUrl: permanentUrl,
            isTemporary: false,
          }
        } else {
          // 普通模式：只更新 imageUrl
          updatedStoryboardData[targetIndex] = {
            ...existingStoryboard,
            imageUrl: permanentUrl,
            isTemporary: false,
          }
        }
      }

      await db
        .update(projectData)
        .set({
          storyboardData: updatedStoryboardData,
          migrationStatus: 'completed',
          migrationCompletedAt: new Date(),
        })
        .where(eq(projectData.id, projectDataId))

      console.log(`[migrate-storyboard-image] 数据库更新成功`, {
        projectDataId,
        storyboardIndex: targetIndex,
        sceneId,
        frameType,
        permanentUrl: permanentUrl.substring(0, 80) + '...',
      })

      return {
        success: true,
        permanentUrl,
        r2Key,
      }
    } catch (error) {
      console.error(`[migrate-storyboard-image] 迁移失败`, {
        projectId,
        projectDataId,
        storyboardIndex,
        sceneId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  },
})

export const migrateSceneVideo = task({
  id: "migrate-scene-video",
  run: async (payload: {
    projectId: string
    projectDataId: string
    sceneIndex: number
    sceneId: string | null
    tempUrl: string
  }) => {
    const { projectId, projectDataId, sceneIndex, sceneId, tempUrl } = payload

    try {
      console.log(`[migrate-scene-video] 开始迁移剧情视频`, {
        projectId,
        projectDataId,
        sceneIndex,
        sceneId,
        tempUrl: tempUrl.substring(0, 80) + '...',
      })

      // 1. 迁移到 R2（下载 + 上传）
      const { permanentUrl, r2Key } = await migrateUrlToR2({
        projectId,
        tempUrl,
        resourceType: "scene-video",
        resourceId: sceneId,
        defaultExtension: "mp4",
      })

      console.log(`[migrate-scene-video] 上传成功`, {
        r2Key,
        permanentUrl: permanentUrl.substring(0, 80) + '...',
      })

      // 2. 更新数据库 - 优先用 sceneId 查找，否则用 sceneIndex 兜底
      const [data] = await db
        .select({ sceneVideoData: projectData.sceneVideoData })
        .from(projectData)
        .where(eq(projectData.id, projectDataId))

      if (!data || !data.sceneVideoData || !Array.isArray(data.sceneVideoData)) {
        throw new Error('Scene video data not found or invalid')
      }

      const sceneVideoData = data.sceneVideoData as SceneVideoItem[]
      console.log(`[migrate-scene-video] 当前 sceneVideoData 结构:`, {
        length: sceneVideoData.length,
        items: sceneVideoData.map((s: SceneVideoItem, i: number) => ({
          index: i,
          sceneId: s.sceneId,
          id: s.id,
          hasVideoUrl: !!s.videoUrl,
        })),
      })

      // 根据 sceneId 查找索引
      let targetIndex = -1
      if (sceneId) {
        targetIndex = sceneVideoData.findIndex(
          (s: SceneVideoItem) => String(s.sceneId) === String(sceneId) || String(s.id) === String(sceneId)
        )
        console.log(`[migrate-scene-video] 用 sceneId=${sceneId} 查找索引: ${targetIndex}`)
      }

      // 如果用 sceneId 没找到，用 sceneIndex 兜底
      if (targetIndex < 0 && sceneIndex >= 0 && sceneIndex < sceneVideoData.length) {
        targetIndex = sceneIndex
        console.log(`[migrate-scene-video] sceneId 未匹配到，用 sceneIndex=${sceneIndex} 兜底`)
      }

      if (targetIndex < 0) {
        throw new Error(`未找到目标视频: sceneId=${sceneId}, sceneIndex=${sceneIndex}`)
      }

      // 更新指定索引的视频 URL
      const updatedSceneVideoData = [...sceneVideoData]
      if (updatedSceneVideoData[targetIndex]) {
        updatedSceneVideoData[targetIndex] = {
          ...updatedSceneVideoData[targetIndex],
          videoUrl: permanentUrl,
          isTemporary: false,
        }
      }

      await db
        .update(projectData)
        .set({
          sceneVideoData: updatedSceneVideoData,
          migrationStatus: 'completed',
          migrationCompletedAt: new Date(),
        })
        .where(eq(projectData.id, projectDataId))

      console.log(`[migrate-scene-video] 数据库更新成功`, {
        projectDataId,
        sceneIndex: targetIndex,
        sceneId,
      })

      return {
        success: true,
        permanentUrl,
        r2Key,
      }
    } catch (error) {
      console.error(`[migrate-scene-video] 迁移失败`, {
        projectId,
        projectDataId,
        sceneIndex,
        sceneId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  },
})

export const migrateFinalVideo = task({
  id: "migrate-final-video",
  run: async (payload: {
    projectId: string
    projectDataId: string
    videoUrl?: string
    thumbnailUrl?: string
  }) => {
    const { projectId, projectDataId, videoUrl, thumbnailUrl } = payload

    try {
      console.log(`[migrate-final-video] 开始迁移最终视频`, {
        projectId,
        projectDataId,
        hasVideoUrl: !!videoUrl,
        hasThumbnailUrl: !!thumbnailUrl,
      })

      const updates: {
        finalVideoUrl?: string
        finalVideoThumbnail?: string
        migrationStatus?: string
        migrationCompletedAt?: Date
      } = {}

      // 迁移视频
      if (videoUrl) {
        console.log(`[migrate-final-video] 迁移视频`, {
          tempUrl: videoUrl.substring(0, 80) + '...',
        })

        const { permanentUrl, r2Key } = await migrateUrlToR2({
          projectId,
          tempUrl: videoUrl,
          resourceType: "final-video",
          resourceId: null,
          defaultExtension: "mp4",
        })

        updates.finalVideoUrl = permanentUrl

        console.log(`[migrate-final-video] 视频上传成功`, {
          r2Key,
          permanentUrl: permanentUrl.substring(0, 80) + '...',
        })
      }

      // 迁移缩略图
      if (thumbnailUrl) {
        console.log(`[migrate-final-video] 迁移缩略图`, {
          tempUrl: thumbnailUrl.substring(0, 80) + '...',
        })

        const { permanentUrl, r2Key } = await migrateUrlToR2({
          projectId,
          tempUrl: thumbnailUrl,
          resourceType: "final-thumbnail",
          resourceId: null,
          defaultExtension: "jpg",
        })

        updates.finalVideoThumbnail = permanentUrl

        console.log(`[migrate-final-video] 缩略图上传成功`, {
          r2Key,
          permanentUrl: permanentUrl.substring(0, 80) + '...',
        })
      }

      // 更新数据库
      await db
        .update(projectData)
        .set({
          ...updates,
          migrationStatus: 'completed',
          migrationCompletedAt: new Date(),
        })
        .where(eq(projectData.id, projectDataId))

      console.log(`[migrate-final-video] 数据库更新成功`, {
        projectDataId,
      })

      return {
        success: true,
        videoUrl: updates.finalVideoUrl,
        thumbnailUrl: updates.finalVideoThumbnail,
      }
    } catch (error) {
      console.error(`[migrate-final-video] 迁移失败`, {
        projectId,
        projectDataId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  },
})

/**
 * 触发主角图片迁移任务
 */
export async function triggerCharacterImageMigration(
  projectId: string,
  projectDataId: string,
  characterData: CharacterItem[]
) {
  console.log(`[triggerCharacterImageMigration] 开始触发迁移任务`, {
    projectId,
    projectDataId,
    characterCount: characterData?.length || 0,
  })

  if (!characterData || !Array.isArray(characterData) || characterData.length === 0) {
    console.log(`[triggerCharacterImageMigration] 无主角数据，跳过`)
    return
  }

  let successCount = 0
  let failCount = 0

  // 串行执行，确保顺序正确
  for (let index = 0; index < characterData.length; index++) {
    const character = characterData[index]
    const imageUrl = character?.imageUrl || character?.url
    const characterId = character?.id || null

    if (!imageUrl) {
      console.log(`[triggerCharacterImageMigration] 主角 ${index} (id=${characterId}) 无图片URL，跳过`)
      continue
    }

    console.log(`[triggerCharacterImageMigration] 触发主角 ${index} (id=${characterId}) 迁移`, { imageUrl: imageUrl.substring(0, 80) + '...' })

    try {
      await migrateCharacterImage.trigger({
        projectId,
        projectDataId,
        characterIndex: index,
        characterId,
        tempUrl: imageUrl,
      })
      successCount++
    } catch (err) {
      failCount++
      console.error(`[triggerCharacterImageMigration] 主角 ${index} (id=${characterId}) 触发失败:`, err)
    }
  }

  console.log(`[triggerCharacterImageMigration] 迁移任务已触发: 成功 ${successCount}, 失败 ${failCount}`)
}

/**
 * 触发分镜图迁移任务
 */
export async function triggerStoryboardImageMigration(
  projectId: string,
  projectDataId: string,
  storyboardData: StoryboardItem[]
) {
  console.log(`[triggerStoryboardImageMigration] 开始触发迁移任务`, {
    projectId,
    projectDataId,
    storyboardCount: storyboardData?.length || 0,
  })

  if (!storyboardData || !Array.isArray(storyboardData) || storyboardData.length === 0) {
    console.log(`[triggerStoryboardImageMigration] 无分镜数据，跳过`)
    return
  }

  let successCount = 0
  let failCount = 0

  // 串行执行，确保顺序正确
  for (let index = 0; index < storyboardData.length; index++) {
    const storyboard = storyboardData[index]
    const sceneId = storyboard?.sceneId || storyboard?.id || null

    // 检查是否有首尾帧需要迁移
    const firstFrameUrl = storyboard?.firstFrameUrl || storyboard?.url
    const lastFrameUrl = storyboard?.lastFrameUrl

    // 如果有首帧 URL，触发首帧迁移
    if (firstFrameUrl) {
      console.log(`[triggerStoryboardImageMigration] 触发分镜 ${index} 首帧迁移`, { 
        sceneId, 
        frameType: 'first',
        imageUrl: firstFrameUrl.substring(0, 80) + '...' 
      })

      try {
        await migrateStoryboardImage.trigger({
          projectId,
          projectDataId,
          storyboardIndex: index,
          sceneId,
          tempUrl: firstFrameUrl,
          frameType: 'first',
        })
        successCount++
      } catch (err) {
        failCount++
        console.error(`[triggerStoryboardImageMigration] 分镜 ${index} 首帧迁移触发失败:`, err)
      }
    }

    // 如果有尾帧 URL，触发尾帧迁移
    if (lastFrameUrl) {
      console.log(`[triggerStoryboardImageMigration] 触发分镜 ${index} 尾帧迁移`, { 
        sceneId, 
        frameType: 'last',
        imageUrl: lastFrameUrl.substring(0, 80) + '...' 
      })

      try {
        await migrateStoryboardImage.trigger({
          projectId,
          projectDataId,
          storyboardIndex: index,
          sceneId,
          tempUrl: lastFrameUrl,
          frameType: 'last',
        })
        successCount++
      } catch (err) {
        failCount++
        console.error(`[triggerStoryboardImageMigration] 分镜 ${index} 尾帧迁移触发失败:`, err)
      }
    }

    // 如果既没有 firstFrameUrl 也没有 lastFrameUrl，但有普通 imageUrl
    if (!firstFrameUrl && !lastFrameUrl) {
      const imageUrl = storyboard?.imageUrl
      if (imageUrl) {
        console.log(`[triggerStoryboardImageMigration] 触发分镜 ${index} 普通迁移`, { 
          sceneId, 
          imageUrl: imageUrl.substring(0, 80) + '...' 
        })

        try {
          await migrateStoryboardImage.trigger({
            projectId,
            projectDataId,
            storyboardIndex: index,
            sceneId,
            tempUrl: imageUrl,
          })
          successCount++
        } catch (err) {
          failCount++
          console.error(`[triggerStoryboardImageMigration] 分镜 ${index} 迁移触发失败:`, err)
        }
      } else {
        console.log(`[triggerStoryboardImageMigration] 分镜 ${index} (sceneId=${sceneId}) 无图片URL，跳过`)
      }
    }
  }

  console.log(`[triggerStoryboardImageMigration] 迁移任务已触发: 成功 ${successCount}, 失败 ${failCount}`)
}

/**
 * 触发剧情视频迁移任务
 */
export async function triggerSceneVideoMigration(
  projectId: string,
  projectDataId: string,
  sceneVideoData: SceneVideoItem[]
) {
  console.log(`[triggerSceneVideoMigration] 开始触发迁移任务`, {
    projectId,
    projectDataId,
    sceneVideoCount: sceneVideoData?.length || 0,
  })

  if (!sceneVideoData || !Array.isArray(sceneVideoData) || sceneVideoData.length === 0) {
    console.log(`[triggerSceneVideoMigration] 无剧情视频数据，跳过`)
    return
  }

  let successCount = 0
  let failCount = 0

  // 串行执行，确保顺序正确
  for (let index = 0; index < sceneVideoData.length; index++) {
    const scene = sceneVideoData[index]
    const videoUrl = scene?.videoUrl || scene?.url
    const sceneId = scene?.sceneId || scene?.id || null

    if (!videoUrl) {
      console.log(`[triggerSceneVideoMigration] 剧情视频 ${index} (sceneId=${sceneId}) 无视频URL，跳过`)
      continue
    }

    console.log(`[triggerSceneVideoMigration] 触发剧情视频 ${index} (sceneId=${sceneId}) 迁移`, { videoUrl: videoUrl.substring(0, 80) + '...' })

    try {
      await migrateSceneVideo.trigger({
        projectId,
        projectDataId,
        sceneIndex: index,
        sceneId: sceneId == null ? null : String(sceneId),
        tempUrl: videoUrl,
      })
      successCount++
    } catch (err) {
      failCount++
      console.error(`[triggerSceneVideoMigration] 剧情视频 ${index} (sceneId=${sceneId}) 触发失败:`, err)
    }
  }

  console.log(`[triggerSceneVideoMigration] 迁移任务已触发: 成功 ${successCount}, 失败 ${failCount}`)
}

/**
 * 触发最终视频迁移任务
 */
export async function triggerFinalVideoMigration(
  projectId: string,
  projectDataId: string,
  videoUrl?: string | null,
  thumbnailUrl?: string | null
) {
  console.log(`[triggerFinalVideoMigration] 开始触发迁移任务`, {
    projectId,
    projectDataId,
    hasVideo: !!videoUrl,
    hasThumbnail: !!thumbnailUrl,
  })

  if (!videoUrl && !thumbnailUrl) {
    console.log(`[triggerFinalVideoMigration] 无视频/缩略图数据，跳过`)
    return
  }

  console.log(`[triggerFinalVideoMigration] 触发最终视频迁移任务`, {
    videoUrl: videoUrl ? videoUrl.substring(0, 80) + '...' : null,
    thumbnailUrl: thumbnailUrl ? thumbnailUrl.substring(0, 80) + '...' : null,
  })

  try {
    const result = await migrateFinalVideo.trigger({
      projectId,
      projectDataId,
      videoUrl: videoUrl || undefined,
      thumbnailUrl: thumbnailUrl || undefined,
    })
    console.log(`[triggerFinalVideoMigration] 任务触发成功`, {
      taskId: result.id,
    })
    return result
  } catch (err) {
    console.error(`[triggerFinalVideoMigration] 任务触发失败:`, err)
    throw err
  }
}
