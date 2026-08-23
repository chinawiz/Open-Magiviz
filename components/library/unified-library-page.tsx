"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import Masonry from "react-masonry-css"
import { useSession } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Search,
  Grid3X3,
  List,
  Eye,
  ExternalLink,
  Play,
  Image as ImageIcon,
  User,
  Film,
  LayoutGrid,
  Upload,
  Music,
  File,
  Trash2,
  Loader2,
} from "lucide-react"
import { useCharacterLibrary, useStoryboardLibrary, useVideoLibrary, useUnifiedLibrary } from "@/hooks/useLibrary"
import { useUserAssets, type UserAsset } from "@/hooks/useUserAssets"
import type { LibraryMaterialItem } from "@/lib/types"
import { UploadAssetDialog } from "@/components/library/upload-asset-dialog"

// 标签页类型
export type UnifiedLibraryTab = 'all' | 'characters' | 'storyboards' | 'videos' | 'my-uploads'

// 标签页配置
const tabs: { key: UnifiedLibraryTab; icon: typeof LayoutGrid; labelKey: string }[] = [
  { key: 'all', icon: LayoutGrid, labelKey: 'all' },
  { key: 'characters', icon: User, labelKey: 'characters' },
  { key: 'storyboards', icon: ImageIcon, labelKey: 'storyboards' },
  { key: 'videos', icon: Film, labelKey: 'videos' },
  { key: 'my-uploads', icon: Upload, labelKey: 'myUploads' },
]

// 图标映射
const typeIcons = {
  all: LayoutGrid,
  characters: User,
  storyboards: ImageIcon,
  videos: Film,
  'my-uploads': Upload,
}

// Masonry 瀑布流断点配置 - 响应式列数
const breakpointColumnsObj = {
  default: 4,
  1280: 3,
  1024: 3,
  768: 2,
  500: 1
}

// 统一素材库组件
export function UnifiedLibraryPage() {
  const { status } = useSession()
  const router = useRouter()
  const locale = useLocale()
  const searchParams = useSearchParams()
  const t = useTranslations("library")

  // 从 URL 获取 tab 参数，默认 'all'
  const getInitialTab = (): UnifiedLibraryTab => {
    const tabParam = searchParams.get('tab') as UnifiedLibraryTab
    if (tabParam && ['all', 'characters', 'storyboards', 'videos', 'my-uploads'].includes(tabParam)) {
      return tabParam
    }
    return 'all'
  }

  const [activeTab, setActiveTab] = useState<UnifiedLibraryTab>(getInitialTab)
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [previewItem, setPreviewItem] = useState<any>(null)
  const [previewType, setPreviewType] = useState<'image' | 'video'>('image')
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [deleteAssetId, setDeleteAssetId] = useState<string | null>(null)
  const [assetTypeFilter, setAssetTypeFilter] = useState<string>('all')

  // 无限滚动相关状态
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isLoadingMoreUploads, setIsLoadingMoreUploads] = useState(false)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const loadMoreUploadsRef = useRef<HTMLDivElement>(null)

  // 根据类型选择对应的 hook
  const characterLibrary = useCharacterLibrary()
  const storyboardLibrary = useStoryboardLibrary()
  const videoLibrary = useVideoLibrary()
  const unifiedLibrary = useUnifiedLibrary()
  const userAssets = useUserAssets()

  // 获取对应的数据 - 使用 useMemo 确保引用稳定
  const libData = useMemo(() => {
    return activeTab === 'all' ? unifiedLibrary
      : activeTab === 'characters' ? characterLibrary
      : activeTab === 'storyboards' ? storyboardLibrary
      : activeTab === 'videos' ? videoLibrary
      : null
  }, [activeTab, unifiedLibrary, characterLibrary, storyboardLibrary, videoLibrary])

  const { items, loading, error, pagination } = libData || { items: [], loading: false, error: null, pagination: null }

  // 获取加载函数 - 使用 useMemo 确保引用稳定
  const loadData = useMemo(() => {
    return activeTab === 'all' ? unifiedLibrary.loadAll
      : activeTab === 'characters' ? characterLibrary.loadCharacters
      : activeTab === 'storyboards' ? storyboardLibrary.loadStoryboards
      : activeTab === 'videos' ? videoLibrary.loadVideos
      : null
  }, [activeTab, unifiedLibrary, characterLibrary, storyboardLibrary, videoLibrary])

  // 图标
  const IconComponent = typeIcons[activeTab] || User

  // 切换标签并更新 URL
  const handleTabChange = (tab: UnifiedLibraryTab) => {
    setActiveTab(tab)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', tab)
    router.replace(url.pathname + url.search, { scroll: false })
  }

  // 加载数据 - 只有登录后才加载
  useEffect(() => {
    if (status !== 'authenticated') return

    const timer = setTimeout(() => {
      if (activeTab === 'my-uploads') {
        userAssets.loadAssets(1, assetTypeFilter, debouncedSearch)
      } else if (loadData) {
        loadData(1, debouncedSearch)
      }
    }, 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, debouncedSearch, assetTypeFilter, status, loadData])

  // 防抖搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // 加载更多数据
  const loadMore = useCallback(async () => {
    if (isLoadingMore || !pagination || !loadData) return
    if (pagination.page >= pagination.totalPages) return

    setIsLoadingMore(true)
    try {
      await loadData(pagination.page + 1, debouncedSearch, true)
    } finally {
      setIsLoadingMore(false)
    }
  }, [isLoadingMore, pagination, loadData, debouncedSearch])

  // 加载更多上传素材
  const loadMoreUploads = useCallback(async () => {
    if (isLoadingMoreUploads || !userAssets.pagination) return
    if (userAssets.pagination.page >= userAssets.pagination.totalPages) return

    setIsLoadingMoreUploads(true)
    try {
      await userAssets.loadAssets(userAssets.pagination.page + 1, assetTypeFilter, debouncedSearch, true)
    } finally {
      setIsLoadingMoreUploads(false)
    }
  }, [isLoadingMoreUploads, userAssets.pagination, assetTypeFilter, debouncedSearch])

  // 无限滚动 - 使用 IntersectionObserver
  useEffect(() => {
    if (!loadMoreRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMore && pagination && pagination.page < pagination.totalPages) {
          loadMore()
        }
      },
      { threshold: 0.1 }
    )

    observer.observe(loadMoreRef.current)

    return () => {
      observer.disconnect()
    }
  }, [loadMore, isLoadingMore, pagination])

  // 无限滚动 - 我的上传 - 使用 IntersectionObserver
  useEffect(() => {
    if (!loadMoreUploadsRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMoreUploads && userAssets.pagination && userAssets.pagination.page < userAssets.pagination.totalPages) {
          loadMoreUploads()
        }
      },
      { threshold: 0.1 }
    )

    observer.observe(loadMoreUploadsRef.current)

    return () => {
      observer.disconnect()
    }
  }, [loadMoreUploads, isLoadingMoreUploads, userAssets.pagination])

  // 跳转到项目
  const goToProject = (projectId: string) => {
    router.push(`/${locale}/projects/${projectId}`)
  }

  // 打开预览
  const openPreview = (item: LibraryMaterialItem, isVideo: boolean = false) => {
    setPreviewItem(item)
    setPreviewType(isVideo ? 'video' : 'image')
  }

  // 格式化时间
  const formatTime = (date: string | Date | null | undefined) => {
    if (!date) return ""
    const d = new Date(date)
    return d.toLocaleDateString("zh-CN")
  }

  // 获取总数量文本
  const getTotalText = () => {
    const total = pagination?.total || 0
    const typeKey = activeTab === 'videos' ? 'videos' : activeTab
    return t("total", { count: total, type: t(`types.${typeKey}`) })
  }

  return (
    <div className="flex-1 p-4 md:p-8 pt-20 md:pt-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        {/* 头部 */}
        <div className="flex flex-col gap-4 mb-6">
          {/* 标题 */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <LayoutGrid className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{t("title")}</h1>
              <p className="text-muted-foreground text-sm">{t("description")}</p>
            </div>
          </div>

          {/* 标签页切换 */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {tabs.map((tab) => {
              const TabIcon = tab.icon
              const isActive = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => handleTabChange(tab.key)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap transition-all",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground"
                  )}
                >
                  <TabIcon className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    {t(`tabs.${tab.labelKey}`)}
                  </span>
                </button>
              )
            })}
          </div>

          {/* 搜索和视图切换 */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t("searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* 我的上传标签页的文件类型筛选 */}
            {activeTab === 'my-uploads' && (
              <select
                value={assetTypeFilter}
                onChange={(e) => setAssetTypeFilter(e.target.value)}
                className="h-10 px-3 rounded-lg border border-input bg-background text-sm"
              >
                <option value="all">{t("filter.all") || "全部"}</option>
                <option value="image">{t("filter.images") || "图片"}</option>
                <option value="audio">{t("filter.audio") || "音频"}</option>
                <option value="video">{t("filter.videos") || "视频"}</option>
              </select>
            )}

            <Button
              variant="default"
              onClick={() => setUploadDialogOpen(true)}
              className="gap-2"
            >
              <Upload className="w-4 h-4" />
              {t("upload.button") || "上传素材"}
            </Button>

            <div className="flex border rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('grid')}
                className={cn(
                  "p-2",
                  viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                )}
              >
                <Grid3X3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  "p-2",
                  viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                )}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* 未登录状态提示 */}
        {status !== 'authenticated' && status !== 'loading' && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <LayoutGrid className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">{t("please_login") || "请先登录"}</h3>
            <p className="text-muted-foreground mb-4">
              {t("please_login_description") || "登录后即可浏览和管理您的素材库"}
            </p>
          </div>
        )}

        {/* 已登录用户的内容 */}
        {status === 'authenticated' && (
          <>
            {/* 错误提示 */}
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-600">
                {error}
              </div>
            )}

            {/* 加载状态 */}
            {loading && items.length === 0 ? (
              viewMode === 'grid' && activeTab === 'all' ? (
                <Masonry
                  breakpointCols={breakpointColumnsObj}
                  className="flex w-auto -ml-4"
                  columnClassName="pl-4 bg-clip-padding"
                >
                  {[...Array(15)].map((_, i) => (
                    <div key={i} className="mb-4">
                      <Card className="overflow-hidden">
                        <Skeleton className={`w-full ${i % 3 === 0 ? 'aspect-[3/4]' : i % 2 === 0 ? 'aspect-square' : 'aspect-[4/3]'}`} />
                        <CardContent className="p-3 space-y-2">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-3 w-1/2" />
                        </CardContent>
                      </Card>
                    </div>
                  ))}
                </Masonry>
              ) : viewMode === 'grid' ? (
                <div className={`grid gap-4 ${
                    activeTab === 'videos' || activeTab === 'storyboards'
                      ? 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3'
                      : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
                  }`}>
                  {[...Array(activeTab === 'characters' ? 15 : 9)].map((_, i) => (
                    <Card key={i} className="overflow-hidden">
                      <Skeleton className="w-full aspect-square" />
                      <CardContent className="p-3 space-y-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {[...Array(9)].map((_, i) => (
                    <Card key={i} className="overflow-hidden">
                      <CardContent className="p-3 flex gap-3">
                        <Skeleton className="rounded-lg flex-shrink-0 w-20 h-20" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-1/3" />
                          <Skeleton className="h-3 w-1/2" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )
            ) : activeTab === 'my-uploads' ? (
              userAssets.loading && userAssets.assets.length === 0 ? (
                viewMode === 'grid' ? (
                  <Masonry
                    breakpointCols={breakpointColumnsObj}
                    className="flex w-auto -ml-4"
                    columnClassName="pl-4 bg-clip-padding"
                  >
                    {[...Array(9)].map((_, i) => (
                      <div key={i} className="mb-4">
                        <Card className="overflow-hidden">
                          <Skeleton className={`w-full ${i % 3 === 0 ? 'aspect-[3/4]' : i % 2 === 0 ? 'aspect-square' : 'aspect-[4/3]'}`} />
                          <CardContent className="p-3 space-y-2">
                            <Skeleton className="h-4 w-3/4" />
                            <Skeleton className="h-3 w-1/2" />
                          </CardContent>
                        </Card>
                      </div>
                    ))}
                  </Masonry>
                ) : (
                  <div className="space-y-3">
                    {[...Array(9)].map((_, i) => (
                      <Card key={i} className="overflow-hidden">
                        <CardContent className="p-3 flex gap-3">
                          <Skeleton className="rounded-lg flex-shrink-0 w-20 h-20" />
                          <div className="flex-1 space-y-2">
                            <Skeleton className="h-4 w-1/3" />
                            <Skeleton className="h-3 w-1/2" />
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )
              ) : userAssets.assets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                    <Upload className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{t("upload.empty.title") || "暂无上传素材"}</h3>
                  <p className="text-muted-foreground mb-4">{t("upload.empty.description") || "点击上方按钮上传您的第一个素材"}</p>
                  <Button onClick={() => setUploadDialogOpen(true)}>
                    <Upload className="w-4 h-4 mr-2" />
                    {t("upload.button") || "上传素材"}
                  </Button>
                </div>
              ) : viewMode === 'grid' ? (
                <>
                  <Masonry
                    breakpointCols={breakpointColumnsObj}
                    className="flex w-auto -ml-4"
                    columnClassName="pl-4 bg-clip-padding"
                  >
                    {userAssets.assets.map((asset) => (
                      <div key={asset.id} className="mb-4">
                        <UserAssetCard
                          asset={asset}
                          viewMode={viewMode}
                          onPreview={() => openPreview(asset, asset.type === 'video')}
                          onDelete={() => setDeleteAssetId(asset.id)}
                        />
                      </div>
                    ))}
                  </Masonry>
                  {/* 无限滚动加载触发器 - 我的上传 */}
                  <div ref={loadMoreUploadsRef} className="flex justify-center py-8">
                    {isLoadingMoreUploads && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span className="text-sm">加载更多...</span>
                      </div>
                    )}
                    {!isLoadingMoreUploads && userAssets.pagination && userAssets.pagination.page >= userAssets.pagination.totalPages && userAssets.assets.length > 0 && (
                      <span className="text-sm text-muted-foreground">没有更多了</span>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  {userAssets.assets.map((asset) => (
                    <UserAssetCard
                      key={asset.id}
                      asset={asset}
                      viewMode={viewMode}
                      onPreview={() => openPreview(asset, asset.type === 'video')}
                      onDelete={() => setDeleteAssetId(asset.id)}
                    />
                  ))}
                </div>
              )
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                  <IconComponent className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{t("empty.title")}</h3>
                <p className="text-muted-foreground mb-4">{t("empty.description")}</p>
                <Button onClick={() => router.push(`/${locale}/create`)}>
                  <IconComponent className="w-4 h-4 mr-2" />
                  {t("empty.cta")}
                </Button>
              </div>
            ) : (
              viewMode === 'grid' && activeTab === 'all' ? (
                <Masonry
                  breakpointCols={breakpointColumnsObj}
                  className="flex w-auto -ml-4"
                  columnClassName="pl-4 bg-clip-padding"
                >
                  {items.map((item: LibraryMaterialItem, index: number) => {
                    const uniqueKey = `${item.type || activeTab}-${item.projectId}-${item.id || index}`
                    const isVideo = item.type === 'video'
                    const isStoryboard = item.type === 'storyboard'

                    return (
                      <div key={uniqueKey} className="mb-4">
                        <Card className="overflow-hidden group cursor-pointer">
                          <div
                            className={`bg-muted relative overflow-hidden ${
                              isVideo || isStoryboard ? 'aspect-video' : 'aspect-square'
                            }`}
                            onClick={() => openPreview(item, isVideo)}
                          >
                            {item.imageUrl || item.thumbnailUrl || item.videoUrl ? (
                              isVideo ? (
                                <>
                                  <video
                                    src={item.videoUrl}
                                    poster={item.thumbnailUrl}
                                    className="w-full h-full object-cover"
                                    preload="metadata"
                                    onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.pause()
                                      e.currentTarget.currentTime = 0
                                    }}
                                  />
                                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Play className="w-12 h-12 text-white" />
                                  </div>
                                </>
                              ) : (
                                <img
                                  src={item.imageUrl}
                                  alt={item.name || item.prompt || 'image'}
                                  className="w-full h-full object-cover"
                                />
                              )
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <IconComponent className="w-12 h-12 text-muted-foreground/30" />
                              </div>
                            )}
                            <div
                              className="absolute bottom-2 left-2 right-2"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button className="w-full text-left text-xs bg-black/60 text-white px-2 py-1 rounded truncate hover:bg-black/70">
                                    {item.projectTitle}
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                  <DropdownMenuItem onClick={() => goToProject(item.projectId || '')}>
                                    <ExternalLink className="w-4 h-4 mr-2" />
                                    {t("viewProject")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => openPreview(item, isVideo)}>
                                    <Eye className="w-4 h-4 mr-2" />
                                    {t("preview")}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                          <CardContent className="p-3">
                            <p className="text-sm font-medium truncate" title={item.name || item.prompt}>
                              {item.name || t("untitled")}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {formatTime(item.createdAt)}
                            </p>
                          </CardContent>
                        </Card>
                      </div>
                    )
                  })}
                </Masonry>
              ) : viewMode === 'grid' ? (
                <div className={`grid gap-4 ${
                    activeTab === 'videos' || activeTab === 'storyboards'
                      ? 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3'
                      : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
                  }`}>
                  {items.map((item: LibraryMaterialItem, index: number) => {
                    const uniqueKey = `${item.type || activeTab}-${item.projectId}-${item.id || index}`
                    const isVideo = item.type === 'video' || activeTab === 'videos'
                    const isStoryboard = item.type === 'storyboard' || activeTab === 'storyboards'

                    return (
                      <Card key={uniqueKey} className="overflow-hidden group cursor-pointer">
                        <div
                          className={`bg-muted relative overflow-hidden ${
                            isVideo || isStoryboard ? 'aspect-video' : 'aspect-square'
                          }`}
                          onClick={() => openPreview(item, isVideo)}
                        >
                          {item.imageUrl || item.thumbnailUrl || item.videoUrl ? (
                            isVideo ? (
                              <>
                                <video
                                  src={item.videoUrl}
                                  poster={item.thumbnailUrl}
                                  className="w-full h-full object-cover"
                                  preload="metadata"
                                  onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.pause()
                                    e.currentTarget.currentTime = 0
                                  }}
                                />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Play className="w-12 h-12 text-white" />
                                </div>
                              </>
                            ) : (
                              <img
                                src={item.imageUrl}
                                alt={item.name || item.prompt || 'image'}
                                className="w-full h-full object-cover"
                              />
                            )
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <IconComponent className="w-12 h-12 text-muted-foreground/30" />
                            </div>
                          )}
                          <div
                            className="absolute bottom-2 left-2 right-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className="w-full text-left text-xs bg-black/60 text-white px-2 py-1 rounded truncate hover:bg-black/70">
                                  {item.projectTitle}
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                <DropdownMenuItem onClick={() => goToProject(item.projectId || '')}>
                                  <ExternalLink className="w-4 h-4 mr-2" />
                                  {t("viewProject")}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => openPreview(item, isVideo)}>
                                  <Eye className="w-4 h-4 mr-2" />
                                  {t("preview")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                        <CardContent className="p-3">
                          <p className="text-sm font-medium truncate" title={item.name || item.prompt}>
                            {item.name || t("untitled")}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {formatTime(item.createdAt)}
                          </p>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              ) : (
                <div className="space-y-3">
                  {items.map((item: LibraryMaterialItem, index: number) => {
                    const uniqueKey = `${item.type || activeTab}-${item.projectId}-${item.id || index}`
                    const isVideo = item.type === 'video' || activeTab === 'videos'
                    const isStoryboard = item.type === 'storyboard' || activeTab === 'storyboards'

                    return (
                      <Card key={uniqueKey} className="overflow-hidden group">
                        <CardContent className="p-3 flex gap-3 items-center">
                          <div
                            className={`rounded-lg bg-muted overflow-hidden flex-shrink-0 cursor-pointer relative ${
                              isVideo || isStoryboard ? 'w-28 aspect-video' : 'w-20 h-20'
                            }`}
                            onClick={() => openPreview(item, isVideo)}
                          >
                            {item.imageUrl || item.thumbnailUrl || item.videoUrl ? (
                              isVideo || isStoryboard ? (
                                <>
                                  {isVideo ? (
                                    <video
                                      src={item.videoUrl}
                                      poster={item.thumbnailUrl}
                                      className="w-full h-full object-cover"
                                      preload="metadata"
                                      onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.pause()
                                        e.currentTarget.currentTime = 0
                                      }}
                                    />
                                  ) : (
                                    <img
                                      src={item.imageUrl}
                                      alt={item.name || 'image'}
                                      className="w-full h-full object-cover"
                                    />
                                  )}
                                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                    <Play className="w-6 h-6 text-white" />
                                  </div>
                                </>
                              ) : (
                                <img
                                  src={item.imageUrl}
                                  alt={item.name || 'image'}
                                  className="w-full h-full object-cover"
                                />
                              )
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <IconComponent className="w-8 h-8 text-muted-foreground/30" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate" title={item.name || item.prompt || t("untitled")}>
                              {item.name || item.prompt?.slice(0, 50) || t("untitled")}
                            </p>
                            <p
                              className="text-xs text-muted-foreground truncate cursor-pointer hover:underline"
                              title={item.projectTitle}
                              onClick={() => goToProject(item.projectId || '')}
                            >
                              {item.projectTitle}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatTime(item.createdAt)}
                            </p>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openPreview(item, isVideo)}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => goToProject(item.projectId || '')}
                            >
                              <ExternalLink className="w-4 h-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              )
            )}

            {/* 无限滚动加载触发器 */}
            <div ref={loadMoreRef} className="flex justify-center py-8">
              {isLoadingMore && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">加载更多...</span>
                </div>
              )}
              {!isLoadingMore && pagination && pagination.page >= pagination.totalPages && items.length > 0 && (
                <span className="text-sm text-muted-foreground">没有更多了</span>
              )}
            </div>
          </>
        )}
      </div>

      {/* 预览弹窗 */}
      <Dialog open={!!previewItem} onOpenChange={() => setPreviewItem(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{previewItem?.name || previewItem?.prompt?.slice(0, 50) || t("preview")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {previewType === 'video' ? (
              <div className="aspect-video bg-black rounded-lg overflow-hidden">
                <video
                  src={previewItem?.videoUrl}
                  controls
                  className="w-full h-full object-contain"
                />
              </div>
            ) : (
              <div className="flex justify-center">
                <img
                  src={previewItem?.imageUrl || previewItem?.thumbnailUrl}
                  alt="preview"
                  className="max-w-full max-h-[60vh] object-contain rounded-lg"
                />
              </div>
            )}

            {/* 详情 */}
            <div className="space-y-2">
              {previewItem?.prompt && (
                <div>
                  <p className="text-sm font-medium">{t("prompt")}</p>
                  <p className="text-sm text-muted-foreground">{previewItem.prompt}</p>
                </div>
              )}
              <div className="flex justify-between items-center">
                <p className="text-sm text-muted-foreground">
                  {previewItem?.projectTitle ? `${t("fromProject")}: ${previewItem.projectTitle}` : ''}
                </p>
                {previewItem?.projectId && (
                  <Button
                    size="sm"
                    onClick={() => previewItem && goToProject(previewItem.projectId || '')}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    {t("viewProject")}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 上传弹窗 */}
      <UploadAssetDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        onUploadSuccess={() => {
          userAssets.refreshAssets()
        }}
      />

      {/* 删除确认弹窗 */}
      <AlertDialog open={!!deleteAssetId} onOpenChange={() => setDeleteAssetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("upload.delete.title") || "确认删除"}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("upload.delete.description") || "确定要删除这个素材吗？此操作不可撤销。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("upload.delete.cancel") || "取消"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (deleteAssetId) {
                  await userAssets.deleteAsset(deleteAssetId)
                  setDeleteAssetId(null)
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("upload.delete.confirm") || "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// 用户素材卡片组件
function UserAssetCard({
  asset,
  viewMode,
  onPreview,
  onDelete,
}: {
  asset: UserAsset
  viewMode: 'grid' | 'list'
  onPreview: () => void
  onDelete: () => void
}) {
  const t = useTranslations("library")

  const getFileIcon = () => {
    switch (asset.type) {
      case 'image':
        return <ImageIcon className="w-6 h-6 text-green-500" />
      case 'video':
        return <Film className="w-6 h-6 text-purple-500" />
      case 'audio':
        return <Music className="w-6 h-6 text-orange-500" />
      default:
        return <File className="w-6 h-6 text-muted-foreground" />
    }
  }

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return ''
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const formatTime = (date: string | Date | null) => {
    if (!date) return ""
    const d = new Date(date)
    return d.toLocaleDateString("zh-CN")
  }

  if (viewMode === 'grid') {
    return (
      <Card className="overflow-hidden group">
        <div
          className={`bg-muted relative overflow-hidden cursor-pointer ${
            asset.type === 'video' ? 'aspect-video' : 'aspect-square'
          }`}
          onClick={onPreview}
        >
          {asset.type === 'image' ? (
            <img
              src={asset.url}
              alt={asset.name}
              className="w-full h-full object-cover"
            />
          ) : asset.type === 'video' ? (
            <>
              {asset.thumbnailUrl || asset.url ? (
                <video
                  src={asset.url}
                  poster={asset.thumbnailUrl}
                  className="w-full h-full object-cover"
                  preload="metadata"
                  onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                  onMouseLeave={(e) => {
                    e.currentTarget.pause()
                    e.currentTarget.currentTime = 0
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-black/20">
                  <Film className="w-12 h-12 text-white" />
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                <Play className="w-12 h-12 text-white" />
              </div>
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              {getFileIcon()}
            </div>
          )}

          {/* 操作按钮 */}
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="destructive"
              size="icon"
              className="w-8 h-8 bg-black/50 hover:bg-black/70"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <CardContent className="p-3">
          <p className="text-sm font-medium truncate" title={asset.name}>
            {asset.name}
          </p>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground truncate">
              {formatTime(asset.createdAt)}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatFileSize(asset.fileSize)}
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  // List view
  return (
    <Card className="overflow-hidden group">
      <CardContent className="p-3 flex gap-3 items-center">
        <div
          className={`rounded-lg bg-muted overflow-hidden flex-shrink-0 cursor-pointer relative ${
            asset.type === 'video' ? 'w-28 aspect-video' : 'w-20 h-20'
          }`}
          onClick={onPreview}
        >
          {asset.type === 'image' ? (
            <img
              src={asset.url}
              alt={asset.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              {getFileIcon()}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" title={asset.name}>{asset.name}</p>
          <p className="text-xs text-muted-foreground">
            {formatTime(asset.createdAt)} · {formatFileSize(asset.fileSize)}
          </p>
        </div>

        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onPreview}>
            <Eye className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
