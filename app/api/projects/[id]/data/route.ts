import { NextResponse } from 'next/server'
import { getAuthedSession, jsonError } from '@/lib/api'
import { db } from '@/lib/db'
import { videoProjects, projectData } from '@/lib/schema'
import { eq, desc, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { NewVideoProject } from '@/lib/types'
import {
  triggerCharacterImageMigration,
  triggerStoryboardImageMigration,
  triggerSceneVideoMigration,
  triggerFinalVideoMigration,
} from '@/trigger/migrate-assets'

// GET: 获取项目数据
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getAuthedSession()

    if (!session) {
      return jsonError(401, 'Unauthorized')
728}

    const [existingProject] = await db
      .select({ userId: videoProjects.userId })
      .from(videoProjects)
      .where(eq(videoProjects.id, id))

    if (!existingProject) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    if (existingProject.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const version = searchParams.get('version')

    if (version) {
      const [result] = await db
        .select()
        .from(projectData)
        .where(sql`${projectData.projectId} = ${id} AND ${projectData.version} = ${version}::integer`)
        .limit(1)
      return NextResponse.json({ success: true, data: result || null })
    } else {
      const [result] = await db
        .select()
        .from(projectData)
        .where(eq(projectData.projectId, id))
        .orderBy(desc(projectData.version))
        .limit(1)
      return NextResponse.json({ success: true, data: result || null })
    }
  } catch (error) {
    console.error('获取项目数据失败:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT: 保存项目数据
// 版本规则：
//   - isNewVersion=true → 创建新版本（旧版本 isActive=false）
//   - 无 latestData（新项目）→ 创建 version 1
//   - 其余 → 更新当前版本（正常生成流程继续）
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const session = await getAuthedSession()
    if (!session) {
      return jsonError(401, 'Unauthorized')
2371}

    const [existingProject] = await db
      .select({ userId: videoProjects.userId })
      .from(videoProjects)
      .where(eq(videoProjects.id, id))

    if (!existingProject) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    if (existingProject.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()

    const {
      scriptTitle,
      scriptDescription,
      scriptScenes,
      characterData,
      storyboardData,
      sceneVideoData,
      finalVideoUrl,
      finalVideoThumbnail,
      finalVideoDuration,
      finalVideoSize,
      isNewVersion,
      _step,
    } = body

    // 获取当前最新版本
    const [latestData] = await db
      .select()
      .from(projectData)
      .where(eq(projectData.projectId, id))
      .orderBy(desc(projectData.version))
      .limit(1)

    // 辅助函数：深拷贝 JSON 字段
    const safeJsonCopy = (value: any): any => {
      if (value === null || value === undefined) return null
      if (typeof value === 'string') {
        try { return JSON.parse(value) } catch { return null }
      }
      return JSON.parse(JSON.stringify(value))
    }

    // 判断是否创建新版本：显式要求新版本 或 无现有版本
    const shouldCreateNewVersion = !latestData || isNewVersion === true

    if (shouldCreateNewVersion) {
      // 创建新版本
      const newVersionNumber = latestData ? latestData.version + 1 : 1
      console.log('[PUT /api/projects/[id]/data] 创建新版本', {
        previousVersion: latestData?.version,
        newVersion: newVersionNumber,
        _step,
        reason: !latestData ? 'new_project' : 'isNewVersion',
      })

      const [insertedData] = await db
        .insert(projectData)
        .values({
          id: nanoid(),
          projectId: id,
          version: newVersionNumber,
          scriptTitle: scriptTitle !== undefined ? scriptTitle : (latestData?.scriptTitle || null),
          scriptDescription: scriptDescription !== undefined ? scriptDescription : (latestData?.scriptDescription || null),
          scriptScenes: scriptScenes !== undefined ? safeJsonCopy(scriptScenes) : safeJsonCopy(latestData?.scriptScenes),
          characterData: characterData !== undefined ? safeJsonCopy(characterData) : safeJsonCopy(latestData?.characterData),
          storyboardData: storyboardData !== undefined ? safeJsonCopy(storyboardData) : safeJsonCopy(latestData?.storyboardData),
          sceneVideoData: sceneVideoData !== undefined ? safeJsonCopy(sceneVideoData) : safeJsonCopy(latestData?.sceneVideoData),
          finalVideoUrl: finalVideoUrl !== undefined ? finalVideoUrl : (latestData?.finalVideoUrl || null),
          finalVideoThumbnail: finalVideoThumbnail !== undefined ? finalVideoThumbnail : (latestData?.finalVideoThumbnail || null),
          finalVideoDuration: finalVideoDuration !== undefined ? finalVideoDuration : (latestData?.finalVideoDuration || null),
          finalVideoSize: finalVideoSize !== undefined ? finalVideoSize : (latestData?.finalVideoSize || null),
          migrationStatus: 'pending',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning()

      if (latestData) {
        await db
          .update(projectData)
          .set({ isActive: false })
          .where(sql`${projectData.projectId} = ${id} AND ${projectData.id} != ${insertedData.id}`)
      }

      triggerMigrations(id, insertedData.id, _step, characterData, storyboardData, sceneVideoData, finalVideoUrl, finalVideoThumbnail)
      await updateProjectStep(id, finalVideoUrl, sceneVideoData, storyboardData, characterData, scriptTitle)

      return NextResponse.json({
        success: true,
        data: { id: insertedData.id, version: insertedData.version, createdAt: insertedData.createdAt },
      })
    }

    // 更新当前版本（正常生成流程继续）
    console.log('[PUT /api/projects/[id]/data] 更新当前版本', {
      version: latestData.version,
      _step,
    })

    const [updatedData] = await db
      .update(projectData)
      .set({
        scriptTitle: scriptTitle !== undefined ? scriptTitle : latestData.scriptTitle,
        scriptDescription: scriptDescription !== undefined ? scriptDescription : latestData.scriptDescription,
        scriptScenes: scriptScenes !== undefined ? safeJsonCopy(scriptScenes) : latestData.scriptScenes,
        characterData: characterData !== undefined ? safeJsonCopy(characterData) : latestData.characterData,
        storyboardData: storyboardData !== undefined ? safeJsonCopy(storyboardData) : latestData.storyboardData,
        sceneVideoData: sceneVideoData !== undefined ? safeJsonCopy(sceneVideoData) : latestData.sceneVideoData,
        finalVideoUrl: finalVideoUrl !== undefined ? finalVideoUrl : latestData.finalVideoUrl,
        finalVideoThumbnail: finalVideoThumbnail !== undefined ? finalVideoThumbnail : latestData.finalVideoThumbnail,
        finalVideoDuration: finalVideoDuration !== undefined ? finalVideoDuration : latestData.finalVideoDuration,
        finalVideoSize: finalVideoSize !== undefined ? finalVideoSize : latestData.finalVideoSize,
        updatedAt: new Date(),
      })
      .where(eq(projectData.id, latestData.id))
      .returning()

    triggerMigrations(id, updatedData.id, _step, characterData, storyboardData, sceneVideoData, finalVideoUrl, finalVideoThumbnail)
    await updateProjectStep(id, finalVideoUrl ?? updatedData.finalVideoUrl, sceneVideoData ?? updatedData.sceneVideoData, storyboardData ?? updatedData.storyboardData, characterData ?? updatedData.characterData, scriptTitle ?? updatedData.scriptTitle)

    return NextResponse.json({
      success: true,
      data: { id: updatedData.id, version: updatedData.version, createdAt: updatedData.createdAt },
    })
  } catch (error) {
    console.error('[PUT /api/projects/[id]/data] 保存失败:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

// 异步触发迁移任务
function triggerMigrations(
  projectId: string,
  projectDataId: string,
  _step: string | undefined,
  characterData: any,
  storyboardData: any,
  sceneVideoData: any,
  finalVideoUrl: any,
  finalVideoThumbnail: any
) {
  ;(async () => {
    try {
      if (_step === 'character' && Array.isArray(characterData) && characterData.length > 0) {
        triggerCharacterImageMigration(projectId, projectDataId, characterData).catch((err) => console.error('[migrate] 主角图片迁移失败:', err))
      }
      if (_step === 'storyboard' && Array.isArray(storyboardData) && storyboardData.length > 0) {
        triggerStoryboardImageMigration(projectId, projectDataId, storyboardData).catch((err) => console.error('[migrate] 分镜图迁移失败:', err))
      }
      if (_step === 'scene_video' && Array.isArray(sceneVideoData) && sceneVideoData.length > 0) {
        triggerSceneVideoMigration(projectId, projectDataId, sceneVideoData).catch((err) => console.error('[migrate] 剧情视频迁移失败:', err))
      }
      if (_step === 'final_video' && (finalVideoUrl || finalVideoThumbnail)) {
        triggerFinalVideoMigration(projectId, projectDataId, finalVideoUrl, finalVideoThumbnail).catch((err) => console.error('[migrate] 最终视频迁移失败:', err))
      }
    } catch (err) {
      console.error('[PUT] 迁移任务触发异常:', err)
    }
  })()
}

// 更新 videoProjects 的 currentStep 和状态
async function updateProjectStep(
  projectId: string,
  finalVideoUrl: any,
  sceneVideoData: any,
  storyboardData: any,
  characterData: any,
  scriptTitle: any
) {
  const updateData: Partial<NewVideoProject> = { updatedAt: new Date() }

  if (finalVideoUrl) {
    updateData.status = 'completed'
    updateData.currentStep = 'final_video'
    updateData.completedAt = new Date()
  } else if (sceneVideoData && Array.isArray(sceneVideoData) && sceneVideoData.length > 0) {
    updateData.currentStep = 'scene_video'
  } else if (storyboardData && Array.isArray(storyboardData) && storyboardData.length > 0) {
    updateData.currentStep = 'storyboard'
  } else if (characterData && Array.isArray(characterData) && characterData.length > 0) {
    updateData.currentStep = 'character'
  } else if (scriptTitle) {
    updateData.currentStep = 'script'
  }

    // 记录修改时间
    updateData.updatedAt = new Date()

  await db.update(videoProjects).set(updateData).where(eq(videoProjects.id, projectId))
  console.log('[PUT /api/projects/[id]/data] 项目步骤更新完成', updateData)
}
