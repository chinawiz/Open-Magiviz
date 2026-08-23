"use client"

import { useState, useEffect, useMemo } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Search,
  Image as ImageIcon,
  Film,
  User,
  Play,
  LayoutGrid,
  Upload,
  ExternalLink,
  Check,
  Music,
} from "lucide-react"
import { useCharacterLibrary, useStoryboardLibrary, useVideoLibrary, useUnifiedLibrary } from "@/hooks/useLibrary"
import { useUserAssets } from "@/hooks/useUserAssets"
import type { LibraryMaterialItem } from "@/lib/types"

interface LibrarySelectorProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSelect: (url: string, item: LibraryMaterialItem) => void
}

type TabKey = 'all' | 'characters' | 'storyboards' | 'videos' | 'my-uploads'

const tabs: { key: TabKey; icon: typeof LayoutGrid; labelKey: string }[] = [
  { key: 'all', icon: LayoutGrid, labelKey: 'all' },
  { key: 'characters', icon: User, labelKey: 'characters' },
  { key: 'storyboards', icon: ImageIcon, labelKey: 'storyboards' },
  { key: 'videos', icon: Film, labelKey: 'videos' },
  { key: 'my-uploads', icon: Upload, labelKey: 'myUploads' },
]

const typeIcons = {
  all: LayoutGrid,
  characters: User,
  storyboards: ImageIcon,
  videos: Film,
  'my-uploads': Upload,
}

// 嵌入内容版本 - 用于在 Dialog 内部使用
export function LibrarySelectorContent({
  onSelect,
  className,
}: {
  onSelect: (url: string, item: any) => void
  className?: string
}) {
  const { status } = useSession()
  const t = useTranslations("library")

  const [activeTab, setActiveTab] = useState<TabKey>('all')
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [selectedItem, setSelectedItem] = useState<any | null>(null)
  const [assetTypeFilter, setAssetTypeFilter] = useState<string>('all')

  // 各个素材库的 hooks
  const characterLibrary = useCharacterLibrary()
  const storyboardLibrary = useStoryboardLibrary()
  const videoLibrary = useVideoLibrary()
  const unifiedLibrary = useUnifiedLibrary()
  const userAssets = useUserAssets()

  // 获取对应的数据
  const libData = useMemo(() => {
    return activeTab === 'all' ? unifiedLibrary
      : activeTab === 'characters' ? characterLibrary
      : activeTab === 'storyboards' ? storyboardLibrary
      : activeTab === 'videos' ? videoLibrary
      : null
  }, [activeTab, unifiedLibrary, characterLibrary, storyboardLibrary, videoLibrary])

  const { items, loading, pagination } = libData || { items: [], loading: false, pagination: null }

  // 获取加载函数
  const loadData = useMemo(() => {
    return activeTab === 'all' ? unifiedLibrary.loadAll
      : activeTab === 'characters' ? characterLibrary.loadCharacters
      : activeTab === 'storyboards' ? storyboardLibrary.loadStoryboards
      : activeTab === 'videos' ? videoLibrary.loadVideos
      : null
  }, [activeTab, unifiedLibrary, characterLibrary, storyboardLibrary, videoLibrary])

  const IconComponent = typeIcons[activeTab] || LayoutGrid

  // 防抖搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // 加载数据
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
  }, [activeTab, debouncedSearch, assetTypeFilter, status, loadData])

  // 重置选中
  useEffect(() => {
    setSelectedItem(null)
  }, [activeTab])

  const handleSelect = (item: LibraryMaterialItem) => {
    if (selectedItem?.id === item.id) {
      setSelectedItem(null)
    } else {
      setSelectedItem(item)
    }
  }

  const handleConfirm = () => {
    if (selectedItem) {
      const url = selectedItem.videoUrl || selectedItem.imageUrl || selectedItem.thumbnailUrl || selectedItem.url
      if (url) {
        onSelect(url, selectedItem)
      }
    }
  }

  const formatTime = (date: string | Date | null | undefined) => {
    if (!date) return ""
    const d = new Date(date)
    return d.toLocaleDateString("zh-CN")
  }

  // 当前显示的数据
  const displayItems: LibraryMaterialItem[] = activeTab === 'my-uploads' ? userAssets.assets : items
  const isLoading = activeTab === 'my-uploads' ? userAssets.loading : loading

  // 布局判断
  const isMasonry = activeTab === 'all' || activeTab === 'my-uploads'
  const isThreeColumn = activeTab === 'characters' || activeTab === 'storyboards' || activeTab === 'videos'
  const isVideoCard = activeTab === 'storyboards' || activeTab === 'videos'

  const getImageUrl = (item: LibraryMaterialItem): string => {
    if (activeTab === 'my-uploads') {
      return item.url || ''
    }
    return item.imageUrl || item.thumbnailUrl || item.videoUrl || ''
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* 标签页切换 */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-4">
        {tabs.map((tab) => {
          const TabIcon = tab.icon
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
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

      {/* 搜索框 */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {activeTab === 'my-uploads' && (
          <select
            value={assetTypeFilter}
            onChange={(e) => setAssetTypeFilter(e.target.value)}
            className="h-10 px-3 rounded-lg border border-input bg-background text-sm"
          >
            <option value="all">{t("filter.all")}</option>
            <option value="image">{t("filter.images")}</option>
            <option value="audio">{t("filter.audio")}</option>
            <option value="video">{t("filter.videos")}</option>
          </select>
        )}
      </div>

      {/* 素材列表 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* 未登录 */}
        {status !== 'authenticated' && status !== 'loading' && (
          <div className="flex flex-col items-center justify-center py-16">
            <IconComponent className="w-12 h-12 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">{t("please_login")}</p>
          </div>
        )}

        {/* 加载中 */}
        {status === 'authenticated' && isLoading && displayItems.length === 0 ? (
          <div className={isMasonry
              ? 'masonry-grid-md'
              : `grid gap-4 ${
                  isThreeColumn
                    ? 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3'
                    : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
                }`
            }>
            {[...Array(12)].map((_, i) => (
              isMasonry ? (
                <div key={i} className="masonry-item">
                  <Card className="overflow-hidden">
                    <Skeleton className={`w-full ${i % 3 === 0 ? 'aspect-[3/4]' : i % 2 === 0 ? 'aspect-square' : 'aspect-[4/3]'}`} />
                    <CardContent className="p-3 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <Card key={i} className="overflow-hidden">
                  <Skeleton className={`w-full ${isVideoCard ? 'aspect-video' : 'aspect-square'}`} />
                  <CardContent className="p-3 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </CardContent>
                </Card>
              )
            ))}
          </div>
        ) : status === 'authenticated' && displayItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <IconComponent className="w-12 h-12 text-muted-foreground mb-3 opacity-50" />
            <p className="text-muted-foreground">{t("empty.title")}</p>
          </div>
        ) : status === 'authenticated' ? (
          <>
            <p className="text-sm text-muted-foreground mb-3">
              {t("total", { count: displayItems.length, type: "" })}
            </p>
            <div className={isMasonry
              ? 'masonry-grid-md'
              : `grid gap-4 ${
                  isThreeColumn
                    ? 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3'
                    : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
                }`
            }>
              {displayItems.map((item: LibraryMaterialItem, index: number) => {
                const uniqueKey = `${item.type || activeTab}-${item.projectId}-${item.id || index}`
                const isVideo = item.type === 'video' || activeTab === 'videos'
                const isStoryboard = item.type === 'storyboard' || activeTab === 'storyboards'
                const isAudio = item.type === 'audio'
                const isSelected = selectedItem && typeof selectedItem.id !== 'undefined' && selectedItem.id === item.id
                const itemImageUrl = getImageUrl(item)

                return (
                  isMasonry ? (
                    <div key={uniqueKey} className="masonry-item">
                      <AssetCard
                        item={item}
                        isVideo={isVideo}
                        isStoryboard={isStoryboard}
                        isAudio={isAudio}
                        isSelected={isSelected}
                        imageUrl={itemImageUrl}
                        onSelect={handleSelect}
                      />
                    </div>
                  ) : (
                    <div key={uniqueKey}>
                      <AssetCard
                        item={item}
                        isVideo={isVideo}
                        isStoryboard={isStoryboard}
                        isAudio={isAudio}
                        isSelected={isSelected}
                        imageUrl={itemImageUrl}
                        onSelect={handleSelect}
                      />
                    </div>
                  )
                )
              })}
            </div>
          </>
        ) : null}
      </div>

      {/* 选中提示 - 选中后自动弹出预览 */}
      {selectedItem && (
        <PreviewDialog
          item={selectedItem}
          open={!!selectedItem}
          onOpenChange={(open) => !open && setSelectedItem(null)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  )
}

// 预览弹窗组件
function PreviewDialog({
  item,
  open,
  onOpenChange,
  onConfirm,
}: {
  item: LibraryMaterialItem
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const t = useTranslations("library")
  const isVideo = item?.type === 'video'
  const isAudio = item?.type === 'audio'
  const isStoryboard = item?.type === 'storyboard'
  const hasMedia = item?.videoUrl || item?.imageUrl || item?.thumbnailUrl || item?.url

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{item?.name || item?.prompt?.slice(0, 50) || t("confirm")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {isVideo ? (
            // 视频直接显示播放器
            <video
              src={item.videoUrl || item.url}
              poster={item.thumbnailUrl}
              controls
              className="w-full aspect-video rounded-lg"
            />
          ) : isAudio ? (
            // 音频显示播放器
            <div className="flex flex-col items-center justify-center py-8 bg-gradient-to-br from-orange-500/10 to-purple-500/10 rounded-lg">
              <Music className="w-16 h-16 text-orange-500 mb-4" />
              <audio
                src={item.url || item.audioUrl}
                controls
                className="w-full max-w-md"
              />
            </div>
          ) : hasMedia ? (
            // 图片类型显示图片
            <img
              src={item.videoUrl || item.imageUrl || item.thumbnailUrl || item.url}
              alt={item.name || item.prompt || 'preview'}
              className="w-full max-h-[60vh] object-contain rounded-lg"
            />
          ) : (
            <div className="aspect-video bg-muted rounded-lg flex items-center justify-center">
              <ImageIcon className="w-12 h-12 text-muted-foreground" />
            </div>
          )}
          {item?.prompt && (
            <p className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
              {item.prompt}
            </p>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={onConfirm}>
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 卡片组件
function AssetCard({
  item,
  isVideo,
  isStoryboard,
  isAudio,
  isSelected,
  imageUrl,
  onSelect,
}: {
  item: any
  isVideo: boolean
  isStoryboard: boolean
  isAudio: boolean
  isSelected: boolean
  imageUrl: string
  onSelect: (item: LibraryMaterialItem) => void
}) {
  const t = useTranslations("library")
  const IconComponent = isVideo ? Film : isStoryboard ? ImageIcon : isAudio ? Music : User

  return (
    <Card
      className={cn(
        "overflow-hidden group cursor-pointer transition-all duration-200",
        isSelected && "ring-2 ring-primary ring-offset-2"
      )}
      onClick={() => onSelect(item)}
    >
      {/* 封面/缩略图 */}
      <div
        className={cn(
          "bg-muted relative overflow-hidden",
          isVideo || isStoryboard ? 'aspect-video' : 'aspect-square'
        )}
      >
        {isVideo ? (
          // 视频类型：显示视频 + 播放图标覆盖层
          <div className="relative w-full h-full">
            <video
              src={item.videoUrl || item.url}
              poster={item.thumbnailUrl}
              className="w-full h-full object-cover"
              muted
              playsInline
              preload="metadata"
              onMouseEnter={(e) => {
                e.currentTarget.play().catch(() => {})
              }}
              onMouseLeave={(e) => {
                e.currentTarget.pause()
                e.currentTarget.currentTime = 0
              }}
              onClick={(e) => e.stopPropagation()}
            />
            {/* 播放图标覆盖层 - 让点击穿透到卡片 */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-black/30 rounded-full p-3 group-hover:bg-black/50 transition-colors">
                <Play className="w-8 h-8 text-white" />
              </div>
            </div>
          </div>
        ) : isAudio ? (
          // 音频类型：显示音频播放器
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-orange-500/10 to-purple-500/10 p-4">
            <Music className="w-12 h-12 text-orange-500 mb-2" />
            <audio
              src={item.url || item.audioUrl}
              controls
              className="w-full h-8 pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ) : imageUrl ? (
          // 图片类型
          <img
            src={imageUrl}
            alt={item.name || item.prompt || 'image'}
            className="w-full h-full object-cover"
          />
        ) : (
          // 没有图片时显示图标
          <div className="w-full h-full flex items-center justify-center">
            <IconComponent className="w-12 h-12 text-muted-foreground/30" />
          </div>
        )}

        {/* 选中标记 */}
        {isSelected && (
          <div className="absolute top-2 right-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center shadow-lg z-10">
            <Check className="w-4 h-4 text-primary-foreground" />
          </div>
        )}

        {/* 项目来源 */}
        {item.projectTitle && (
          <div className="absolute bottom-2 left-2 right-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="w-full text-left text-xs bg-black/60 text-white px-2 py-1 rounded truncate hover:bg-black/70">
                  {item.projectTitle}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem>
                  <ExternalLink className="w-4 h-4 mr-2" />
                  {item.projectTitle}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* 信息 */}
      <CardContent className="p-3">
        <p className="text-sm font-medium truncate" title={item.name || item.prompt}>
          {item.name || item.prompt?.slice(0, 30) || t("untitled")}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {item.createdAt ? new Date(item.createdAt).toLocaleDateString("zh-CN") : ""}
        </p>
      </CardContent>
    </Card>
  )
}

// 保留原有的 LibrarySelector 导出（带 Dialog 的完整版本）
export function LibrarySelector({ open, onOpenChange, onSelect }: LibrarySelectorProps) {
  const t = useTranslations("library")

  if (open === undefined) {
    open = true
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("selectAsset")}</DialogTitle>
        </DialogHeader>
        <LibrarySelectorContent onSelect={onSelect} className="flex-1 min-h-0" />
      </DialogContent>
    </Dialog>
  )
}
