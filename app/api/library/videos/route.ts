import { NextResponse } from 'next/server'
import { getAuthedSession, jsonError } from '@/lib/api'
import { db } from '@/lib/db'
import { videoProjects, projectData } from '@/lib/schema'
import { eq, desc, sql } from 'drizzle-orm'
import type { LibraryMaterialItem } from '@/lib/types'

// GET: 获取用户所有剧情视频库
export async function GET(request: Request) {
  try {
    const session = await getAuthedSession()

    if (!session) {
      return jsonError(401, 'Unauthorized')
442}

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '9')
    const search = searchParams.get('search') || ''
    const offset = (page - 1) * limit

    // 获取用户的所有项目中的剧情视频数据
    const rawData = await db
      .select({
        projectId: videoProjects.id,
        projectTitle: videoProjects.title,
        sceneVideoData: projectData.sceneVideoData,
        createdAt: projectData.createdAt,
      })
      .from(videoProjects)
      .leftJoin(
        projectData,
        sql`${projectData.projectId} = ${videoProjects.id} AND ${projectData.isActive} = true`
      )
      .where(eq(videoProjects.userId, session.user.id))

    // 提取并整理剧情视频数据
    const allVideos: LibraryMaterialItem[] = []

    for (const row of rawData) {
      if (row.sceneVideoData && Array.isArray(row.sceneVideoData)) {
        for (let i = 0; i < row.sceneVideoData.length; i++) {
          const video = row.sceneVideoData[i]
          if (video.videoUrl || video.url) {
            // 如果有搜索词，进行匹配
            if (search) {
              const searchLower = search.toLowerCase()
              const promptMatch = video.prompt?.toLowerCase().includes(searchLower)
              const projectMatch = row.projectTitle?.toLowerCase().includes(searchLower)
              if (!promptMatch && !projectMatch) {
                continue
              }
            }

            // 生成显示名称
            const displayName = video.prompt 
              ? video.prompt.slice(0, 30) + (video.prompt.length > 30 ? '...' : '')
              : `剧情视频 ${(video.sceneIndex ?? i) + 1}`

            allVideos.push({
              id: video.id || video.videoId,
              projectId: row.projectId,
              projectTitle: row.projectTitle,
              name: displayName,
              sceneIndex: video.sceneIndex ?? i,
              prompt: video.prompt || '',
              videoUrl: video.videoUrl || video.url || '',
              thumbnailUrl: video.thumbnailUrl || video.thumbnail || '',
              duration: video.duration || 0,
              createdAt: row.createdAt,
            })
          }
        }
      }
    }

    // 按时间倒序排序
    allVideos.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())

    // 分页
    const total = allVideos.length
    const paginatedVideos = allVideos.slice(offset, offset + limit)

    return NextResponse.json({
      success: true,
      data: {
        items: paginatedVideos,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    })
  } catch (error) {
    console.error('获取剧情视频库失败:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
