import { NextResponse } from 'next/server'
import { getAuthedSession, jsonError } from '@/lib/api'
import { db } from '@/lib/db'
import { videoProjects, projectData } from '@/lib/schema'
import { eq, desc, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'

// GET: 获取项目列表
export async function GET(request: Request) {
  try {
    const session = await getAuthedSession()
    
    if (!session) {
      return jsonError(401, 'Unauthorized')
473}

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const status = searchParams.get('status') || undefined
    const offset = (page - 1) * limit

    // 构建查询条件
    const conditions = [eq(videoProjects.userId, session.user.id)]
    if (status) {
      conditions.push(eq(videoProjects.status, status))
    }

    // 获取总数
    const totalResult = await db
      .select({ count: videoProjects.id })
      .from(videoProjects)
      .where(conditions[0])

    const total = totalResult.length

    // 获取项目列表 - JOIN projectData 获取搬运后的封面图
    const projectsRaw = await db
      .select({
        id: videoProjects.id,
        title: videoProjects.title,
        originalPrompt: videoProjects.originalPrompt,
        projectThumbnailUrl: videoProjects.thumbnailUrl,
        finalVideoThumbnail: projectData.finalVideoThumbnail,
        videoStyle: videoProjects.videoStyle,
        videoModel: videoProjects.videoModel,
        status: videoProjects.status,
        currentStep: videoProjects.currentStep,
        createdAt: videoProjects.createdAt,
        updatedAt: videoProjects.updatedAt,
      })
      .from(videoProjects)
      .leftJoin(
        projectData,
        sql`${projectData.projectId} = ${videoProjects.id} AND ${projectData.isActive} = true`
      )
      .where(conditions[0])
      .orderBy(sql`COALESCE(NULLIF(${videoProjects.updatedAt}, ${videoProjects.createdAt}), ${videoProjects.createdAt}) DESC`)
      .limit(limit)
      .offset(offset)

    // 处理封面图：优先使用 projectData.finalVideoThumbnail（搬运后的），其次用 videoProjects.thumbnailUrl
    const projects = projectsRaw.map(p => ({
      ...p,
      thumbnailUrl: p.finalVideoThumbnail || p.projectThumbnailUrl || null,
    }))

    return NextResponse.json({
      success: true,
      data: {
        projects,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    })
  } catch (error) {
    console.error('获取项目列表失败:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST: 创建新项目
export async function POST(request: Request) {
  try {
    const session = await getAuthedSession()
    
    if (!session) {
      return jsonError(401, 'Unauthorized')
2915}

    const body = await request.json()
    const { title, originalPrompt, aspectRatio, duration, videoStyle, videoModel, generationMode } = body

    if (!originalPrompt) {
      return NextResponse.json(
        { error: '原始提示词不能为空' },
        { status: 400 }
      )
    }

    // 生成项目ID
    const projectId = nanoid()
    const defaultTitle = title || originalPrompt.slice(0, 50) + (originalPrompt.length > 50 ? '...' : '')

    // 创建项目
    const [project] = await db
      .insert(videoProjects)
      .values({
        id: projectId,
        userId: session.user.id,
        title: defaultTitle,
        originalPrompt,
        aspectRatio: aspectRatio || '16:9',
        duration: duration || 'auto',
        videoStyle: videoStyle || null,
        videoModel: videoModel || 'auto',
        generationMode: generationMode || 'auto',
        status: 'draft',
        currentStep: null,
      })
      .returning()

    // 同时创建初始版本记录（用于后续 AI 生成时写入数据）
    await db.insert(projectData).values({
      id: nanoid(),
      projectId: projectId,
      version: 1,
      scriptTitle: null,
      scriptDescription: null,
      scriptScenes: null,
      characterData: null,
      storyboardData: null,
      sceneVideoData: null,
      finalVideoUrl: null,
      finalVideoThumbnail: null,
      finalVideoDuration: null,
      finalVideoSize: null,
      migrationStatus: 'pending',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    console.log('[POST /api/projects] 创建初始版本 projectData:', { projectId })

    return NextResponse.json({
      success: true,
      data: {
        id: project.id,
        title: project.title,
        originalPrompt: project.originalPrompt,
        videoStyle: project.videoStyle,
        status: project.status,
        currentStep: project.currentStep,
        createdAt: project.createdAt,
      },
    })
  } catch (error) {
    console.error('创建项目失败:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

