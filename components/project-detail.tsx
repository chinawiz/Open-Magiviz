"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { useLocale } from "next-intl"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ArrowLeft,
  Users,
  Image as ImageIcon,
  Video,
  RefreshCw,
  Download,
  Loader2,
  Clock,
  CheckCircle2,
  FileText,
  Sparkles,
  Play,
  Edit,
} from "lucide-react"
import { useProject, getStepName, getProgressPercentage, type Project, type ProjectData, type Version } from "@/hooks/useProject"
import type { StoryScene, CharacterItem, StoryboardItem, SceneVideoItem } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { useTranslations } from "next-intl"

export function ProjectDetail() {
  const params = useParams()
  const router = useRouter()
  const locale = useLocale()
  const { toast } = useToast()
  const t = useTranslations("operate")
  const tDetail = useTranslations("operate.projectDetail")
  const tMetadata = useTranslations("metadata")

  // 视频风格翻译 key 映射
  const videoStyleMap: Record<string, string> = {
    auto: "auto",
    anime: "videoStyleAnime",
    hollywood: "videoStyleHollywood",
    ads: "videoStyleAdsEducation",
  }

  // 视频模型翻译 key 映射
  const videoModelMap: Record<string, string> = {
    auto: "videoModelAuto",
    veo31Fast: "videoModelVeo31Fast",
    veo31Lite: "videoModelVeo31Lite",
    veo31Quality: "videoModelVeo31Quality",
    seedance25: "videoModelSeedance25",
    seedance2Fast: "videoModelSeedance2Fast",
    seedance2Mini: "videoModelSeedance2Mini",
    seedance2: "videoModelSeedance2",
    kling3: "videoModelKling3",
    happyHorse: "videoModelHappyHorse",
    wan27: "videoModelWan27",
    minimaxH3: "videoModelMinimaxH3",
  }

  const projectId = params.id as string

  const {
    getProject,
    loading,
    error,
  } = useProject()

  const [project, setProject] = useState<Project | null>(null)
  const [data, setData] = useState<ProjectData | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [loadingDetail, setLoadingDetail] = useState(true)
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null)
  const [currentVersion, setCurrentVersion] = useState<number | null>(null)
  const [loadingVersion, setLoadingVersion] = useState<number | null>(null)

  // 格式化时间
  const formatTime = (date: Date | string | null | undefined) => {
    if (!date) return ""
    return new Date(date).toLocaleString("zh-CN")
  }

  // 加载项目详情
  const loadProjectDetail = useCallback(async () => {
    if (!projectId) return
    setLoadingDetail(true)
    const result = await getProject(projectId)
    if (result) {
      setProject(result.data.project)
      setData(result.data.data)
      setVersions(result.data.versions)
      setCurrentVersion(result.data.data?.version ?? null)
    }
    setLoadingDetail(false)
  }, [projectId, getProject])

  useEffect(() => {
    if (projectId) {
      loadProjectDetail()
    }
  }, [projectId, loadProjectDetail])

  // 更新浏览器标题（格式：项目标题 | 网站名称，与 Next.js title template 保持一致）
  useEffect(() => {
    if (project?.title) {
      const siteTitle = tMetadata("title")
      // 使用与根 layout 相同的 title template 格式：%s | ${siteTitle}
      document.title = `${project.title} | ${siteTitle}`
    }
  }, [project?.title, tMetadata])


  // 下载文件函数
  const handleDownloadFile = async (url?: string | null, filename?: string, key?: string) => {
    if (!url) {
      toast({
        title: t("downloadFailed"),
        description: t("noFileToDownload"),
        variant: "destructive",
      })
      return
    }

    const downloadKey = key || filename || url.split('/').pop() || Date.now().toString()
    setDownloadingKey(downloadKey)

    try {
      // 检查是否是 Kie.ai 的 URL（需要先转换）
      let finalUrl = url
      if (url.includes('kie.ai') || url.includes('tempfile.')) {
        try {
          const downloadResp = await fetch('/api/ai/kie/download-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
          })
          const downloadData = await downloadResp.json()
          if (downloadData.success && downloadData.downloadUrl) {
            finalUrl = downloadData.downloadUrl
          }
        } catch (e) {
          console.error('Failed to get download URL:', e)
        }
      }

      // 尝试使用 fetch 流式下载
      const resp = await fetch(finalUrl)
      if (!resp.ok) throw new Error(t('downloadFailed'))

      const contentLength = resp.headers.get('content-length')
      if (!resp.body || !contentLength) {
        // 回退：使用 a 标签直接下载
        const a = document.createElement('a')
        a.href = url
        a.download = filename || url.split('/').pop() || 'file'
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        document.body.appendChild(a)
        a.click()
        a.remove()
        toast({
          title: t("downloadStarted"),
          description: filename || t("fileDownloading"),
        })
        setDownloadingKey(null)
        return
      }

      const total = parseInt(contentLength, 10)
      const reader = resp.body.getReader()
      const chunks: Uint8Array[] = []
      let received = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          chunks.push(value)
          received += value.length
        }
      }

      const blob = new Blob(chunks)
      const downloadUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = filename || url.split('/').pop() || 'file'
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(downloadUrl)

      toast({
        title: t("downloadCompleted"),
        description: filename || t("fileDownloaded"),
      })
    } catch (error) {
      // 如果 fetch 出错，降级到 a 标签下载尝试
      try {
        const a = document.createElement('a')
        a.href = url
        a.download = filename || url.split('/').pop() || 'file'
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        document.body.appendChild(a)
        a.click()
        a.remove()
        toast({
          title: t("downloadStarted"),
          description: filename || t("fileDownloading"),
        })
      } catch (err) {
        toast({
          title: t("downloadFailed"),
          description: error instanceof Error ? error.message : t("retryLater"),
          variant: "destructive",
        })
      }
    } finally {
      setDownloadingKey(null)
    }
  }

  // 查看指定历史版本（仅前端查看，不改变真实“激活版本”）
  const handleViewVersion = async (version: number) => {
    if (!projectId) return
    setLoadingVersion(version)
    try {
      const resp = await fetch(`/api/projects/${projectId}/data?version=${version}`)
      const result = await resp.json()
      if (!resp.ok || !result?.success) {
        throw new Error(result?.error || tDetail("history.loadFailed"))
      }
      setData(result.data)
      setCurrentVersion(version)
      toast({
        title: tDetail("history.viewSuccess"),
      })
    } catch (error) {
      toast({
        title: tDetail("history.viewFailed"),
        description: error instanceof Error ? error.message : t("retryLater"),
        variant: "destructive",
      })
    } finally {
      setLoadingVersion(null)
    }
  }

  // 下载剧情为 JSON
  const handleDownloadScript = () => {
    if (!data?.scriptScenes && !data?.scriptTitle) {
      toast({
        title: t("downloadFailed"),
        description: t("noFileToDownload"),
        variant: "destructive",
      })
      return
    }

    const scriptData = {
      title: data?.scriptTitle || project?.title || '',
      description: data?.scriptDescription || '',
      scenes: data?.scriptScenes || [],
    }

    const blob = new Blob([JSON.stringify(scriptData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const fileName = `${project?.title || 'script'}-${tDetail("script.fileNameSuffix")}.json`
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)

    toast({
      title: t("downloadCompleted"),
      description: fileName,
    })
  }

  if (loadingDetail) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Skeleton className="h-8 w-48 mb-6" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
          <div>
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="container mx-auto py-8 px-4 text-center">
        <h1 className="text-2xl font-bold mb-4">{tDetail("notFound")}</h1>
        <Button asChild>
          <Link href={`/${locale}/projects`}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            {tDetail("backToList")}
          </Link>
        </Button>
      </div>
    )
  }

  // 步骤映射
  const steps = [
    { key: 'script', icon: FileText, label: tDetail('steps.script') },
    { key: 'character', icon: Users, label: tDetail('steps.character') },
    { key: 'storyboard', icon: ImageIcon, label: tDetail('steps.storyboard') },
    { key: 'scene_video', icon: Video, label: tDetail('steps.scene_video') },
    { key: 'final_video', icon: Sparkles, label: tDetail('steps.final_video') },
  ]

  // 计算当前进度
  const currentStepIndex = project?.currentStep
    ? steps.findIndex(s => s.key === project.currentStep)
    : -1

  return (
    <div className="container mx-auto py-8 px-4">
      {/* 顶部导航 */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/${locale}/projects`}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            {tDetail("backToList")}
          </Link>
        </Button>
      </div>

      {/* 项目标题和状态 */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">{project.title}</h1>
          <p className="text-muted-foreground mb-2">{project.originalPrompt}</p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              {tDetail("createdAt")} {formatTime(project.createdAt)}
            </span>
            {project.completedAt && (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" />
                {tDetail("completedAt")} {formatTime(project.completedAt)}
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-3 items-center">
          {/* 进度百分比 */}
          <Badge variant={project.status === 'completed' ? 'default' : 'secondary'} className="text-sm">
            {project.status === 'completed' ? t("projects.completed") : tDetail("inProgress")}
          </Badge>

          {/* 继续生成按钮 - 仅在项目未完成时显示 */}
          {project.status !== 'completed' && (
            <Button
              variant="default"
              size="sm"
              onClick={() => router.push(`/${locale}/create?projectId=${projectId}&versionId=${currentVersion}`)}
            >
              <Play className="w-4 h-4 mr-1" />
              {t("projects.continue")}
            </Button>
          )}

          {/* 编辑按钮 - 仅在项目已完成时显示 */}
          {project.status === 'completed' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/${locale}/create?projectId=${projectId}&versionId=${currentVersion}`)}
            >
              <Edit className="w-4 h-4 mr-1" />
              {t("projects.edit")}
            </Button>
          )}
        </div>
      </div>

      {/* 进度条 */}
      <div className="mb-8">
        <div className="flex justify-between mb-2">
          {steps.map((step, index) => {
            const Icon = step.icon
            const isCompleted = index <= currentStepIndex
            const isCurrent = index === currentStepIndex

            return (
              <div
                key={step.key}
                className={`flex flex-col items-center ${
                  index <= currentStepIndex ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center mb-1 ${
                    isCompleted ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-xs">{step.label}</span>
              </div>
            )
          })}
        </div>
        <div className="relative h-1 bg-muted rounded-full mt-2">
          <div
            className="absolute left-0 top-0 h-full bg-primary rounded-full transition-all"
            style={{ width: `${((currentStepIndex + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>

      {/* 内容区域 */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">{tDetail("tabs.overview")}</TabsTrigger>
          <TabsTrigger value="script">{tDetail("tabs.script")}</TabsTrigger>
          <TabsTrigger value="characters">{tDetail("tabs.characters")}</TabsTrigger>
          <TabsTrigger value="storyboards">{tDetail("tabs.storyboards")}</TabsTrigger>
          <TabsTrigger value="videos">{tDetail("tabs.videos")}</TabsTrigger>
          {data?.finalVideoUrl && (
            <TabsTrigger value="final">{tDetail("tabs.final")}</TabsTrigger>
          )}
          <TabsTrigger value="history">{tDetail("tabs.history")}</TabsTrigger>
        </TabsList>

        {/* 概览 */}
        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold">{tDetail("overview.title")}</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">{tDetail("overview.aspectRatio")}</p>
                  <p className="font-medium">{project.aspectRatio}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{tDetail("overview.duration")}</p>
                  <p className="font-medium">{project.duration}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{tDetail("overview.videoStyle")}</p>
                  <p className="font-medium">
                    {project.videoStyle
                      ? (() => {
                          const key = videoStyleMap[project.videoStyle] || project.videoStyle
                          try {
                            return t(key)
                          } catch {
                            return project.videoStyle
                          }
                        })()
                      : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{tDetail("overview.videoModel")}</p>
                  <p className="font-medium">
                    {project.videoModel
                      ? (() => {
                          const key = videoModelMap[project.videoModel] || project.videoModel
                          try {
                            return t(key)
                          } catch {
                            return project.videoModel
                          }
                        })()
                      : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{tDetail("overview.generationMode")}</p>
                  <p className="font-medium">
                    {project.generationMode
                      ? (() => {
                          const modeMap: Record<string, string> = {
                            auto: t("generationModeAuto"),
                            'first-last-frame': t("generationModeFirstLast"),
                          }
                          return modeMap[project.generationMode] || project.generationMode
                        })()
                      : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{tDetail("overview.status")}</p>
                  <p className="font-medium">{project.status === 'completed' ? t("projects.completed") : tDetail("inProgress")}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{tDetail("overview.currentStep")}</p>
                  <p className="font-medium">{getStepName(project.currentStep, locale)}</p>
                </div>
              </div>

              {data?.finalVideoUrl && (
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium">{tDetail("overview.finalVideo")}</h3>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownloadFile(data.finalVideoUrl, `${project?.title || 'final-video'}.mp4`, 'final-video-overview')}
                      disabled={downloadingKey === 'final-video-overview'}
                    >
                      {downloadingKey === 'final-video-overview' ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          {t("downloading")}
                        </>
                      ) : (
                        <>
                          <Download className="w-3 h-3 mr-1" />
                          {t("download")}
                        </>
                      )}
                    </Button>
                  </div>
                  <video
                    src={data.finalVideoUrl}
                    controls
                    className="w-full max-w-md rounded-lg"
                    poster={data.finalVideoThumbnail ?? undefined}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 剧情 */}
        <TabsContent value="script">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <h2 className="text-xl font-semibold">{tDetail("script.title")}</h2>
              {data?.scriptScenes && data.scriptScenes.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadScript}
                >
                  <Download className="w-4 h-4 mr-2" />
                  {t("download")}
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {data?.scriptTitle && (
                <div className="mb-6">
                  <h3 className="text-lg font-medium mb-2">{data.scriptTitle}</h3>
                  <p className="text-muted-foreground">{data.scriptDescription}</p>
                </div>
              )}
              {data?.scriptScenes && (
                <div className="space-y-4">
                  {data.scriptScenes.map((scene: StoryScene, index: number) => (
                    <div key={scene.id || index} className="border rounded-lg p-4">
                      <h4 className="font-medium mb-2">{tDetail("script.scene", { index: index + 1, title: scene.title ?? '' })}</h4>
                      <p className="text-sm text-muted-foreground">{scene.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 主角 */}
        <TabsContent value="characters">
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold">{tDetail("characters.title")}</h2>
            </CardHeader>
            <CardContent>
              {data?.characterData && data.characterData.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {data.characterData.map((char: CharacterItem, index: number) => {
                    const downloadKey = `character-${char.id || index}`
                    return (
                      <div key={char.id || index} className="border rounded-lg p-4 text-center">
                        {char.imageUrl ? (
                          <img
                            src={char.imageUrl}
                            alt={char.name}
                            className="w-full aspect-square object-cover rounded-lg mb-2"
                          />
                        ) : (
                          <div className="w-full aspect-square bg-muted rounded-lg mb-2 flex items-center justify-center">
                            <Users className="w-8 h-8 text-muted-foreground" />
                          </div>
                        )}
                        <p className="font-medium">{char.name}</p>
                        {char.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {char.description}
                          </p>
                        )}
                        {char.imageUrl && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full mt-2"
                            onClick={() => handleDownloadFile(char.imageUrl, `${char.name || 'character'}-${index + 1}.png`, downloadKey)}
                            disabled={downloadingKey === downloadKey}
                          >
                            {downloadingKey === downloadKey ? (
                              <>
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                {t("downloading")}
                              </>
                            ) : (
                              <>
                                <Download className="w-3 h-3 mr-1" />
                                {t("download")}
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-8">{tDetail("characters.noData")}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 分镜图 */}
        <TabsContent value="storyboards">
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold">{tDetail("storyboards.title")}</h2>
            </CardHeader>
            <CardContent>
              {(() => {
                if (!data || !data.storyboardData) return null
                // 按 baseSceneIndex 分组配对首尾帧
                // 首尾帧记录有 frameType 和 baseSceneIndex
                // 普通记录没有这些字段，需要根据 id 推算 baseSceneIndex
                const sceneMap = new Map<number, { first?: StoryboardItem; last?: StoryboardItem }>()
                data.storyboardData.forEach((sb: StoryboardItem) => {
                  // 如果是首尾帧记录（有 frameType），使用 baseSceneIndex
                  // 否则，如果是普通记录（没有 frameType 且没有 imageUrl），跳过或放到自己的组
                  if (sb.isFrameOnly || sb.frameType) {
                    // 首尾帧记录
                    const baseIndex = typeof sb.baseSceneIndex === 'number' ? sb.baseSceneIndex : 0
                    if (!sceneMap.has(baseIndex)) {
                      sceneMap.set(baseIndex, {})
                    }
                    const sbIdStr = String(sb.id ?? '')
                    if (sb.frameType === 'first' || sbIdStr.includes('_first')) {
                      sceneMap.get(baseIndex)!.first = sb
                    } else if (sb.frameType === 'last' || sbIdStr.includes('_last')) {
                      sceneMap.get(baseIndex)!.last = sb
                    }
                  } else if (sb.imageUrl) {
                    // 普通分镜记录（有图片）
                    const baseIndex = typeof sb.baseSceneIndex === 'number' ? sb.baseSceneIndex : ((typeof sb.id === 'number' || !isNaN(Number(sb.id))) ? Number(sb.id) - 1 : 0)
                    if (!sceneMap.has(baseIndex)) {
                      sceneMap.set(baseIndex, {})
                    }
                    sceneMap.get(baseIndex)!.first = sb
                  }
                  // 跳过没有图片的普通记录（只有 plot 的占位记录）
                })

                const sceneList = Array.from(sceneMap.entries()).sort((a, b) => a[0] - b[0])

                return sceneList.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {sceneList.map(([baseIndex, frames], cardIndex) => {
                      const sb = frames.first || frames.last
                      if (!sb) return null
                      const downloadKey = `storyboard-${baseIndex}`
                      const firstFrameUrl = frames.first?.imageUrl || frames.first?.url
                      const lastFrameUrl = frames.last?.imageUrl || frames.last?.url
                      const hasBothFrames = firstFrameUrl && lastFrameUrl && firstFrameUrl !== lastFrameUrl

                      return (
                        <div key={sb.id || baseIndex} className="border rounded-lg overflow-hidden">
                          {firstFrameUrl ? (
                            <div className="relative group">
                              {/* 轮播容器 */}
                              <div className="flex overflow-x-auto gap-1 snap-x snap-mandatory scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                                style={{ scrollSnapType: 'x mandatory' }}
                              >
                                {/* 首帧 */}
                                <div className="flex-shrink-0 snap-start relative w-full">
                                  <img
                                    src={firstFrameUrl}
                                    alt={sb.title || tDetail("storyboards.storyboard", { index: baseIndex + 1 })}
                                    className="w-full aspect-video object-cover"
                                  />
                                  {hasBothFrames && (
                                    <span className="absolute top-1 left-1 px-1.5 py-0.5 text-[10px] bg-black/60 text-white rounded">
                                      {t("firstFrame")}
                                    </span>
                                  )}
                                </div>
                                
                                {/* 尾帧（如果有） */}
                                {hasBothFrames && (
                                  <div className="flex-shrink-0 snap-start relative w-full">
                                    <img
                                      src={lastFrameUrl}
                                      alt={sb.title || tDetail("storyboards.storyboard", { index: baseIndex + 1 }) + " " + t("lastFrame")}
                                      className="w-full aspect-video object-cover"
                                    />
                                    <span className="absolute top-1 left-1 px-1.5 py-0.5 text-[10px] bg-black/60 text-white rounded">
                                      {t("lastFrame")}
                                    </span>
                                  </div>
                                )}
                              </div>
                              
                              {/* 左右滑动按钮（如果有尾帧） */}
                              {hasBothFrames && (
                                <>
                                  <button
                                    onClick={(e) => {
                                      const container = e.currentTarget.closest('.relative')?.querySelector('.overflow-x-auto') as HTMLElement;
                                      if (container) {
                                        container.scrollBy({ left: -container.clientWidth, behavior: 'smooth' });
                                      }
                                    }}
                                    className="absolute left-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                                  >
                                    <span style={{ fontSize: '16px' }}>‹</span>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      const container = e.currentTarget.closest('.relative')?.querySelector('.overflow-x-auto') as HTMLElement;
                                      if (container) {
                                        container.scrollBy({ left: container.clientWidth, behavior: 'smooth' });
                                      }
                                    }}
                                    className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                                  >
                                    <span style={{ fontSize: '16px' }}>›</span>
                                  </button>
                                </>
                              )}
                            </div>
                          ) : (
                            <div className="w-full aspect-video bg-muted flex items-center justify-center">
                              <ImageIcon className="w-8 h-8 text-muted-foreground" />
                            </div>
                          )}
                          <div className="p-3">
                            <p className="font-medium text-sm mb-2">
                              {sb.title || tDetail("storyboards.scene", { index: baseIndex + 1 })}
                            </p>
                            {firstFrameUrl && (
                              <div className="flex gap-2">
                                {hasBothFrames ? (
                                  <>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="flex-1"
                                      onClick={() => handleDownloadFile(firstFrameUrl, `storyboard-${baseIndex + 1}-first.png`, `${downloadKey}-first`)}
                                      disabled={downloadingKey === `${downloadKey}-first`}
                                    >
                                      {downloadingKey === `${downloadKey}-first` ? (
                                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                      ) : (
                                        <Download className="w-3 h-3 mr-1" />
                                      )}
                                      {t("firstFrame")}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="flex-1"
                                      onClick={() => handleDownloadFile(lastFrameUrl!, `storyboard-${baseIndex + 1}-last.png`, `${downloadKey}-last`)}
                                      disabled={downloadingKey === `${downloadKey}-last`}
                                    >
                                      {downloadingKey === `${downloadKey}-last` ? (
                                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                      ) : (
                                        <Download className="w-3 h-3 mr-1" />
                                      )}
                                      {t("lastFrame")}
                                    </Button>
                                  </>
                                ) : (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full"
                                    onClick={() => handleDownloadFile(firstFrameUrl, `storyboard-${baseIndex + 1}.png`, downloadKey)}
                                    disabled={downloadingKey === downloadKey}
                                  >
                                    {downloadingKey === downloadKey ? (
                                      <>
                                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                        {t("downloading")}
                                      </>
                                    ) : (
                                      <>
                                        <Download className="w-3 h-3 mr-1" />
                                        {t("download")}
                                      </>
                                    )}
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">{tDetail("storyboards.noData")}</p>
                )
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 剧情视频 */}
        <TabsContent value="videos">
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold">{tDetail("videos.title")}</h2>
            </CardHeader>
            <CardContent>
              {data?.sceneVideoData && data.sceneVideoData.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {data.sceneVideoData.map((video: SceneVideoItem, index: number) => {
                    const downloadKey = `scene-video-${video.id || index}`
                    return (
                      <div key={video.id || index} className="border rounded-lg overflow-hidden">
                        {video.videoUrl ? (
                          <video
                            src={video.videoUrl}
                            controls
                            className="w-full aspect-video"
                            poster={video.thumbnailUrl}
                          />
                        ) : (
                          <div className="w-full aspect-video bg-muted flex items-center justify-center">
                            <Video className="w-8 h-8 text-muted-foreground" />
                          </div>
                        )}
                        <div className="p-3">
                          <p className="font-medium text-sm mb-2">
                            {tDetail("videos.video", { index: (video.sceneIndex ?? index) + 1 })}
                          </p>
                          {video.duration && (
                            <p className="text-xs text-muted-foreground mb-2">
                              {tDetail("videos.duration", { seconds: Math.round(Number(video.duration) / 1000) })}
                            </p>
                          )}
                          {video.videoUrl && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full"
                              onClick={() => handleDownloadFile(video.videoUrl, `scene-video-${(video.sceneIndex ?? index) + 1}.mp4`, downloadKey)}
                              disabled={downloadingKey === downloadKey}
                            >
                              {downloadingKey === downloadKey ? (
                                <>
                                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                  {t("downloading")}
                                </>
                              ) : (
                                <>
                                  <Download className="w-3 h-3 mr-1" />
                                  {t("download")}
                                </>
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-8">{tDetail("videos.noData")}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 最终视频 */}
        {data?.finalVideoUrl && (
          <TabsContent value="final">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <h2 className="text-xl font-semibold">{tDetail("final.title")}</h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownloadFile(data.finalVideoUrl, `${project.title || 'final-video'}.mp4`, 'final-video')}
                  disabled={downloadingKey === 'final-video'}
                >
                  {downloadingKey === 'final-video' ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {t("downloading")}
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      {t("download")}
                    </>
                  )}
                </Button>
              </CardHeader>
              <CardContent>
                <video
                  src={data.finalVideoUrl}
                  controls
                  className="  w-full max-w-4xl mx-auto rounded-lg"
                  poster={data.finalVideoThumbnail ?? undefined}
                />
                <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">{tDetail("final.duration")}</p>
                    <p className="font-medium">{data.finalVideoDuration}{tDetail("final.seconds")}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{tDetail("final.fileSize")}</p>
                    <p className="font-medium">{data.finalVideoSize}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{tDetail("final.aspectRatio")}</p>
                    <p className="font-medium">{project.aspectRatio}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* 历史版本 */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold">{tDetail("history.title")}</h2>
            </CardHeader>
            <CardContent>
              {versions && versions.length > 0 ? (
                <div className="space-y-3">
                  {versions.map((version: Version, index: number) => (
                    <div
                      key={`${version.version}-${index}`}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <Badge variant="outline">
                          v{version.version}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {formatTime(version.createdAt)}
                        </span>
                        {version.updatedAt && new Date(version.updatedAt).getTime() !== new Date(version.createdAt).getTime() && (
                          <span className="text-xs text-muted-foreground">
                            ({tDetail("history.modified")}: {formatTime(version.updatedAt)})
                          </span>
                        )}
                        {currentVersion === version.version && (
                          <span className="text-xs text-primary">
                            {tDetail("history.currentViewing")}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant={currentVersion === version.version ? "default" : "outline"}
                          size="sm"
                          onClick={() => handleViewVersion(version.version)}
                          disabled={loadingVersion === version.version}
                        >
                          {loadingVersion === version.version ? (
                            <>
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              {t("loading")}
                            </>
                          ) : (
                            <>
                              <RefreshCw className="w-3 h-3 mr-1" />
                              {tDetail("history.restore")}
                            </>
                          )}
                        </Button>
                        {/* 根据版本自己的状态判断：已完成显示编辑，未完成显示继续生成 */}
                        {version.finalVideoUrl ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => router.push(`/${locale}/create?projectId=${projectId}&versionId=${version.version}`)}
                          >
                            <Edit className="w-3 h-3 mr-1" />
                            {tDetail("history.editVersion")}
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => router.push(`/${locale}/create?projectId=${projectId}&versionId=${version.version}`)}
                          >
                            <Play className="w-3 h-3 mr-1" />
                            {tDetail("history.continueFromVersion")}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-8">{tDetail("history.noData")}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
