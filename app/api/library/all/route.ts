import { NextResponse } from 'next/server'
import { getAuthedSession, jsonError } from '@/lib/api'
import { db } from '@/lib/db'
import { videoProjects, projectData, userAssets } from '@/lib/schema'
import { eq, sql, desc } from 'drizzle-orm'
import type { LibraryMaterialItem } from '@/lib/types'

// GET: 获取用户所有素材（主角、分镜图、剧情视频）
export async function GET(request: Request) {
  try {
    const session = await getAuthedSession()

    if (!session) {
      return jsonError(401, 'Unauthorized')
464}

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '30')
    const search = searchParams.get('search') || ''
    const type = searchParams.get('type') || 'all' // all, characters, storyboards, videos
    const offset = (page - 1) * limit

    // 获取用户的所有项目数据
    const rawData = await db
      .select({
        projectId: videoProjects.id,
        projectTitle: videoProjects.title,
        characterData: projectData.characterData,
        storyboardData: projectData.storyboardData,
        sceneVideoData: projectData.sceneVideoData,
        createdAt: projectData.createdAt,
      })
      .from(videoProjects)
      .leftJoin(
        projectData,
        sql`${projectData.projectId} = ${videoProjects.id} AND ${projectData.isActive} = true`
      )
      .where(eq(videoProjects.userId, session.user.id))

    // 收集所有素材
    const allItems: LibraryMaterialItem[] = []

    for (const row of rawData) {
      // 提取主角
      if (type === 'all' || type === 'characters') {
        if (row.characterData && Array.isArray(row.characterData)) {
          for (const char of row.characterData) {
            if (char.imageUrl || char.prompt) {
              // 搜索匹配
              if (search) {
                const searchLower = search.toLowerCase()
                const nameMatch = char.name?.toLowerCase().includes(searchLower)
                const promptMatch = char.prompt?.toLowerCase().includes(searchLower)
                const projectMatch = row.projectTitle?.toLowerCase().includes(searchLower)
                if (!nameMatch && !promptMatch && !projectMatch) {
                  continue
                }
              }

              allItems.push({
                id: char.id || char.characterId,
                projectId: row.projectId,
                projectTitle: row.projectTitle,
                name: char.name || '未命名主角',
                prompt: char.prompt || '',
                imageUrl: char.imageUrl || char.image || '',
                type: 'character',
                createdAt: row.createdAt,
              })
            }
          }
        }
      }

      // 提取分镜图
      if (type === 'all' || type === 'storyboards') {
        if (row.storyboardData && Array.isArray(row.storyboardData)) {
          for (let i = 0; i < row.storyboardData.length; i++) {
            const board = row.storyboardData[i]
            if (board.imageUrl || board.prompt) {
              // 搜索匹配
              if (search) {
                const searchLower = search.toLowerCase()
                const promptMatch = board.prompt?.toLowerCase().includes(searchLower)
                const projectMatch = row.projectTitle?.toLowerCase().includes(searchLower)
                if (!promptMatch && !projectMatch) {
                  continue
                }
              }

              const displayName = board.prompt
                ? board.prompt.slice(0, 30) + (board.prompt.length > 30 ? '...' : '')
                : `分镜图 ${(board.sceneIndex ?? i) + 1}`

              allItems.push({
                id: board.id || board.storyboardId,
                projectId: row.projectId,
                projectTitle: row.projectTitle,
                name: displayName,
                prompt: board.prompt || '',
                imageUrl: board.imageUrl || board.image || '',
                type: 'storyboard',
                createdAt: row.createdAt,
              })
            }
          }
        }
      }

      // 提取剧情视频
      if (type === 'all' || type === 'videos') {
        if (row.sceneVideoData && Array.isArray(row.sceneVideoData)) {
          for (let i = 0; i < row.sceneVideoData.length; i++) {
            const video = row.sceneVideoData[i]
            if (video.videoUrl || video.url) {
              // 搜索匹配
              if (search) {
                const searchLower = search.toLowerCase()
                const promptMatch = video.prompt?.toLowerCase().includes(searchLower)
                const projectMatch = row.projectTitle?.toLowerCase().includes(searchLower)
                if (!promptMatch && !projectMatch) {
                  continue
                }
              }

              const displayName = video.prompt
                ? video.prompt.slice(0, 30) + (video.prompt.length > 30 ? '...' : '')
                : `剧情视频 ${(video.sceneIndex ?? i) + 1}`

              allItems.push({
                id: video.id || video.videoId,
                projectId: row.projectId,
                projectTitle: row.projectTitle,
                name: displayName,
                prompt: video.prompt || '',
                videoUrl: video.videoUrl || video.url || '',
                thumbnailUrl: video.thumbnailUrl || video.thumbnail || '',
                imageUrl: video.thumbnailUrl || video.thumbnail || '',
                type: 'video',
                createdAt: row.createdAt,
              })
            }
          }
        }
      }
    }

    // 获取用户上传的素材
    const userAssetsData = await db
      .select({
        id: userAssets.id,
        name: userAssets.name,
        type: userAssets.type,
        url: userAssets.url,
        thumbnailUrl: userAssets.thumbnailUrl,
        createdAt: userAssets.createdAt,
        tags: userAssets.tags,
      })
      .from(userAssets)
      .where(eq(userAssets.userId, session.user.id))
      .orderBy(desc(userAssets.createdAt))

    // 将用户上传素材转换为统一格式
    for (const asset of userAssetsData) {
      // 搜索匹配
      if (search) {
        const searchLower = search.toLowerCase()
        const nameMatch = asset.name?.toLowerCase().includes(searchLower)
        const tagsMatch = asset.tags?.some((tag: string) => tag.toLowerCase().includes(searchLower))
        if (!nameMatch && !tagsMatch) {
          continue
        }
      }

      allItems.push({
        id: asset.id,
        projectId: null,
        projectTitle: '我的上传',
        name: asset.name || '未命名素材',
        prompt: '',
        imageUrl: asset.type === 'image' ? asset.url : asset.thumbnailUrl || '',
        videoUrl: asset.type === 'video' ? asset.url : '',
        type: asset.type === 'video' ? 'video' : asset.type,
        createdAt: asset.createdAt,
        isUserAsset: true,
      })
    }

    // 按时间倒序排序
    allItems.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())

    // 分页
    const total = allItems.length
    const paginatedItems = allItems.slice(offset, offset + limit)

    return NextResponse.json({
      success: true,
      data: {
        items: paginatedItems,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    })
  } catch (error) {
    console.error('获取全部素材失败:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
