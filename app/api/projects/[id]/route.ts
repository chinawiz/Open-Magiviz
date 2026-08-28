import { NextResponse } from 'next/server'
import { getAuthedSession, jsonError } from '@/lib/api'
import { db } from '@/lib/db'
import { videoProjects, projectData } from '@/lib/schema'
import { eq, desc } from 'drizzle-orm'
import type { NewVideoProject } from '@/lib/types'

// GET: 获取项目详情
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getAuthedSession()
    
    if (!session) {
      return jsonError(401, 'Unauthorized')
}

    // 获取项目信息
    const [project] = await db
      .select({
        id: videoProjects.id,
        userId: videoProjects.userId,
        title: videoProjects.title,
        originalPrompt: videoProjects.originalPrompt,
        aspectRatio: videoProjects.aspectRatio,
        duration: videoProjects.duration,
        videoStyle: videoProjects.videoStyle,
        videoModel: videoProjects.videoModel,
        generationMode: videoProjects.generationMode,
        thumbnailUrl: videoProjects.thumbnailUrl,
        status: videoProjects.status,
        currentStep: videoProjects.currentStep,
        createdAt: videoProjects.createdAt,
        updatedAt: videoProjects.updatedAt,
        completedAt: videoProjects.completedAt,
      })
      .from(videoProjects)
      .where(eq(videoProjects.id, id))

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    // 验证所有权
    if (project.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // 获取最新的项目数据
    const [latestData] = await db
      .select()
      .from(projectData)
      .where(eq(projectData.projectId, id))
      .orderBy(desc(projectData.version))
      .limit(1)

    // 获取所有版本历史
    const versions = await db
      .select({
        version: projectData.version,
        createdAt: projectData.createdAt,
        updatedAt: projectData.updatedAt,
        finalVideoUrl: projectData.finalVideoUrl,
      })
      .from(projectData)
      .where(eq(projectData.projectId, id))
      .orderBy(desc(projectData.version))

    return NextResponse.json({
      success: true,
      data: {
        project: {
          ...project,
          userId: undefined, // 隐藏 userId
        },
        data: latestData || null,
        versions,
      },
    })
  } catch (error) {
    console.error('获取项目详情失败:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// PUT: 更新项目
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getAuthedSession()
    
    if (!session) {
      return jsonError(401, 'Unauthorized')
}

    // 验证项目存在和所有权
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
    const { title, status, currentStep, thumbnailUrl, videoModel, videoStyle, generationMode } = body

    const updateData: Partial<NewVideoProject> = {
      updatedAt: new Date(),
    }

    if (title !== undefined) updateData.title = title
    if (status !== undefined) updateData.status = status
    if (currentStep !== undefined) updateData.currentStep = currentStep
    if (thumbnailUrl !== undefined) updateData.thumbnailUrl = thumbnailUrl
    if (videoModel !== undefined) updateData.videoModel = videoModel
    if (videoStyle !== undefined) updateData.videoStyle = videoStyle
    if (generationMode !== undefined) updateData.generationMode = generationMode

    // 如果设置为完成，记录完成时间
    if (status === 'completed') {
      updateData.completedAt = new Date()
    }

    // 记录修改时间
    updateData.updatedAt = new Date()

    const [updatedProject] = await db
      .update(videoProjects)
      .set(updateData)
      .where(eq(videoProjects.id, id))
      .returning()

    return NextResponse.json({
      success: true,
      data: {
        id: updatedProject.id,
        title: updatedProject.title,
        status: updatedProject.status,
        currentStep: updatedProject.currentStep,
        updatedAt: updatedProject.updatedAt,
      },
    })
  } catch (error) {
    console.error('更新项目失败:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE: 删除项目
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getAuthedSession()
    
    if (!session) {
      return jsonError(401, 'Unauthorized')
}

    // 验证项目存在和所有权
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

    // 删除项目（级联删除 project_data）
    await db
      .delete(videoProjects)
      .where(eq(videoProjects.id, id))

    return NextResponse.json({
      success: true,
      message: '项目已删除',
    })
  } catch (error) {
    console.error('删除项目失败:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

