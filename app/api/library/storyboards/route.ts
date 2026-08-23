import { NextResponse } from 'next/server'
import { getAuthedSession, jsonError } from '@/lib/api'
import { db } from '@/lib/db'
import { videoProjects, projectData } from '@/lib/schema'
import { eq, desc, sql } from 'drizzle-orm'
import type { LibraryMaterialItem } from '@/lib/types'

// GET: 获取用户所有分镜图库
export async function GET(request: Request) {
  try {
    const session = await getAuthedSession()

    if (!session) {
      return jsonError(401, 'Unauthorized')
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '9')
    const search = searchParams.get('search') || ''
    const offset = (page - 1) * limit

    // 获取用户的所有项目中的分镜图数据
    const rawData = await db
      .select({
        projectId: videoProjects.id,
        projectTitle: videoProjects.title,
        storyboardData: projectData.storyboardData,
        createdAt: projectData.createdAt,
      })
      .from(videoProjects)
      .leftJoin(
        projectData,
        sql`${projectData.projectId} = ${videoProjects.id} AND ${projectData.isActive} = true`
      )
      .where(eq(videoProjects.userId, session.user.id))

    // 提取并整理分镜图数据
    const allStoryboards: LibraryMaterialItem[] = []

    for (const row of rawData) {
      if (row.storyboardData && Array.isArray(row.storyboardData)) {
        for (let i = 0; i < row.storyboardData.length; i++) {
          const board = row.storyboardData[i]
          if (board.imageUrl || board.prompt) {
            // 如果有搜索词，进行匹配
            if (search) {
              const searchLower = search.toLowerCase()
              const promptMatch = board.prompt?.toLowerCase().includes(searchLower)
              const projectMatch = row.projectTitle?.toLowerCase().includes(searchLower)
              if (!promptMatch && !projectMatch) {
                continue
              }
            }

            // 生成显示名称
            const displayName = board.prompt 
              ? board.prompt.slice(0, 30) + (board.prompt.length > 30 ? '...' : '')
              : `分镜图 ${(board.sceneIndex ?? i) + 1}`

            allStoryboards.push({
              id: board.id || board.storyboardId,
              projectId: row.projectId,
              projectTitle: row.projectTitle,
              name: displayName,
              sceneIndex: board.sceneIndex ?? i,
              prompt: board.prompt || '',
              imageUrl: board.imageUrl || board.image || '',
              createdAt: row.createdAt,
            })
          }
        }
      }
    }

    // 按时间倒序排序
    allStoryboards.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())

    // 分页
    const total = allStoryboards.length
    const paginatedStoryboards = allStoryboards.slice(offset, offset + limit)

    return NextResponse.json({
      success: true,
      data: {
        items: paginatedStoryboards,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    })
  } catch (error) {
    console.error('获取分镜图库失败:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
