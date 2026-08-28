import { NextResponse } from 'next/server'
import { getAuthedSession, jsonError } from '@/lib/api'
import { db } from '@/lib/db'
import { videoProjects, projectData } from '@/lib/schema'
import { eq, desc, sql } from 'drizzle-orm'
import type { LibraryMaterialItem } from '@/lib/types'

// GET: 获取用户所有主角库
export async function GET(request: Request) {
  try {
    const session = await getAuthedSession()

    if (!session) {
      return jsonError(401, 'Unauthorized')
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const search = searchParams.get('search') || ''
    const offset = (page - 1) * limit

    // 获取用户的所有项目中的主角数据
    const rawData = await db
      .select({
        projectId: videoProjects.id,
        projectTitle: videoProjects.title,
        characterData: projectData.characterData,
        createdAt: projectData.createdAt,
      })
      .from(videoProjects)
      .leftJoin(
        projectData,
        sql`${projectData.projectId} = ${videoProjects.id} AND ${projectData.isActive} = true`
      )
      .where(eq(videoProjects.userId, session.user.id))

    // 提取并整理主角数据
    const allCharacters: LibraryMaterialItem[] = []

    for (const row of rawData) {
      if (row.characterData && Array.isArray(row.characterData)) {
        for (const char of row.characterData) {
          if (char.imageUrl || char.prompt) {
            // 如果有搜索词，进行匹配
            if (search) {
              const searchLower = search.toLowerCase()
              const nameMatch = char.name?.toLowerCase().includes(searchLower)
              const promptMatch = char.prompt?.toLowerCase().includes(searchLower)
              const projectMatch = row.projectTitle?.toLowerCase().includes(searchLower)
              if (!nameMatch && !promptMatch && !projectMatch) {
                continue
              }
            }

            allCharacters.push({
              id: char.id || char.characterId,
              projectId: row.projectId,
              projectTitle: row.projectTitle,
              name: char.name || '未命名主角',
              prompt: char.prompt || '',
              imageUrl: char.imageUrl || char.image || '',
              createdAt: row.createdAt,
            })
          }
        }
      }
    }

    // 按时间倒序排序
    allCharacters.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())

    // 分页
    const total = allCharacters.length
    const paginatedCharacters = allCharacters.slice(offset, offset + limit)

    return NextResponse.json({
      success: true,
      data: {
        items: paginatedCharacters,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    })
  } catch (error) {
    console.error('获取主角库失败:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
