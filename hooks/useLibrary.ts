import { useState, useCallback } from 'react'

// 主角数据类型
export interface LibraryCharacter {
  id: string
  projectId: string
  projectTitle: string
  name: string
  prompt: string
  imageUrl: string
  type: 'character'
  createdAt: string | Date
}

// 分镜图数据类型
export interface LibraryStoryboard {
  id: string
  projectId: string
  projectTitle: string
  sceneIndex: number
  prompt: string
  imageUrl: string
  type: 'storyboard'
  createdAt: string | Date
}

// 剧情视频数据类型
export interface LibraryVideo {
  id: string
  projectId: string
  projectTitle: string
  sceneIndex: number
  prompt: string
  videoUrl: string
  thumbnailUrl: string
  imageUrl: string
  type: 'video'
  duration: number
  createdAt: string | Date
}

// 统一素材项类型
export interface UnifiedLibraryItem {
  id: string
  projectId: string
  projectTitle: string
  name: string
  prompt: string
  imageUrl?: string
  videoUrl?: string
  thumbnailUrl?: string
  type: 'character' | 'storyboard' | 'video'
  createdAt: string | Date
}

// 分页类型
export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

// API 响应类型
interface LibraryResponse<T> {
  success: boolean
  error?: string
  data: {
    items: T[]
    pagination: Pagination
  }
}

// Hook 返回类型
interface UseLibraryReturn<T> {
  items: T[]
  loading: boolean
  error: string | null
  pagination: Pagination | null
  loadItems: (page?: number, search?: string) => Promise<void>
}

// 主角库 Hook
export function useCharacterLibrary(): UseLibraryReturn<LibraryCharacter> & {
  loadCharacters: (page?: number, search?: string, append?: boolean) => Promise<void>
} {
  const [items, setItems] = useState<LibraryCharacter[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pagination, setPagination] = useState<Pagination | null>(null)

  const loadCharacters = useCallback(async (page: number = 1, search: string = '', append: boolean = false) => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ page: page.toString(), limit: '20' })
      if (search) params.append('search', search)
      const response = await fetch(`/api/library/characters?${params}`)
      const data: LibraryResponse<LibraryCharacter> = await response.json()

      if (!response.ok) throw new Error(data.error || '加载主角库失败')
      setItems(prev => append ? [...prev, ...data.data.items] : data.data.items)
      setPagination(data.data.pagination)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载主角库失败')
    } finally {
      setLoading(false)
    }
  }, [])

  return { items, loading, error, pagination, loadItems: loadCharacters, loadCharacters }
}

// 分镜图库 Hook
export function useStoryboardLibrary(): UseLibraryReturn<LibraryStoryboard> & {
  loadStoryboards: (page?: number, search?: string, append?: boolean) => Promise<void>
} {
  const [items, setItems] = useState<LibraryStoryboard[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pagination, setPagination] = useState<Pagination | null>(null)

  const loadStoryboards = useCallback(async (page: number = 1, search: string = '', append: boolean = false) => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ page: page.toString(), limit: '20' })
      if (search) params.append('search', search)
      const response = await fetch(`/api/library/storyboards?${params}`)
      const data: LibraryResponse<LibraryStoryboard> = await response.json()

      if (!response.ok) throw new Error(data.error || '加载分镜图库失败')
      setItems(prev => append ? [...prev, ...data.data.items] : data.data.items)
      setPagination(data.data.pagination)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载分镜图库失败')
    } finally {
      setLoading(false)
    }
  }, [])

  return { items, loading, error, pagination, loadItems: loadStoryboards, loadStoryboards }
}

// 剧情视频库 Hook
export function useVideoLibrary(): UseLibraryReturn<LibraryVideo> & {
  loadVideos: (page?: number, search?: string, append?: boolean) => Promise<void>
} {
  const [items, setItems] = useState<LibraryVideo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pagination, setPagination] = useState<Pagination | null>(null)

  const loadVideos = useCallback(async (page: number = 1, search: string = '', append: boolean = false) => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ page: page.toString(), limit: '20' })
      if (search) params.append('search', search)
      const response = await fetch(`/api/library/videos?${params}`)
      const data: LibraryResponse<LibraryVideo> = await response.json()

      if (!response.ok) throw new Error(data.error || '加载剧情视频库失败')
      setItems(prev => append ? [...prev, ...data.data.items] : data.data.items)
      setPagination(data.data.pagination)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载剧情视频库失败')
    } finally {
      setLoading(false)
    }
  }, [])

  return { items, loading, error, pagination, loadItems: loadVideos, loadVideos }
}

// 统一素材库 Hook
export function useUnifiedLibrary(): UseLibraryReturn<UnifiedLibraryItem> & {
  loadAll: (page?: number, search?: string, append?: boolean) => Promise<void>
} {
  const [items, setItems] = useState<UnifiedLibraryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pagination, setPagination] = useState<Pagination | null>(null)

  const loadAll = useCallback(async (page: number = 1, search: string = '', append: boolean = false) => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ page: page.toString(), limit: '30' })
      if (search) params.append('search', search)
      const response = await fetch(`/api/library/all?${params}`)
      const data: LibraryResponse<UnifiedLibraryItem> = await response.json()

      if (!response.ok) throw new Error(data.error || '加载全部素材失败')
      setItems(prev => append ? [...prev, ...data.data.items] : data.data.items)
      setPagination(data.data.pagination)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载全部素材失败')
    } finally {
      setLoading(false)
    }
  }, [])

  return { items, loading, error, pagination, loadItems: loadAll, loadAll }
}
