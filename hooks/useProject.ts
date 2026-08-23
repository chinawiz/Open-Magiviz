import { useState, useCallback, useEffect } from 'react'
import type { StoryScene, CharacterItem, StoryboardItem, SceneVideoItem } from '@/lib/types'

// 项目类型定义
export interface Project {
  id: string
  title: string
  originalPrompt: string
  aspectRatio: string
  duration: string
  thumbnailUrl: string | null
  videoStyle: string | null
  videoModel: string | null
  generationMode: string | null  // auto/first-last-frame
  status: 'draft' | 'completed'
  currentStep: string | null
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
}

// 项目数据类型
export interface ProjectData {
  id: string
  projectId: string
  version: number
  scriptTitle: string | null
  scriptDescription: string | null
  scriptScenes: StoryScene[] | null
  characterData: CharacterItem[] | null
  storyboardData: StoryboardItem[] | null
  sceneVideoData: SceneVideoItem[] | null
  finalVideoUrl: string | null
  finalVideoThumbnail: string | null
  finalVideoDuration: number | null
  finalVideoSize: string | null
  isActive: boolean
  createdAt: Date
}

// 版本历史
export interface Version {
  version: number
  createdAt: Date
  updatedAt?: Date | null
  finalVideoUrl?: string | null
}

// API 响应类型
interface ProjectsListResponse {
  success: boolean
  data: {
    projects: Project[]
    pagination: {
      page: number
      limit: number
      total: number
      totalPages: number
    }
  }
}

interface ProjectDetailResponse {
  success: boolean
  data: {
    project: Project
    data: ProjectData | null
    versions: Version[]
  }
}

interface SaveDataResponse {
  success: boolean
  data: {
    id: string
    version: number
    createdAt: Date
  }
}

// Hook 返回类型
interface UseProjectReturn {
  // 状态
  projects: Project[]
  loading: boolean
  error: string | null
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  } | null
  
  // 方法
  loadProjects: (page?: number, status?: string) => Promise<void>
  createProject: (prompt: string, options?: {
    title?: string
    aspectRatio?: string
    duration?: string
    videoStyle?: string
    videoModel?: string
    generationMode?: string
  }) => Promise<string | null>
  getProject: (id: string) => Promise<ProjectDetailResponse | null>
  saveProjectData: (projectId: string, data: Partial<ProjectData>) => Promise<SaveDataResponse | null>
  restoreVersion: (projectId: string, version: number) => Promise<boolean>
  deleteProject: (id: string) => Promise<boolean>
}

export function useProject(): UseProjectReturn {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pagination, setPagination] = useState<{
    page: number
    limit: number
    total: number
    totalPages: number
  } | null>(null)

  // 加载项目列表
  const loadProjects = useCallback(async (page: number = 1, status?: string) => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '9',
      })
      if (status) {
        params.append('status', status)
      }

      const response = await fetch(`/api/projects?${params}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error || data?.message || '加载项目失败')
      }

      setProjects(data.data.projects)
      setPagination(data.data.pagination)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载项目失败')
    } finally {
      setLoading(false)
    }
  }, [])

  // 创建新项目
  const createProject = useCallback(async (
    prompt: string,
    options?: {
      title?: string
      aspectRatio?: string
      duration?: string
      videoStyle?: string
      videoModel?: string
      generationMode?: string
    }
  ): Promise<string | null> => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalPrompt: prompt,
          title: options?.title,
          aspectRatio: options?.aspectRatio || '16:9',
          duration: options?.duration || 'auto',
          videoStyle: options?.videoStyle,
          videoModel: options?.videoModel || 'auto',
          generationMode: options?.generationMode || 'auto',
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '创建项目失败')
      }

      // 重新加载项目列表
      await loadProjects()
      
      return data.data.id
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建项目失败')
      return null
    } finally {
      setLoading(false)
    }
  }, [loadProjects])

  // 获取项目详情
  const getProject = useCallback(async (id: string): Promise<ProjectDetailResponse | null> => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${id}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error || data?.message || '获取项目详情失败')
      }

      return data
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取项目详情失败')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // 保存项目数据
  const saveProjectData = useCallback(async (
    projectId: string,
    data: Partial<ProjectData>
  ): Promise<SaveDataResponse | null> => {
    try {
      const response = await fetch(`/api/projects/${projectId}/data`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || '保存数据失败')
      }

      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存数据失败')
      return null
    }
  }, [])

  // 恢复到某个版本
  const restoreVersion = useCallback(async (
    projectId: string,
    version: number
  ): Promise<boolean> => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${projectId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '恢复版本失败')
      }

      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : '恢复版本失败')
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  // 删除项目
  const deleteProject = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${id}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '删除项目失败')
      }

      // 从列表中移除
      setProjects(prev => prev.filter(p => p.id !== id))
      
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除项目失败')
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    projects,
    loading,
    error,
    pagination,
    loadProjects,
    createProject,
    getProject,
    saveProjectData,
    restoreVersion,
    deleteProject,
  }
}

// 工具函数：获取进度百分比
export function getProgressPercentage(step: string | null): number {
  const steps = ['script', 'character', 'storyboard', 'scene_video', 'final_video']
  const index = step ? steps.indexOf(step) : -1
  return index >= 0 ? (index + 1) * 20 : 0
}

// 工具函数：获取步骤名称
export function getStepName(step: string | null, locale: string = 'zh'): string {
  const names: Record<string, Record<string, string>> = {
    zh: {
      script: '剧情',
      character: '主角',
      storyboard: '分镜图',
      scene_video: '剧情视频',
      final_video: '完整视频',
      notStarted: '未开始'
    },
    en: {
      script: 'Script',
      character: 'Character',
      storyboard: 'Storyboard',
      scene_video: 'Scene Video',
      final_video: 'Final Video',
      notStarted: 'Not Started'
    }
  }
  const localeNames = names[locale] || names.zh
  return step ? localeNames[step] || step : localeNames.notStarted
}

