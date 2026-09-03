"use client"

import type React from "react"

import { useState, useRef, useEffect, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, Loader2, Eye, Download } from "lucide-react"
import { cn } from "@/lib/utils"
import type {
  CharacterItem,
  CharacterImageRef,
  StoryboardItem,
  SceneVideoItem,
  StoryScene,
  ComposedVideoResult,
  ScriptData,
} from "@/lib/types"
import { useTranslations, useLocale } from "next-intl"
import { useSession } from "next-auth/react"
import { useToast } from "@/hooks/use-toast"
import { useLibrarySelection } from "@/hooks/use-library-selection"
import { computeFileSizeLimit } from "@/components/operate/format"
import { MediaDialogMounts, OverlayDialogMounts } from "@/components/operate/operate-dialogs"
import { CreatePanel } from "@/components/operate/create-panel"
import { WorkflowHeader, ScriptStep, FinalVideoStep } from "@/components/operate/workflow-steps"
import { getAllVideoDurations } from "@/components/operate/video"
import { parseStoryboardRestoreData } from "@/components/operate/storyboard-restore"
import { estimateSceneVideoPoints as estimateSceneVideoPointsPure, estimateWorkflowPoints } from "@/lib/points-estimate"
import { validateSeedanceMedia } from "@/components/operate/seedance-media"
import {
  VIDEO_MODEL_RESOLUTIONS,
  VIDEO_MODEL_OPTION_ORDER,
  MEDIA_COMPATIBLE_VIDEO_MODELS,
  FIRST_LAST_FRAME_UNSUPPORTED_MODELS,
} from "@/lib/providers/video-models"

import { useProject, getProgressPercentage } from "@/hooks/useProject"
import { useSubscriptionPlan } from "@/hooks/useSubscriptionPlan"
import { useTaskEvents } from "@/hooks/use-task-events"
import { useFileStorage } from "@/hooks/use-file-storage"
import { useUploadItems } from "@/hooks/use-upload-items"
import { useStoryboardGeneration } from "@/hooks/use-storyboard-generation"
import { useCharacterGeneration } from "@/hooks/use-character-generation"

interface AIFunctionProps {
  onSend?: (message: string) => void
  onImageUpload?: (file: File) => void
  placeholder?: string
  resumeProjectId?: string | null
  resumeVersionId?: string | null  // 指定恢复的版本ID
}

// 视频风格映射
const VIDEO_STYLE_MAP: Record<string, string> = {
  auto: "auto",
  anime: "videoStyleAnime",
  hollywood: "videoStyleHollywood",
  ads: "videoStyleAdsEducation"
}

/**
 * 容错解析模型输出中的 JSON：依次尝试去 ``` 包裹、完整解析、
 * 括号匹配提取首个对象/数组、正则逐段解析，全部失败返回 null。
 * 从 operate.tsx 两处重复定义提取，行为与原来一致。
 */
function tryParsePossiblyMalformedJson(text: string): unknown {
  if (!text || typeof text !== 'string') return null

  // 去掉 ``` 或 ```json 包裹
  let clean = text.trim()
  clean = clean.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

  // 直接尝试完整解析
  try {
    return JSON.parse(clean)
  } catch (e) {}

  // 尝试定位第一个 JSON 对象/数组并做括号匹配提取
  const firstBrace = (() => {
    const i1 = clean.indexOf('{')
    const i2 = clean.indexOf('[')
    if (i1 === -1 && i2 === -1) return -1
    if (i1 === -1) return i2
    if (i2 === -1) return i1
    return Math.min(i1, i2)
  })()

  if (firstBrace >= 0) {
    const openChar = clean[firstBrace]
    const closeChar = openChar === '{' ? '}' : ']'
    let depth = 0
    for (let i = firstBrace; i < clean.length; i++) {
      if (clean[i] === openChar) depth++
      else if (clean[i] === closeChar) {
        depth--
        if (depth === 0) {
          const candidate = clean.slice(firstBrace, i + 1)
          try {
            return JSON.parse(candidate)
          } catch (e) {
            break
          }
        }
      }
    }
  }

  // 最后尝试匹配所有 {...} 或 [...] 片段逐一解析
  const objectRegex = /\{[\s\S]*?\}/g
  let m
  while ((m = objectRegex.exec(clean)) !== null) {
    try {
      return JSON.parse(m[0])
    } catch (e) {}
  }
  const arrayRegex = /\[[\s\S]*?\]/g
  while ((m = arrayRegex.exec(clean)) !== null) {
    try {
      return JSON.parse(m[0])
    } catch (e) {}
  }

  return null
}

export function AIFunction({
  onSend,
  onImageUpload,
  placeholder,
  resumeProjectId,
  resumeVersionId,
}: AIFunctionProps) {
  const [message, setMessage] = useState("")
  const [selectedImages, setSelectedImages] = useState<File[]>([])
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [videoUrls, setVideoUrls] = useState<string[]>([])
  const [audioUrls, setAudioUrls] = useState<string[]>([])
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [aspectRatio, setAspectRatio] = useState<string>("16:9")
  const [duration, setDuration] = useState<string>("auto")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [showUploadPopover, setShowUploadPopover] = useState(false)
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [linkInput, setLinkInput] = useState("")
  const [isSignInDialogOpen, setIsSignInDialogOpen] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [showPurchaseDialog, setShowPurchaseDialog] = useState(false)
  const pricingDialogTriggerRef = useRef<HTMLButtonElement>(null)
  const [currentPoints, setCurrentPoints] = useState<number | null>(null)
  const [purchaseDialogType, setPurchaseDialogType] = useState<'points' | 'subscription' | 'card_verify'>('points') // 积分不足 / 订阅不足 / 免费用户视频能力锁（验卡或升级）
  const { data: session, status } = useSession()
  const { toast } = useToast()

  // 文件大小超限弹窗状态
  const [showFileSizeLimitDialog, setShowFileSizeLimitDialog] = useState(false)
  const [fileSizeLimitMB, setFileSizeLimitMB] = useState(10)

  // 存储空间超限弹窗状态
  const [showStorageLimitDialog, setShowStorageLimitDialog] = useState(false)
  // 媒体文件不符合 Seedance 约束弹窗状态
  const [showMediaValidationDialog, setShowMediaValidationDialog] = useState(false)
  const [mediaValidationMessage, setMediaValidationMessage] = useState<string>("")
  const [storageLimitInfo, setStorageLimitInfo] = useState<{
    usedStorage: number
    storageLimit: number
    availableStorage: number
  } | null>(null)

  // 订阅计划状态（hooks/useSubscriptionPlan.ts，行为与原来一致）
  const { subscriptionPlan, subscriptionStatus, isLoadingSubscription } = useSubscriptionPlan()

  // 获取存储空间信息
  useEffect(() => {
    const fetchStorage = async () => {
      if (!session?.user?.id) {
        return
      }
      try {
        const res = await fetch("/api/library/storage")
        if (res.ok) {
          const data = await res.json()
          setStorageLimitInfo({
            usedStorage: data.usedStorage || 0,
            storageLimit: data.storageLimit || 0,
            availableStorage: data.availableStorage || 0,
          })
        }
      } catch (err) {
        console.error("获取存储空间失败:", err)
      }
    }
    fetchStorage()
  }, [status, session?.user?.id])

  const locale = useLocale()
  const t = useTranslations("operate")
  const tAi = useTranslations("aiImage")
  const tWorkflow = useTranslations("operate.workflow")
  const placeholderText = placeholder ?? t("placeholder")

  // 工作流状态
  const [workflowStep, setWorkflowStep] = useState<'idle' | 'script' | 'character' | 'storyboard' | 'scenes' | 'video'>('idle')
  const [scriptData, setScriptData] = useState<ScriptData | null>(null)
  const [characterData, setCharacterData] = useState<CharacterItem[]>([])
  const [storyboardImages, setStoryboardImages] = useState<StoryboardItem[]>([])
  const [sceneVideos, setSceneVideos] = useState<SceneVideoItem[]>([])
  const [videoData, setVideoData] = useState<ComposedVideoResult | null>(null)
  const [workflowLoading, setWorkflowLoading] = useState(false)
  const [workflowError, setWorkflowError] = useState<string | null>(null)
  const [workflowPaused, setWorkflowPaused] = useState(false)
  const workflowPausedRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const workflowInterruptedRef = useRef(false)

  // 项目状态
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)
  const currentProjectIdRef = useRef<string | null>(null) // 使用 ref 同步存储，避免状态异步问题
  const versionGroupIdRef = useRef<string | null>(null) // 版本组ID（用于关联同一批次的重新生成任务）
  const [restoredVersionHasVideo, setRestoredVersionHasVideo] = useState(false) // 恢复的版本是否有最终视频
  const [restoredProjectCompleted, setRestoredProjectCompleted] = useState(false) // 恢复的项目是否已完成

  // 追踪每个分镜图轮播的当前位置 ('first' | 'last')
  const [storyboardCarouselPositions, setStoryboardCarouselPositions] = useState<{ [index: number]: 'first' | 'last' }>({})

  // 同步更新 ref
  useEffect(() => {
    currentProjectIdRef.current = currentProjectId
  }, [currentProjectId])

  // 生成新的版本组ID
  const generateVersionGroupId = () => {
    const newVersionGroupId = `vg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    versionGroupIdRef.current = newVersionGroupId
    console.log('[generateVersionGroupId] 生成新版本组ID:', newVersionGroupId)
    return newVersionGroupId
  }

  // 恢复项目数据 ref（防止重复执行）
  const restoreProjectRef = useRef(false)

  // 恢复项目数据
  // 如果传入 resumeVersionId，则恢复指定版本；否则获取最新版本
  const restoreProjectData = async (projectId: string, resumeVersionId?: string) => {
    try {
      console.log('[恢复] 开始恢复项目数据:', projectId, '版本:', resumeVersionId || '(最新)')

      // 获取项目主表信息
      const projectResp = await fetch(`/api/projects/${projectId}`)
      const projectResult = await projectResp.json()

      if (!projectResp.ok || !projectResult.success) {
        throw new Error(projectResult.error || '获取项目信息失败')
      }

      const projectInfo = projectResult.data.project

      // 获取项目数据（支持指定版本）
      const dataUrl = resumeVersionId
        ? `/api/projects/${projectId}/data?version=${resumeVersionId}`
        : `/api/projects/${projectId}/data`
      const dataResp = await fetch(dataUrl)
      const dataResult = await dataResp.json()

      if (!dataResp.ok || !dataResult.success) {
        throw new Error(dataResult.error || '获取项目数据失败')
      }

      const projectData = dataResult.data

      // 恢复原始输入参数
      if (projectInfo.originalPrompt) {
        setMessage(projectInfo.originalPrompt)
      }
      if (projectInfo.aspectRatio) {
        setAspectRatio(projectInfo.aspectRatio)
      }
      if (projectInfo.duration) {
        setDuration(projectInfo.duration)
      }
      if (projectInfo.videoStyle) {
        setVideoStyle(projectInfo.videoStyle)
      }
      if (projectInfo.videoModel) {
        setVideoModel(projectInfo.videoModel)
      }
      if (projectInfo.generationMode) {
        setGenerationMode(projectInfo.generationMode)
        console.log('[恢复] 生成模式:', projectInfo.generationMode)
      }

      // 检查项目是否已完成（status === 'completed'）
      const isCompleted = projectInfo.status === 'completed'
      console.log('[恢复] 项目状态:', projectInfo.status, '是否已完成:', isCompleted)
      setRestoredProjectCompleted(isCompleted)

      // 恢复剧情数据
      console.log('[恢复] 原始数据 - scriptScenes:', projectData?.scriptScenes)
      console.log('[恢复] 原始数据 - characterData:', projectData?.characterData)
      console.log('[恢复] 原始数据 - storyboardData:', projectData?.storyboardData)
      console.log('[恢复] 原始数据 - sceneVideoData:', projectData?.sceneVideoData)
      console.log('[恢复] 原始数据 - finalVideoUrl:', projectData?.finalVideoUrl)
      
      if (projectData?.scriptScenes && projectData.scriptScenes.length > 0) {
        const restoredScenes = (projectData.scriptScenes as unknown as StoryScene[]).map((scene: StoryScene) => ({
          ...scene,
          plot: String(scene.plot || scene.description || scene.plotText || ''),
          duration: Number(scene.duration) || 5,
        }))

        const totalDuration = restoredScenes.reduce((sum: number, s: StoryScene) => sum + (Number(s.duration) || 0), 0)
        
        console.log('[恢复] 剧情场景数:', restoredScenes.length, '总时长:', totalDuration)
        
        setScriptData({
          title: projectData.scriptTitle || '',
          summary: projectData.scriptDescription || '',
          aspectRatio: projectData.aspectRatio || aspectRatio,
          totalDuration: totalDuration,
          scenes: restoredScenes,
          characters: projectData.characterData || [],
        })
      } else {
        console.log('[恢复] ❌ 未找到剧情数据 scriptScenes')
      }

      // 恢复主角数据
      if (projectData?.characterData) {
        const charCount = Array.isArray(projectData.characterData) ? projectData.characterData.length : '非数组'
        const charsWithImage = Array.isArray(projectData.characterData)
          ? (projectData.characterData as CharacterItem[]).filter((c: CharacterItem) => c?.imageUrl).length
          : 0
        console.log(`[恢复] 主角数据: 总数=${charCount}, 有图片=${charsWithImage}`)
        console.log('[恢复] 主角数据详情:', JSON.stringify(projectData.characterData, null, 2))
        setCharacterData(projectData.characterData)
      } else {
        console.log('[恢复] ❌ 未找到主角数据 characterData')
      }

      // 恢复分镜图数据
      if (projectData?.storyboardData) {
        const sbCount = Array.isArray(projectData.storyboardData) ? projectData.storyboardData.length : '非数组'
        const sbWithImage = Array.isArray(projectData.storyboardData)
          ? (projectData.storyboardData as StoryboardItem[]).filter((s: StoryboardItem) => s?.imageUrl || s?.url).length
          : 0
        console.log(`[恢复] 分镜图数据: 总数=${sbCount}, 有图片=${sbWithImage}`)
        console.log('[恢复] 分镜图数据详情:', JSON.stringify(projectData.storyboardData, null, 2))

        // 三种存储形状（帧对/旧格式/单图下标数组）统一交给纯函数解析——
        // 此前单图形状被整体丢弃，恢复后误判「分镜未完成」导致重复生成扣积分
        setStoryboardImages(parseStoryboardRestoreData(projectData.storyboardData) as StoryboardItem[])
      } else {
        console.log('[恢复] ❌ 未找到分镜图数据 storyboardData')
      }

      // 恢复剧情视频数据
      if (projectData?.sceneVideoData) {
        const svCount = Array.isArray(projectData.sceneVideoData) ? projectData.sceneVideoData.length : '非数组'
        const svWithVideo = Array.isArray(projectData.sceneVideoData)
          ? (projectData.sceneVideoData as SceneVideoItem[]).filter((v: SceneVideoItem) => v?.videoUrl).length
          : 0
        console.log(`[恢复] 剧情视频数据: 总数=${svCount}, 有视频=${svWithVideo}`)
        console.log('[恢复] 剧情视频数据详情:', JSON.stringify(projectData.sceneVideoData, null, 2))
        setSceneVideos(projectData.sceneVideoData)
      } else {
        console.log('[恢复] ❌ 未找到剧情视频数据 sceneVideoData')
      }

      // 恢复最终视频数据
      if (projectData?.finalVideoUrl) {
        console.log('[恢复] 最终视频数据:', {
          url: projectData.finalVideoUrl,
          thumbnail: projectData.finalVideoThumbnail,
          duration: projectData.finalVideoDuration,
          size: projectData.finalVideoSize,
        })
        setVideoData({
          url: projectData.finalVideoUrl,
          thumbnail: projectData.finalVideoThumbnail,
          duration: projectData.finalVideoDuration,
          size: projectData.finalVideoSize,
        })
        setRestoredVersionHasVideo(true) // 标记恢复的版本有最终视频
      } else {
        console.log('[恢复] ❌ 未找到最终视频数据 finalVideoUrl')
        setRestoredVersionHasVideo(false) // 标记恢复的版本没有最终视频
      }

      // 设置项目 ID 和版本组 ID 和版本 ID
      // 如果已有 versionGroupId 则复用
      // 注意：继续生成时不应生成新的 versionGroupId，因为不需要创建新的版本组
      setCurrentProjectId(projectId)

      // 调试：打印 projectData 中所有字段和 versionGroupId
      console.log('[恢复] projectData.versionGroupId:', projectData?.versionGroupId)
      console.log('[恢复] projectInfo.versionGroupId:', projectInfo?.versionGroupId)
      console.log('[恢复] projectData.id (versionId):', projectData?.id)

      // 恢复版本组 ID（仅当已有时才恢复，继续生成不需要新版本组）
      if (projectData?.versionGroupId) {
        versionGroupIdRef.current = projectData.versionGroupId
        console.log('[恢复] 使用 projectData 版本组ID:', projectData.versionGroupId)
      } else if (projectInfo?.versionGroupId) {
        versionGroupIdRef.current = projectInfo.versionGroupId
        console.log('[恢复] 使用 projectInfo 版本组ID:', projectInfo.versionGroupId)
      } else {
        // 原项目没有 versionGroupId，继续生成时也不需要生成新的
        versionGroupIdRef.current = null
        console.log('[恢复] 原项目无版本组ID，继续生成不需要新版本组')
      }

      // 恢复版本 ID（用于继续生成时不创建新版本）
      // 重要：必须使用 projectData.id，而不是 resumeVersionId
      // resumeVersionId 可能是版本号（如 "2"），但后续操作需要的是 projectData.id（如 "abc123"）
      // API 返回的 projectData 已经包含了正确的 id
      if (projectData?.id) {
        currentEditVersionId.current = String(projectData.id)
        console.log('[恢复] 使用 projectData.id 作为版本ID:', projectData.id, '(resumeVersionId:', resumeVersionId, ')')
      } else {
        console.error('[恢复] ❌ projectData.id 不存在，无法设置版本ID')
      }

      console.log('[恢复] 项目数据恢复成功')

      toast({
        title: t("resume.detected"),
        description: t("resume.hint"),
      })

    } catch (error) {
      console.error('[恢复] 恢复项目数据失败:', error)
      toast({
        title: t("resume.failed"),
        description: error instanceof Error ? error.message : t("retryLater"),
        variant: "destructive",
      })
    }
  }

  // 继续生成（从恢复的项目继续）
  const handleResumeContinue = () => {
    console.log('[恢复继续] handleResumeContinue 开始执行')
    console.log('[恢复继续] 当前状态检查:', {
      hasScriptData: !!scriptData,
      scriptDataLength: scriptData?.scenes?.length,
      characterDataLength: characterData.length,
      storyboardImagesLength: storyboardImages.length,
      sceneVideosLength: sceneVideos.length,
      hasVideoData: !!videoData?.url
    })

    // 检查当前状态，确定下一步
    if (!scriptData) {
      console.log('[恢复继续] ❌ 没有脚本数据，中止')
      toast({
        title: t("resume.noScript"),
        variant: "destructive",
      })
      return
    }

    // 检查已完成步骤
    const totalScenes = scriptData.scenes?.length || 0
    const completedCharacters = characterData.filter(c => c.imageUrl).length
    const totalCharacters = characterData.length || 0
    const completedStoryboards = storyboardImages.filter(s => s.imageUrl || s.url).length
    const completedSceneVideos = sceneVideos.filter(v => v.videoUrl).length

    console.log('[恢复继续] 步骤完成情况:', {
      totalScenes,
      totalCharacters,
      completedCharacters,
      completedStoryboards,
      completedSceneVideos,
      hasVideo: !!videoData?.url
    })

    // 检查是否有主角没有图片
    const hasCharacterWithoutImage = totalCharacters > 0 && completedCharacters < totalCharacters

    let nextStep: typeof workflowStep = 'character'

    // 判断下一步：按顺序检查每个步骤是否完成
    if (hasCharacterWithoutImage) {
      nextStep = 'character'
      console.log('[恢复继续] 下一步: 主角生成 (完成', completedCharacters, '/', totalCharacters, ')')
    } else if (completedStoryboards < totalScenes) {
      nextStep = 'storyboard'
      console.log('[恢复继续] 下一步: 分镜图生成 (完成', completedStoryboards, '/', totalScenes, ')')
    } else if (completedSceneVideos < totalScenes) {
      nextStep = 'scenes'
      console.log('[恢复继续] 下一步: 场景视频生成 (完成', completedSceneVideos, '/', totalScenes, ')')
    } else if (!videoData?.url) {
      nextStep = 'video'
      console.log('[恢复继续] 下一步: 最终视频生成')
    } else {
      console.log('[恢复继续] ✅ 所有步骤已完成，无需继续')
      toast({
        title: t("resume.alreadyCompleted"),
      })
      return
    }

    console.log('[恢复继续] 设置工作流步骤:', nextStep, '并开始生成')
    // 设置工作流状态并开始
    setWorkflowStep(nextStep)
    setIsGenerating(true)

    // 调用恢复继续生成函数
    handleResumeContinueGeneration()
  }

  // 监听 resumeProjectId 变化，恢复项目数据
  useEffect(() => {
    console.log('[恢复监听] resumeProjectId 变化检测:', {
      resumeProjectId: resumeProjectId,
      resumeVersionId: resumeVersionId,
      isGenerating: isGenerating,
      alreadyRestored: restoreProjectRef.current
    })
    if (resumeProjectId && !restoreProjectRef.current && !isGenerating) {
      console.log('[恢复监听] 开始恢复项目数据，projectId:', resumeProjectId, 'versionId:', resumeVersionId)
      restoreProjectRef.current = true
      restoreProjectData(resumeProjectId, resumeVersionId || undefined)
    } else if (!resumeProjectId) {
      console.log('[恢复监听] 无 resumeProjectId，跳过恢复')
      // 重置恢复状态
      restoreProjectRef.current = false
      setRestoredVersionHasVideo(false)
      setRestoredProjectCompleted(false)
    } else if (restoreProjectRef.current) {
      console.log('[恢复监听] 已恢复过，跳过')
    } else if (isGenerating) {
      console.log('[恢复监听] 正在生成中，跳过')
    }
  }, [resumeProjectId, resumeVersionId])

  // 恢复成功后，根据数据状态设置工作流
  useEffect(() => {
    // 只有当恢复过数据后才执行
    if (!restoreProjectRef.current) return
    if (!scriptData) return

    console.log('[恢复流程] useEffect 触发，数据状态检查:')
    console.log('[恢复流程] - scriptData:', scriptData?.scenes?.length, '个场景')
    console.log('[恢复流程] - characterData:', characterData.length, '个')
    console.log('[恢复流程] - storyboardImages:', storyboardImages.length, '个')
    console.log('[恢复流程] - sceneVideos:', sceneVideos.length, '个')
    console.log('[恢复流程] - videoData:', videoData?.url ? '有' : '无')

    // 检查已完成步骤，确定下一步
    const totalScenes = scriptData.scenes?.length || 0
    const totalCharacters = characterData.length || 0
    const completedCharacters = characterData.filter(c => c.imageUrl).length
    const completedStoryboards = storyboardImages.filter(s => s.imageUrl || s.url).length
    const completedSceneVideos = sceneVideos.filter(v => v.videoUrl).length

    console.log('[恢复流程] 完成情况:', {
      totalScenes,
      totalCharacters,
      completedCharacters,
      completedStoryboards,
      completedSceneVideos,
      hasVideo: !!videoData?.url
    })

    let nextStep: typeof workflowStep = 'character'

    // 检查是否有主角没有图片
    const hasCharacterWithoutImage = totalCharacters > 0 && completedCharacters < totalCharacters

    if (hasCharacterWithoutImage) {
      nextStep = 'character'
      console.log('[恢复流程] 判定: 需要生成主角 (', completedCharacters, '/', totalCharacters, ')')
    } else if (completedStoryboards < totalScenes) {
      nextStep = 'storyboard'
      console.log('[恢复流程] 判定: 需要生成分镜图 (', completedStoryboards, '/', totalScenes, ')')
    } else if (completedSceneVideos < totalScenes) {
      nextStep = 'scenes'
      console.log('[恢复流程] 判定: 需要生成场景视频 (', completedSceneVideos, '/', totalScenes, ')')
    } else if (!videoData?.url) {
      nextStep = 'video'
      console.log('[恢复流程] 判定: 需要生成最终视频')
    } else {
      // 全部完成
      nextStep = 'idle'
      console.log('[恢复流程] 判定: 全部完成')
    }

    console.log('[恢复流程] 设置工作流步骤:', nextStep)
    // 设置工作流步骤并隐藏输入框
    setWorkflowStep(nextStep)
    setShowInputBox(false)

    console.log('[恢复流程] ✅ 已根据数据状态设置工作流步骤:', nextStep)
  }, [scriptData, characterData, storyboardImages, sceneVideos, videoData])

  // 创建新项目
  const createProject = async () => {
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalPrompt: message,
          aspectRatio: aspectRatio,
          duration: duration,
          videoStyle: videoStyle !== 'auto' ? videoStyle : 'auto',
          videoModel: videoModel !== 'auto' ? videoModel : 'auto',
          generationMode: generationMode,
        }),
      })

      if (response.ok) {
        const result = await response.json()
        const newProjectId = result.data.id
        // 同步更新状态和 ref，确保立即可用
        setCurrentProjectId(newProjectId)
        currentProjectIdRef.current = newProjectId
        console.log('[createProject] 项目创建成功:', newProjectId)
        return newProjectId
      }
    } catch (error) {
      console.error('创建项目失败:', error)
    }
    return null
  }

  // 编辑状态
  const [isEditingCharacter, setIsEditingCharacter] = useState(false)
  const [editedCharacterData, setEditedCharacterData] = useState<CharacterItem | null>(null)
  const [isEditingSceneVideo, setIsEditingSceneVideo] = useState(false)
  const [editingSceneVideoIndex, setEditingSceneVideoIndex] = useState<number | null>(null)
  const [editedSceneVideoData, setEditedSceneVideoData] = useState<SceneVideoItem | null>(null)
  const [isEditingStoryboard, setIsEditingStoryboard] = useState(false)
  const [editingStoryboardIndex, setEditingStoryboardIndex] = useState<number | null>(null)
  const [editedStoryboardData, setEditedStoryboardData] = useState<StoryboardItem | null>(null)
  const [isRegeneratingStoryboard, setIsRegeneratingStoryboard] = useState<number | null>(null)
  const [isGeneratingScenePlot, setIsGeneratingScenePlot] = useState(false)
  const [isRegeneratingSceneVideo, setIsRegeneratingSceneVideo] = useState<number | null>(null)
  const [isRegeneratingCharacterId, setIsRegeneratingCharacterId] = useState<string | null>(null)
  const [showCharacterPreview, setShowCharacterPreview] = useState(false)
  const [showStoryboardPreview, setShowStoryboardPreview] = useState(false)
  const [showSceneVideoPreview, setShowSceneVideoPreview] = useState(false)
  const [characterImageFile, setCharacterImageFile] = useState<File | null>(null)
  // 追踪用户编辑模式：'none' | 'image' | 'prompt'（互斥）
  const [characterEditMode, setCharacterEditMode] = useState<'none' | 'image' | 'prompt'>('none')
  const characterImageInputRef = useRef<HTMLInputElement>(null)

  // ========== Pusher 实时推送（hooks/use-task-events.ts，行为与原来一致） ==========
  const { waitForGenerationResult, pendingTasksRef } = useTaskEvents()

  // 用于跟踪组件是否已挂载（断点续跑等待用）
  const isMountedRef = useRef(false)
  // 用于跟踪所有活跃的 waitForWorkflowResume 定时器
  const resumeCheckTimersRef = useRef<Set<NodeJS.Timeout>>(new Set())

  useEffect(() => {
    // 组件挂载时标记
    isMountedRef.current = true

    // 组件卸载时清理所有活跃的等待恢复检查定时器
    return () => {
      isMountedRef.current = false
      // 清理所有活跃的等待恢复检查定时器
      resumeCheckTimersRef.current.forEach(timer => {
        clearTimeout(timer)
      })
      resumeCheckTimersRef.current.clear()
    }
  }, [])

  // 追踪当前编辑会话的版本 ID：首次保存时由后端返回，后续复用
  const currentEditVersionId = useRef<string | null>(null)

  // 分镜图图片上传状态
  const [storyboardImageFile, setStoryboardImageFile] = useState<File | null>(null)
  const storyboardImageInputRef = useRef<HTMLInputElement>(null)
  // 追踪用户编辑模式：'none' | 'image' | 'prompt'（互斥）
  const [storyboardEditMode, setStoryboardEditMode] = useState<'none' | 'image' | 'prompt'>('none')

  // 图片上传状态
  const [isUploadingCharacterImage, setIsUploadingCharacterImage] = useState(false)
  const [isUploadingStoryboardImage, setIsUploadingStoryboardImage] = useState(false)

  // 下载状态（用于显示正在下载）
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null)

  // 下载/文件类型/存储用量外围（hooks/use-file-storage.ts，拆分 T10，函数体逐字搬移；getFileType 纯函数移入 components/operate/format.ts）
  const {
    handleDownloadFile,
    handleFileSizeExceeded,
    fetchStorageInfo,
    checkStorageAvailable,
    handleStorageLimitExceeded,
  } = useFileStorage({
    subscriptionPlan,
    setFileSizeLimitMB,
    setShowFileSizeLimitDialog,
    setStorageLimitInfo,
    setShowStorageLimitDialog,
    setDownloadingKey,
  })

  // 单个主角重新生成确认弹窗
  const [showRegenerateCharacterDialog, setShowRegenerateCharacterDialog] = useState(false)
  const [characterToRegenerate, setCharacterToRegenerate] = useState<any>(null)

  // 编辑主角保存确认弹窗
  const [showSaveEditCharacterDialog, setShowSaveEditCharacterDialog] = useState(false)

  // 分镜图重新生成确认弹窗
  const [showRegenerateStoryboardDialog, setShowRegenerateStoryboardDialog] = useState(false)
  const [storyboardToRegenerate, setStoryboardToRegenerate] = useState<number | null>(null)

  // 编辑分镜图保存确认弹窗
  const [showSaveEditStoryboardDialog, setShowSaveEditStoryboardDialog] = useState(false)

  // 剧情视频重新生成确认弹窗
  const [showRegenerateSceneVideoDialog, setShowRegenerateSceneVideoDialog] = useState(false)
  const [sceneVideoToRegenerate, setSceneVideoToRegenerate] = useState<number | null>(null)

  // 重新生成全部剧情确认弹窗
  const [showRegenerateScriptDialog, setShowRegenerateScriptDialog] = useState(false)

  // 编辑剧情视频保存确认弹窗
  const [showSaveEditSceneVideoDialog, setShowSaveEditSceneVideoDialog] = useState(false)

  // 控制输入框显示
  const [showInputBox, setShowInputBox] = useState(true)

  // 辅助函数：等待工作流继续（处理暂停状态）
  const waitForWorkflowResume = () => {
    return new Promise<void>((resolve) => {
      // 用于跟踪这个 Promise 相关的所有定时器
      const timers: NodeJS.Timeout[] = []
      
      const cleanup = () => {
        // 清理所有相关的定时器
        timers.forEach(timer => {
          clearTimeout(timer)
          resumeCheckTimersRef.current.delete(timer)
        })
        timers.length = 0
      }

      console.log('检查工作流暂停状态:', workflowPausedRef.current)
      if (!workflowPausedRef.current) {
        console.log('工作流未暂停，继续执行')
        resolve()
        return
      }

      // 如果组件已卸载，立即 resolve，不再等待
      if (!isMountedRef.current) {
        console.log('组件已卸载，停止等待工作流恢复')
        resolve()
        return
      }

      console.log('工作流已暂停，等待继续...')
      const checkResume = () => {
        // 检查组件是否已卸载
        if (!isMountedRef.current) {
          console.log('组件已卸载，停止等待工作流恢复')
          cleanup()
          resolve()
          return
        }

        console.log('重新检查暂停状态:', workflowPausedRef.current)
        if (!workflowPausedRef.current) {
          console.log('工作流继续')
          cleanup()
          resolve()
        } else {
          const timer = setTimeout(checkResume, 100) // 每100ms检查一次
          // 记录定时器，以便清理
          timers.push(timer)
          resumeCheckTimersRef.current.add(timer)
        }
      }
      const initialTimer = setTimeout(checkResume, 100)
      timers.push(initialTimer)
      resumeCheckTimersRef.current.add(initialTimer)
    })
  }

  // 通用函数：生成单个剧情视频并更新状态（含 Pusher 处理）
  const generateSceneVideoForScene = async (params: {
    scene: StoryScene
    sceneIndex: number
    storyboardImage?: StoryboardItem
    aspectRatio: string
    consolePrefix: string
    versionId?: string
    versionGroupId?: string
  }): Promise<SceneVideoItem> => {
    const { scene, sceneIndex, storyboardImage, aspectRatio, consolePrefix } = params
    const versionGroupId = params.versionGroupId || versionGroupIdRef.current

    const basePrompt = String(scene.sceneVideoPrompt ?? '') || String(scene.plot ?? '') || String(scene.description ?? '') || t('noPlotDescription')
    const logPrefix = `${consolePrefix} 剧情视频 ${sceneIndex + 1}`

    const storyboardUrl = storyboardImage?.url
    const lastFrameUrl = storyboardImage?.lastFrameUrl || null
    console.log(`${logPrefix} - storyboardUrl:`, storyboardUrl, '- lastFrameUrl:', lastFrameUrl)

    if (!storyboardUrl) {
      const emptyResult = {
        videoUrl: '',
        sceneId: scene.id,
        sceneIndex,
        storyboardImage,
        prompt: basePrompt,
        error: t('missingStoryboard'),
      }

      // 实时更新：即使失败也要显示
      setSceneVideos((prev: any[]) => {
        const newItems = [...prev]
        newItems[sceneIndex] = emptyResult
        return newItems
      })

      return emptyResult
    }

    // 构建视频生成请求体
    const videoRequestBody: Record<string, unknown> = {
      imageUrl: storyboardUrl,
      prompt: basePrompt,
      aspectRatio,
      duration: scene.duration,
      videoStyle: videoStyle !== 'auto' ? videoStyle : undefined,
      videoModel: videoModel !== 'auto' ? videoModel : undefined,
      // 分辨率偏好仅在模型声明支持该档时被服务端采纳
      resolution: VIDEO_MODEL_RESOLUTIONS[videoModel]?.includes(videoResolution) ? videoResolution : undefined,
      projectId: currentProjectIdRef.current,
      sceneIndex,
      sceneId: scene.id,
      versionId: params.versionId || currentEditVersionId.current || undefined,
      versionGroupId: versionGroupId || undefined,
    }

    // 如果有尾帧图片（首尾帧模式），添加尾帧 URL
    if (lastFrameUrl) {
      videoRequestBody.additionalImageUrls = [lastFrameUrl]
    }

    // Seedance 2.0 多模态参考：把上传的视频/音频传过去
    if (videoUrls.length > 0) {
      videoRequestBody.videoUrls = videoUrls
    }
    if (audioUrls.length > 0) {
      videoRequestBody.audioUrls = audioUrls
    }

    const sceneResponse = await fetch('/api/ai/generate-story-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(videoRequestBody),
      signal: abortControllerRef.current?.signal,
    })

    // 先检查响应状态，再解析 JSON
    if (!sceneResponse.ok) {
      let errorText = ''
      try {
        errorText = await sceneResponse.text()
        // 积分不足是可预期的业务错误，不打印 error 级别日志
        const parsedData = errorText ? JSON.parse(errorText) : {}
        const isPointsInsufficient = parsedData.code === 'INSUFFICIENT_POINTS' || (parsedData.error && parsedData.error.includes('积分不足'))
        if (isPointsInsufficient) {
          console.warn(`${logPrefix} 积分不足，跳过生成`)
        } else {
          console.error(`${logPrefix} API 失败:`, sceneResponse.status, errorText)
        }
      } catch (e) {
        // 如果不是 JSON，使用原始文本
        errorText = `HTTP ${sceneResponse.status}`
        console.error(`${logPrefix} API 失败:`, sceneResponse.status)
      }
      let errorData: { code?: string; error?: string | null; errorKey?: string; currentPoints?: number } = {}
      try {
        errorData = errorText ? (JSON.parse(errorText) as { code?: string; error?: string | null; errorKey?: string; currentPoints?: number }) : {}
      } catch (e) {
        errorData = { error: errorText }
      }

      // 免费用户视频能力锁：验卡（免费一部成片）或升级（2026-08-30 定价重构 §4.2）
      if (sceneResponse.status === 403 && errorData.errorKey === 'upgrade_required') {
        setPurchaseDialogType('card_verify')
        setShowPurchaseDialog(true)

        workflowPausedRef.current = true
        setWorkflowPaused(true)
        workflowInterruptedRef.current = true

        const errorMessage = t('videoLockedDesc')
        const errorResult = {
          videoUrl: '',
          sceneId: scene.id,
          sceneIndex,
          storyboardImage,
          prompt: basePrompt,
          error: errorMessage,
          code: 'UPGRADE_REQUIRED'
        }
        setSceneVideos((prev: any[]) => {
          const newItems = [...prev]
          newItems[sceneIndex] = errorResult
          return newItems
        })

        return errorResult
      }

      // 检查是否是积分不足错误（只有在响应体非空时才检查）
      if ((errorData.code === 'INSUFFICIENT_POINTS' || (errorData.error && errorData.error.includes('积分不足'))) && errorText) {
        setCurrentPoints(errorData.currentPoints || 0)
        setPurchaseDialogType('points')
        setShowPurchaseDialog(true)
        const errorMessage = t("pointsInsufficientDesc", { points: errorData.currentPoints || 0 })
        
        // 立即暂停工作流
        workflowPausedRef.current = true
        setWorkflowPaused(true)
        workflowInterruptedRef.current = true // 标记工作流被中断，以便后续可以继续
        
        const errorResult = {
          videoUrl: '',
          sceneId: scene.id,
          sceneIndex,
          storyboardImage,
          prompt: basePrompt,
          error: errorMessage,
          code: 'INSUFFICIENT_POINTS'
        }

        // 实时更新错误状态
        setSceneVideos((prev: any[]) => {
          const newItems = [...prev]
          newItems[sceneIndex] = errorResult
          return newItems
        })

        return errorResult
      }
      
      const errorMessage = errorData.error || t('generationFailed') + ` (status ${sceneResponse.status})`

      const errorResult = {
        videoUrl: '',
        sceneId: scene.id,
        sceneIndex,
        storyboardImage,
        prompt: basePrompt,
        error: errorMessage,
      }

      // 实时更新错误状态
      setSceneVideos((prev: any[]) => {
        const newItems = [...prev]
        newItems[sceneIndex] = errorResult
        return newItems
      })

      return errorResult
    }

    const sceneResult = await sceneResponse.json()

    // 如果返回结果本身带 error 字段，直接按错误处理
    if (sceneResult && sceneResult.error) {
      // 检查是否是积分不足错误
      if (sceneResult.code === 'INSUFFICIENT_POINTS' || sceneResult.error?.includes('积分不足')) {
        setCurrentPoints(sceneResult.currentPoints || 0)
        setPurchaseDialogType('points')
        setShowPurchaseDialog(true)
        
        // 立即暂停工作流
        workflowPausedRef.current = true
        setWorkflowPaused(true)
        workflowInterruptedRef.current = true // 标记工作流被中断，以便后续可以继续
      }

      const errorResult = {
        ...(sceneResult.data || {}),
        videoUrl: '',
        sceneId: scene.id,
        sceneIndex,
        storyboardImage,
        prompt: sceneResult.data?.prompt || basePrompt,
        error: sceneResult.error,
        code: sceneResult.code
      }

      setSceneVideos((prev: any[]) => {
        const newItems = [...prev]
        newItems[sceneIndex] = errorResult
        return newItems
      })

      return errorResult
    }

    console.log(
      `${logPrefix} - raw response:`,
      (() => {
        try {
          return JSON.stringify(sceneResult, null, 2)
        } catch {
          return sceneResult
        }
      })()
    )

    // ========== Pusher 模式处理 ==========
    let videoUrl = sceneResult.data?.videoUrl || sceneResult.data?.url

    if (sceneResult.data?.requestId && !videoUrl) {
      console.log(`${logPrefix} 使用 Pusher 模式:`, {
        requestId: sceneResult.data.requestId,
      })

      try {
        const pusherData = await waitForGenerationResult({
          taskId: sceneResult.data.requestId,
          type: 'video',
          timeoutMs: 900000, // 10分钟超时
        })

        // 检查是否有错误（onFail 会 resolve 包含 error 的数据）
        if (pusherData?.error) {
          const errorResult = {
            ...(sceneResult.data || {}),
            videoUrl: '',
            sceneId: scene.id,
            sceneIndex,
            storyboardImage,
            requestId: sceneResult.data.requestId,
            error: pusherData.error,
            prompt: sceneResult.data?.prompt || basePrompt,
          }

          // 实时更新错误状态
          setSceneVideos((prev: any[]) => {
            const newItems = [...prev]
            newItems[sceneIndex] = errorResult
            return newItems
          })

          return errorResult
        }

        videoUrl = String(pusherData.videoUrl || pusherData.resultUrls?.[0] || '')
        console.log(`${logPrefix} Pusher 结果:`, videoUrl)
      } catch (pusherError) {
        console.error(`${logPrefix} Pusher 等待失败:`, pusherError)

        const errorMessage = pusherError instanceof Error ? pusherError.message : String(pusherError)
        // 超时不显示错误，任务可能还在后台处理
        if (errorMessage.includes('等待生成结果超时')) {
          return {
            videoUrl: '',
            sceneId: scene.id,
            sceneIndex,
            storyboardImage,
            requestId: sceneResult.data?.requestId,
            prompt: sceneResult.data?.prompt || basePrompt,
            error: undefined,
          }
        }

        const errorResult = {
          ...(sceneResult.data || {}),
          videoUrl: '',
          sceneId: scene.id,
          sceneIndex,
          storyboardImage,
          requestId: sceneResult.data.requestId,
          error: String(pusherError),
          prompt: sceneResult.data?.prompt || basePrompt,
        }

        setSceneVideos((prev: any[]) => {
          const newItems = [...prev]
          newItems[sceneIndex] = errorResult
          return newItems
        })

        return errorResult
      }
    }

    const videoItem = {
      ...(sceneResult.data || {}),
      videoUrl: videoUrl || '',
      sceneId: scene.id,
      sceneIndex,
      storyboardImage,
      prompt: sceneResult.data?.prompt || basePrompt,
    }

    // ========== 实时更新：每成功生成一个剧情视频就立即更新状态 ==========
    setSceneVideos((prev: any[]) => {
      const newItems = [...prev]
      newItems[sceneIndex] = {
        ...videoItem,
        error: undefined, // 清除错误
      }
      return newItems
    })
    console.log(`${logPrefix} 已更新显示`)
    // ========== 实时更新结束 ==========

    return videoItem
  } 

  // 使用 FAL AI 生成完整视频（通用函数）
  const composeSceneVideosWithFAL = async (sceneVideosToCompose: SceneVideoItem[], scriptDataForCompose?: ScriptData | null, abortSignal?: AbortSignal, projectId?: string,  versionId?: string, versionGroupId?: string): Promise<ComposedVideoResult | null> => {
    // 过滤掉生成失败的视频
    const validSceneVideos = sceneVideosToCompose.filter((sceneVideo: SceneVideoItem) =>
      sceneVideo.videoUrl && typeof sceneVideo.videoUrl === 'string' && sceneVideo.videoUrl.trim().length > 0
    )

    if (validSceneVideos.length === 0) {
      return null
    }

    // 读取所有视频的实际时长（秒），失败时使用 API 返回的时长
    const videoDurations = await getAllVideoDurations(validSceneVideos, {
      cannotReadVideoDuration: t('cannotReadVideoDuration'),
      videoLoadFailed: t('videoLoadFailed'),
      videoLoadTimeout: t('videoLoadTimeout'),
    }) // 单位：秒

    // 计算每个视频的时间戳（毫秒）和总时长（秒）
    let currentTimestamp = 0 // 当前时间戳（毫秒）
    const keyframes = validSceneVideos.map((sceneVideo: any, index: number) => {
      const durationInSeconds = videoDurations[index] // 秒
      const durationInMs = Math.round(durationInSeconds * 1000) // 转换为毫秒
      const timestamp = currentTimestamp
      currentTimestamp += durationInMs
      return {
        timestamp,
        duration: durationInMs,
        url: sceneVideo.videoUrl
      }
    })

    // 计算总时长（秒）
    const totalDuration = Math.round(videoDurations.reduce((acc, duration) => acc + duration, 0))

    // 使用 FAL AI 生成完整视频（webhook 模式）
    const effectiveVersionGroupId = versionGroupId || versionGroupIdRef.current
    const composeResponse = await fetch('/api/ai/fal/compose-story-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        versionId: versionId || currentEditVersionId.current || undefined,
        versionGroupId: effectiveVersionGroupId || undefined,
        resolution: VIDEO_MODEL_RESOLUTIONS[videoModel]?.includes(videoResolution) ? videoResolution : undefined,
        tracks: [
          {
            id: 'main_video',
            type: 'video',
            keyframes: keyframes
          },
          // 音频轨道：每个视频自带的音频
          {
            id: 'main_audio',
            type: 'audio',
            keyframes: keyframes.map(kf => ({
              timestamp: kf.timestamp,
              duration: kf.duration,
              url: kf.url
            }))
          }
        ]
      }),
      signal: abortSignal
    })

    const composeResult = await composeResponse.json()

    if (!composeResponse.ok) {
      // 如果是权限问题（Forbidden），返回空数据而不是报错
      if (composeResponse.status === 403) {
        console.warn('[composeStoryVideo] 权限不足，跳过合成')
        return {
          url: '',
          thumbnailUrl: '',
          duration: totalDuration,
          aspectRatio: '16:9',
          fileSize: t('unknown'),
          prompt: t("videoPrompt", { count: validSceneVideos.length })
        }
      }
      throw new Error(composeResult.error || t('videoComposeFailed'))
    }

    // ========== Pusher 模式等待 ==========
    if (composeResult.requestId) {
      console.log('[composeStoryVideo] 使用 Pusher 模式等待合成结果:', composeResult.requestId)

      try {
        const pusherData = await waitForGenerationResult({
          taskId: composeResult.requestId,
          type: 'compose',
          timeoutMs: 900000, // FAL 合成可能需要更长时间
        })

        // 失败处理
        if (pusherData?.error) {
          throw new Error(pusherData.error || t('videoComposeFailed'))
        }

        const videoData: ComposedVideoResult = {
          url: String(pusherData?.videoUrl || ''),
          thumbnailUrl: String(pusherData?.thumbnailUrl || ''),
          duration: pusherData?.duration || totalDuration,
          aspectRatio: String(pusherData?.aspectRatio || '16:9'),
          fileSize: pusherData?.fileSize || t('unknown'),
          prompt: t("videoPrompt", { count: validSceneVideos.length })
        }

        console.log('[composeStoryVideo] Pusher 完成:', videoData.url ? videoData.url.substring(0, 80) : '')
        return videoData
      } catch (pusherError) {
        console.error('[composeStoryVideo] Pusher 等待失败:', pusherError)
        throw pusherError
      }
    }

    // 兜底：直接返回（理论上不会走到这里，因为 API 已改为 webhook 模式）
    return {
      url: '',
      thumbnailUrl: '',
      duration: totalDuration,
      aspectRatio: '16:9',
      fileSize: t('unknown'),
      prompt: t("videoPrompt", { count: validSceneVideos.length })
    }
  }

  // 五步骤工作流：生成剧情 → 生成主角 → 生成分镜图 → 生成剧情视频 → 生成完整视频
  const handleSend = async () => {
    // 登录验证
    if (status !== 'authenticated') {
      setIsSignInDialogOpen(true)
      return
    }

    // 上传视频/音频时，强制只能使用 seedance2 / seedance2Fast / seedance2Mini（前端检测，后端不重复）
    const mediaItems = uploadingItems.filter(
      (it) => it.type === "video" || it.type === "audio",
    )
    const hasMedia = mediaItems.length > 0
    if (hasMedia && !MEDIA_COMPATIBLE_VIDEO_MODELS.includes(videoModel)) {
      toast({
        title: t("videoModelMediaLockedTitle"),
        description: t("videoModelMediaLockedHint"),
        variant: "destructive",
      })
      // 自动帮用户切到 seedance2Fast
      setVideoModel("seedance2Fast")
      setShowSettingsPopover(true)
      return
    }

    // 上传视频/音频时，校验每个文件是否符合 Seedance 约束
    if (hasMedia) {
      const mediaCheck = await validateSeedanceMedia(mediaItems, t)
      if (!mediaCheck.ok) {
        setMediaValidationMessage(mediaCheck.message)
        setShowMediaValidationDialog(true)
        return
      }
    }

    // 如果是因为积分不足导致的暂停，并且工作流已经被中断过，从中断处继续
    if (workflowPausedRef.current && workflowInterruptedRef.current && workflowStep !== 'idle') {
      console.log('检测到积分不足导致的暂停，从中断处继续工作流')
      // 恢复暂停状态
      workflowPausedRef.current = false
      setWorkflowPaused(false)
      // 从中断处继续
      await resumeWorkflow()
      return
    }

    if (!message.trim()) {
      return
    }

    // 隐藏输入框
    setShowInputBox(false)

    // 重置工作流状态
    setScriptData(null)
    setCharacterData([])
    setStoryboardImages([])
    setSceneVideos([])
    setVideoData(null)
    setWorkflowError(null)
    setIsGenerating(true)

    // 立即显示工作流，不等待项目创建
    setWorkflowStep('script')
    setWorkflowLoading(true)

    // 创建新项目（后台执行，不阻塞工作流显示）
    const projectId = await createProject()
    if (!projectId) {
      toast({
        title: t("createProjectFailed"),
        description: t("retryLater"),
        variant: "destructive",
      })
      setIsGenerating(false)
      setWorkflowLoading(false)
      setWorkflowStep('idle')
      return
    }

    try {
      // 步骤1: 生成剧情（工作流已经在上面显示了）

      // 创建 AbortController 用于暂停
      abortControllerRef.current = new AbortController()

      const scriptResponse = await fetch('/api/ai/generate-story-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: message,
          duration: duration !== 'auto' ? Number(duration) : undefined,  // 传递用户选择的时长
          videoModel: videoModel !== 'auto' ? videoModel : undefined,  // 传递视频模型
          videoStyle: videoStyle !== 'auto' ? videoStyle : undefined,  // 传递用户选择的视频风格
          projectId: projectId,  // 传递项目 ID
          userImages: imageUrls, // 传递用户上传的图片URL数组（用于图生图识别）
        }),
        signal: abortControllerRef.current.signal
      })

      const scriptResult = await scriptResponse.json()
      console.debug('generate-story scriptResult:', scriptResult)
      console.log('[handleSend] 用户选择的时长:', duration)
      console.log('[handleSend] 剧情返回的 scenes:', scriptResult.data?.scenes?.map((s: any) => ({
        id: s.id,
        title: s.title,
        duration: s.duration,
        description: s.description?.substring(0, 50) + '...'
      })))

      // 检查是否是积分不足错误
      if (scriptResult.code === 'INSUFFICIENT_POINTS' || scriptResult.error?.includes('积分不足')) {
        setCurrentPoints(scriptResult.currentPoints || 0)
        setPurchaseDialogType('points')
        setShowPurchaseDialog(true)
        workflowPausedRef.current = true
        setWorkflowPaused(true)
        workflowInterruptedRef.current = true // 标记工作流被中断，以便后续可以继续
        setIsGenerating(false)
        setWorkflowLoading(false)
        return
      }

      if (!scriptResponse.ok) {
        throw new Error(scriptResult.error || t('scriptGenerationFailed'))
      }

      // 保存版本 ID，后续生成主角/分镜图/剧情视频时需要
      if (scriptResult.version) {
        currentEditVersionId.current = String(scriptResult.version)
        console.log('[handleSend] 设置版本 ID:', currentEditVersionId.current)
      }

      // 解析模型输出：优先尝试 scriptResult.output（文本形式的 JSON）
      let parsedScriptData: any = null

      if (scriptResult.output && typeof scriptResult.output === 'string') {
        const parsed = tryParsePossiblyMalformedJson(scriptResult.output)
        if (parsed !== null) {
          parsedScriptData = parsed
        } else {
          console.error('parse scriptResult.output failed: invalid JSON, falling back to raw', { output: scriptResult.output })
          // fallback: 如果 output 不是严格 JSON，尝试使用 raw 字段或整个结果
          parsedScriptData = scriptResult.raw ?? scriptResult.output
        }
      } else if (scriptResult.data) {
        parsedScriptData = scriptResult.data
      } else {
        parsedScriptData = scriptResult
      }

      // 将解析后的数据映射到 UI 所需结构，并填充到相应区域（剧情、主角、分镜等）
      const mapToUiScriptData = (data: any) => {
        console.log('[mapToUiScriptData] 原始数据中的 scenes:', data?.scenes?.map((s: any) => ({
          id: s.id,
          duration: s.duration,
          seconds: s.seconds
        })))
        
        const scenes = Array.isArray(data.scenes) ? data.scenes.map((s: any, idx: number) => {
          const sceneDuration = Number(s.duration ?? s.seconds ?? 5)
          return {
            id: s.id ?? idx + 1,
            title: s.title ?? t("scriptTitleDefault", { index: idx + 1 }),
            plot: s.description ?? s.plot ?? s.plotText ?? '',
            duration: sceneDuration,
            aspectRatio: s.aspectRatio ?? data.aspectRatio ?? aspectRatio,
            storyboardPrompt: s.storyboardPrompt ?? '',
            sceneVideoPrompt: s.sceneVideoPrompt ?? '',
            visualElements: Array.isArray(s.visualElements) ? s.visualElements : (s.visuals ? s.visuals : []),
            characterIds: Array.isArray(s.characterIds) ? s.characterIds : [],
            storyboardCharacterImages: Array.isArray(s.storyboardCharacterImages) ? s.storyboardCharacterImages : [],
            firstFramePrompt: s.firstFramePrompt ?? s.first_framePrompt ?? '',
            lastFramePrompt: s.lastFramePrompt ?? s.last_framePrompt ?? '',
          }
        }) : []

        console.log('[mapToUiScriptData] 解析后的 scenes:', scenes.map((s: any) => ({ id: s.id, duration: s.duration })))
        
        const characters = Array.isArray(data.characters) ? data.characters.map((c: any) => {
          const inferredPrompt = c.generationPrompt ?? c.prompt ?? c.generation_prompt ?? (c.description ? `realistic portrait, mid-shot, soft key light, ${c.description}` : `realistic portrait, mid-shot, soft key light, ${c.name ?? 'character'}`)
          return {
            id: c.id ?? String(c.name ?? `char_${Math.random().toString(36).slice(2,8)}`),
            name: c.name ?? c.id ?? t("characterTitle"),
            role: c.role ?? c.roleLabel ?? 'protagonist',
            description: c.description ?? c.desc ?? c.summary ?? '',
            // provide both generationPrompt and prompt alias so editor and generators can use either
            generationPrompt: inferredPrompt,
            prompt: inferredPrompt,
            imageUrl: c.imageUrl ?? c.image_url ?? '',
            thumbnailUrl: c.thumbnailUrl ?? c.thumbnail_url ?? '',
            personality: c.personality ?? '',
            appearance: c.appearance ?? ''
          }
        }) : []

        const title = data.title ?? data.summary ?? ''
        const aspect = data.aspectRatio ?? aspectRatio
        const totalDuration = scenes.reduce((sum: number, s: any) => sum + (Number(s.duration) || 0), 0)

        console.log('[mapToUiScriptData] 计算的总时长:', totalDuration, '秒')

        return {
          title,
          aspectRatio: aspect,
          totalDuration,
          scenes,
          characters,
          raw: data
        }
      }

      const uiScript = mapToUiScriptData(parsedScriptData)
      setScriptData(uiScript)

      // 填充主角区域
      setCharacterData(uiScript.characters)

      // 清空/重置分镜与场景视频为初始状态（由后续步骤填充）
      setStoryboardImages([])
      setSceneVideos([])
      // 若模型返回了 imageUrl，可以预先填充 storyboardCharacterImages 或其他字段（已包含在 scenes）
      setWorkflowLoading(false)

      // 检查是否暂停
      await waitForWorkflowResume()

      // 步骤2: 生成主角
      let mergedChars: any[] = [] 
      if (!characterData || characterData.length === 0) {
        setWorkflowStep('character')
        setWorkflowLoading(true)

        // 创建 AbortController 用于暂停
        abortControllerRef.current = new AbortController()

        // 准备调用正式主角图生成功能：/api/ai/generate-character-image
        const allChars = (uiScript && Array.isArray(uiScript.characters) && uiScript.characters.length > 0)
          ? uiScript.characters
          : [{ id: 'char_default', name: t("characterTitle"), generationPrompt: `realistic portrait, mid-shot, soft key light, ${uiScript?.title || 'protagonist'}` }]

        // 与分镜图/剧情视频保持一致：在步骤中并行调用“单个主角通用函数”
        const characterPromises = allChars.map((c: any) =>
          generateCharacterForSingle({
            character: c,
            allCharactersSnapshot: allChars,
            consolePrefix: '[operate]',
            versionId: currentEditVersionId.current || undefined,
          })
        )
        const characterResults = await Promise.all(characterPromises)
        mergedChars = mergeCharactersFromResults(allChars, characterResults, '[operate]')

        setCharacterData(mergedChars)

        setWorkflowLoading(false)

        // 检查是否暂停
        await waitForWorkflowResume()
      }

      // 步骤3: 生成分镜图
      let storyboardResults: any[] = []
      if (storyboardImages.length === 0) {
        setWorkflowStep('storyboard')
        setWorkflowLoading(true)

        // 创建 AbortController 用于暂停
        abortControllerRef.current = new AbortController()

        const storyboardPromises = scriptResult.data.scenes.map(async (scene: any, index: number) => {
          // 根据场景的 characterIds 筛选角色，确保只传递该场景实际出现的角色
          const sceneCharacterIds = (scene.characterIds && scene.characterIds.length > 0) ? scene.characterIds : []
          console.log(`[handleSend] 分镜图 ${index + 1} - sceneCharacterIds:`, sceneCharacterIds)

          // 使用已生成的 mergedChars 主角数据，而不是依赖 characterData state
          const mergedCharacterData = mergedChars
          console.log(`[handleSend] 分镜图 ${index + 1} - mergedCharacterData count:`, mergedCharacterData.length)

          // 只筛选出场景中实际出现的角色，如果没有指定角色则不传递任何主角
          const relevantCharacters = sceneCharacterIds.length > 0
            ? mergedCharacterData.filter((char: any) => sceneCharacterIds.includes(char.id))
            : []

          console.log(`[handleSend] 分镜图 ${index + 1} - relevantCharacters:`, relevantCharacters.map((c: any) => ({ id: c.id, imageUrl: c.imageUrl })))

          // 构建角色图片数组，包含 imageUrl 和 imagePrompt
          const characterImages = relevantCharacters.length > 0
            ? relevantCharacters.map((char: any) => ({
                characterId: char.id,
                imageUrl: char.imageUrl,
                imagePrompt: char.generationPrompt || char.prompt || char.description || ''
              }))
            : []

          console.log(`[handleSend] 分镜图 ${index + 1} - characterImages:`, characterImages)

          return await generateStoryboardForScene({
            scene,
            sceneIndex: index,
            aspectRatio,
            characterImages,
            consolePrefix: '[handleSend]',
            versionId: currentEditVersionId.current || undefined,
            itemId: scene.id,
          })
        })

        // 等待所有分镜图处理完成（错误不会中断流程）
        storyboardResults = await Promise.all(storyboardPromises)
        console.log('[handleSend] 分镜图全部处理完成:', storyboardResults.map(sb => ({ url: sb?.url, sceneIndex: sb?.sceneIndex, error: sb?.error })))

        // 最终统一更新一次分镜图数组（中途已实时更新）
        setStoryboardImages(storyboardResults)

        setWorkflowLoading(false)

        // 检查是否暂停
        await waitForWorkflowResume()
      }

      if (storyboardImages.length > 0) {
        storyboardResults = storyboardImages
      }

      // 步骤4: 生成剧情视频
      let sceneVideosResults: any[] = []
      if (sceneVideos.length === 0) {
        setWorkflowStep('scenes')
        setWorkflowLoading(true)

        // 创建 AbortController 用于暂停
        abortControllerRef.current = new AbortController()

        const sceneVideosPromises = scriptResult.data.scenes.map(
          async (scene: any, index: number) => {
            const storyboardImage = storyboardResults[index]

            return await generateSceneVideoForScene({
              scene,
              sceneIndex: index,
              storyboardImage,
              aspectRatio,
              consolePrefix: '[handleSend]',
              versionId: currentEditVersionId.current || undefined,
            })
          }
        )

        // 等待所有剧情视频处理完成
        sceneVideosResults = await Promise.all(sceneVideosPromises)
        console.log(
          '[handleSend] 剧情视频全部处理完成:',
          sceneVideosResults.map((v, i) => ({
            videoUrl: v?.videoUrl,
            sceneIndex: i,
            error: v?.error,
          }))
        )

        setWorkflowLoading(false)

        // 检查是否暂停
        await waitForWorkflowResume()
      }

      // 步骤5: 生成完整视频
      if (!videoData) {
        setWorkflowStep('video')
        setWorkflowLoading(true)

        // 创建 AbortController 用于暂停
        abortControllerRef.current = new AbortController()

        // 使用通用函数生成完整视频
        const composedVideoData = await composeSceneVideosWithFAL(
          sceneVideosResults,
          scriptResult.data,
          abortControllerRef.current?.signal,
          projectId || undefined,
          currentEditVersionId.current || undefined
        )

        if (!composedVideoData) {
          setWorkflowLoading(false)
          toast({
            title: t("videoComposeSkipped"),
            description: t("noValidSceneVideosSkipFinal"),
          })
          setIsGenerating(false)
        } else {
          setVideoData(composedVideoData)

          setWorkflowLoading(false)

          toast({
            title: t("videoGeneratedSuccess"),
            description: t("videoReady"),
          })

          // 工作流完成，设置生成状态为 false
          setIsGenerating(false)
        }
      }

    } catch (error) {
      // 如果是用户主动取消（暂停），设置中断标志
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('工作流被用户暂停')
        workflowInterruptedRef.current = true
        // 暂停时不设置 isGenerating 为 false，保持暂停按钮可见
        setWorkflowLoading(false)
        abortControllerRef.current = null
        return
      }

      console.error('工作流错误:', error)
      setWorkflowError(error instanceof Error ? error.message : t('generationFailed'))
      toast({
        title: t("generationFailed"),
        description: error instanceof Error ? error.message : t("retryLater"),
        variant: "destructive",
      })

      // 只有在真正出错时才设置 isGenerating 为 false
      setIsGenerating(false)
      setWorkflowLoading(false)
      abortControllerRef.current = null
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // 显示重新生成全部剧情确认弹窗
  const handleShowRegenerateScriptDialog = () => {
    setShowRegenerateScriptDialog(true)
  }

  // 执行重新生成全部剧情
  const handleConfirmRegenerateScript = async () => {
    setShowRegenerateScriptDialog(false)
    await handleRegenerateScript()
  }

  // 重新生成脚本
  const handleRegenerateScript = async () => {
    setIsGenerating(true)
    setScriptData(null)
    setCharacterData([])
    setStoryboardImages([])
    setSceneVideos([])
    setVideoData(null)
    setWorkflowError(null)

    // 如果当前是暂停状态，重新生成脚本时自动恢复工作流
    if (workflowPausedRef.current) {
      workflowPausedRef.current = false
      setWorkflowPaused(false)
      workflowInterruptedRef.current = false
    }

    // 立即显示工作流
    setWorkflowStep('script')
    setWorkflowLoading(true)

    // 生成版本组ID（用于关联同一批次的重新生成任务）
    const vgId = generateVersionGroupId()

    try {
      // 步骤1: 生成剧情（工作流已经在上面显示了）

      // 创建 AbortController 用于暂停（与第一次生成一致）
      abortControllerRef.current = new AbortController()

      // 调用正式剧情生成 API
      const scriptResponse = await fetch('/api/ai/generate-story-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: message,
          duration: duration !== 'auto' ? Number(duration) : undefined,  // 传递用户选择的时长
          videoModel: videoModel !== 'auto' ? videoModel : undefined,  // 传递视频模型
          videoStyle: videoStyle !== 'auto' ? videoStyle : undefined,  // 传递用户选择的视频风格
          projectId: currentProjectIdRef.current || undefined,  // 传递项目 ID
          versionGroupId: vgId,  // 传递版本组 ID
        }),
        signal: abortControllerRef.current?.signal
      })

      const scriptResult = await scriptResponse.json()
      console.debug('regenerate-script scriptResult:', scriptResult)

      // 检查是否是积分不足错误（与第一次生成一致）
      if (scriptResult.code === 'INSUFFICIENT_POINTS' || scriptResult.error?.includes('积分不足')) {
        setCurrentPoints(scriptResult.currentPoints || 0)
        setPurchaseDialogType('points')
        setShowPurchaseDialog(true)
        workflowPausedRef.current = true
        setWorkflowPaused(true)
        workflowInterruptedRef.current = true // 标记工作流被中断，以便后续可以继续
        setIsGenerating(false)
        setWorkflowLoading(false)
        return
      }

      if (!scriptResponse.ok) {
        throw new Error(scriptResult.error || t('scriptGenerationFailed'))
      }

      // 保存版本 ID，后续生成主角/分镜图/剧情视频时需要
      if (scriptResult.version) {
        currentEditVersionId.current = String(scriptResult.version)
        console.log('[handleRegenerateScript] 设置版本 ID:', currentEditVersionId.current)
      }

      // 解析返回：兼容 data 对象或 output 文本
      const parsedScriptData: any = null

      // 映射并填入 UI
      const mapToUiScriptData = (data: any) => {
        console.log('[mapToUiScriptData-regenerate] 原始 scenes:', data?.scenes?.map((s: any) => ({
          id: s.id,
          duration: s.duration
        })))
        
        const scenes = Array.isArray(data.scenes) ? data.scenes.map((s: any, idx: number) => {
          return {
            id: s.id ?? idx + 1,
            title: s.title ?? t("scriptTitleDefault", { index: idx + 1 }),
            plot: s.description ?? s.plot ?? s.plotText ?? '',
            duration: Number(s.duration ?? s.seconds ?? 5),
            aspectRatio: s.aspectRatio ?? data.aspectRatio ?? aspectRatio,
            storyboardPrompt: s.storyboardPrompt ?? '',
            sceneVideoPrompt: s.sceneVideoPrompt ?? '',
            visualElements: Array.isArray(s.visualElements) ? s.visualElements : (s.visuals ? s.visuals : []),
            characterIds: Array.isArray(s.characterIds) ? s.characterIds : [],
            storyboardCharacterImages: Array.isArray(s.storyboardCharacterImages) ? s.storyboardCharacterImages : []
          }
        }) : []
        
        console.log('[mapToUiScriptData-regenerate] 解析后 scenes:', scenes.map((s: any) => ({ id: s.id, duration: s.duration })))
        
        const characters = Array.isArray(data.characters) ? data.characters.map((c: any) => {
          const inferredPrompt = c.generationPrompt ?? c.prompt ?? c.generation_prompt ?? (c.description ? `realistic portrait, mid-shot, soft key light, ${c.description}` : `realistic portrait, mid-shot, soft key light, ${c.name ?? 'character'}`)
          return {
            id: c.id ?? String(c.name ?? `char_${Math.random().toString(36).slice(2,8)}`),
            name: c.name ?? c.id ?? t("characterTitle"),
            role: c.role ?? c.roleLabel ?? 'protagonist',
            description: c.description ?? c.desc ?? c.summary ?? '',
            // provide both generationPrompt and prompt alias so editor and generators can use either
            generationPrompt: inferredPrompt,
            prompt: inferredPrompt,
            imageUrl: c.imageUrl ?? c.image_url ?? '',
            thumbnailUrl: c.thumbnailUrl ?? c.thumbnail_url ?? '',
            personality: c.personality ?? '',
            appearance: c.appearance ?? ''
          }
        }) : []
        const title = data.title ?? data.summary ?? ''
        const aspect = data.aspectRatio ?? aspectRatio
        const totalDuration = scenes.reduce((sum: number, s: any) => sum + (Number(s.duration) || 0), 0)
        
        console.log('[mapToUiScriptData-regenerate] 计算的 totalDuration:', totalDuration, '秒')

        return {
          title,
          aspectRatio: aspect,
          totalDuration,
          scenes,
          characters,
          raw: data
        }
      }

      const uiScript = mapToUiScriptData(parsedScriptData)
      setScriptData(uiScript)

      // 清空后续步骤的数据，开始一轮全新的工作流
      setCharacterData(uiScript.characters)
      setStoryboardImages([])
      setSceneVideos([])
      setWorkflowLoading(false)

      // 检查是否暂停（与第一次生成一致）
      await waitForWorkflowResume()

      // 步骤2: 生成主角
      setWorkflowStep('character')
      setWorkflowLoading(true)

      // 创建 AbortController 用于暂停（与第一次生成一致）
      abortControllerRef.current = new AbortController()

      // 准备调用正式主角图生成功能：/api/ai/generate-character-image（与第一次生成一致）
      const allChars = (uiScript && Array.isArray(uiScript.characters) && uiScript.characters.length > 0)
        ? uiScript.characters
        : [{ id: 'char_default', name: t('protagonist'), generationPrompt: `realistic portrait, mid-shot, soft key light, ${uiScript?.title || t('protagonist')}` }]

      // 使用单个主角通用函数并行生成，保持与分镜图/剧情视频一致
      const regenerateCharPromises = allChars.map((c: any) =>
        generateCharacterForSingle({
          character: c,
          allCharactersSnapshot: allChars,
          consolePrefix: '[handleRegenerateScript]',
          versionId: currentEditVersionId.current || undefined,
          versionGroupId: vgId,
        })
      )
      const regenerateCharResults = await Promise.all(regenerateCharPromises)
      const finalCharacterData = mergeCharactersFromResults(allChars, regenerateCharResults, '[handleRegenerateScript]')

      setCharacterData(finalCharacterData)

      setWorkflowLoading(false)

      // 检查是否暂停（与第一次生成一致）
      await waitForWorkflowResume()

      // 步骤3: 生成分镜图
      setWorkflowStep('storyboard')
      setWorkflowLoading(true)

      // 创建 AbortController 用于暂停（与第一次生成一致）
      abortControllerRef.current = new AbortController()

      const storyboardPromises = scriptResult.data.scenes.map(async (scene: any, index: number) => {
        // 根据场景的 characterIds 筛选角色，确保只传递该场景实际出现的角色
        const sceneCharacterIds = (scene.characterIds && scene.characterIds.length > 0) ? scene.characterIds : []
        console.log(`[handleRegenerateScript] 分镜图 ${index + 1} - sceneCharacterIds:`, sceneCharacterIds)

        // 使用已生成的 finalCharacterData 主角数据
        console.log(`[handleRegenerateScript] 分镜图 ${index + 1} - finalCharacterData count:`, finalCharacterData.length)

        // 只筛选出场景中实际出现的角色，如果没有指定角色则不传递任何主角
        const relevantCharacters = sceneCharacterIds.length > 0
          ? finalCharacterData.filter((char: any) => sceneCharacterIds.includes(char.id))
          : []

        console.log(`[handleRegenerateScript] 分镜图 ${index + 1} - relevantCharacters:`, relevantCharacters.map((c: any) => ({ id: c.id, imageUrl: c.imageUrl })))

        // 构建角色图片数组，包含 imageUrl 和 imagePrompt
        const characterImages = relevantCharacters.length > 0
          ? relevantCharacters.map((char: any) => ({
              characterId: char.id,
              imageUrl: char.imageUrl,
              imagePrompt: char.generationPrompt || char.prompt || char.description || ''
            }))
          : []

        console.log(`[handleRegenerateScript] 分镜图 ${index + 1} - characterImages:`, characterImages)

        return await generateStoryboardForScene({
          scene,
          sceneIndex: index,
          aspectRatio,
          characterImages,
          consolePrefix: '[handleRegenerateScript]',
          versionId: currentEditVersionId.current || undefined,
          versionGroupId: vgId,
          itemId: scene.id,
        })
      })

      // 等待所有分镜图处理完成（错误不会中断流程）
      const storyboardResults = await Promise.all(storyboardPromises)
      console.log('[handleRegenerateScript] 分镜图全部处理完成:', storyboardResults.map(sb => ({ url: sb?.url, sceneIndex: sb?.sceneIndex, error: sb?.error })))

      setStoryboardImages(storyboardResults)

      setWorkflowLoading(false)

      // 检查是否暂停（与第一次生成一致）
      await waitForWorkflowResume()

      // 步骤4: 生成剧情视频
      setWorkflowStep('scenes')
      setWorkflowLoading(true)

      // 创建 AbortController 用于暂停（与第一次生成一致）
      abortControllerRef.current = new AbortController()

      const sceneVideosPromises = scriptResult.data.scenes.map(
        async (scene: any, index: number) => {
          const storyboardImage = storyboardResults[index]

          return await generateSceneVideoForScene({
            scene,
            sceneIndex: index,
            storyboardImage,
            aspectRatio,
            consolePrefix: '[handleRegenerateScript]',
            versionId: currentEditVersionId.current || undefined,
            versionGroupId: vgId,
          })
        }
      )

      // 等待所有剧情视频处理完成
      const sceneVideosResults = await Promise.all(sceneVideosPromises)
      console.log(
        '[handleRegenerateScript] 剧情视频全部处理完成:',
        sceneVideosResults.map((v, i) => ({
          videoUrl: v?.videoUrl,
          sceneIndex: i,
          error: v?.error,
        }))
      )

      setSceneVideos(sceneVideosResults)

      setWorkflowLoading(false)

      // 检查是否暂停（与第一次生成一致）
      await waitForWorkflowResume()

      // 步骤5: 生成完整视频
      setWorkflowStep('video')
      setWorkflowLoading(true)

      // 创建 AbortController 用于暂停（与第一次生成一致）
      abortControllerRef.current = new AbortController()

      // 使用通用函数生成完整视频
      const videoData = await composeSceneVideosWithFAL(
        sceneVideosResults,
        scriptData,
        abortControllerRef.current?.signal,
        currentProjectId || undefined,
        currentEditVersionId.current || undefined,
        vgId
      )

      if (!videoData) {
        setWorkflowLoading(false)
        toast({
          title: t("videoComposeSkipped"),
          description: t("noValidSceneVideosSkipFinal"),
        })
        setIsGenerating(false)
      } else {
        setVideoData(videoData)

        setWorkflowLoading(false)

        toast({
          title: t("videoGeneratedSuccess"),
          description: t("videoReady"),
        })
        setIsGenerating(false)
      }

    } catch (error) {
      // 如果是用户主动取消（暂停），设置中断标志
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('重新生成工作流被用户暂停')
        workflowInterruptedRef.current = true
        // 暂停时不设置 isGenerating 为 false，保持暂停按钮可见
        setWorkflowLoading(false)
        abortControllerRef.current = null
        return
      }

      console.error('重新生成工作流错误:', error)
      setWorkflowError(error instanceof Error ? error.message : t('regenerationFailed'))
      toast({
        title: t("regenerationFailed"),
        description: error instanceof Error ? error.message : t("retryLater"),
        variant: "destructive",
      })

      // 只有在真正出错时才设置 isGenerating 为 false
      setIsGenerating(false)
      setWorkflowLoading(false)
      abortControllerRef.current = null
    }
  }

 

  // 显示单个分镜图重新生成确认弹窗
  const handleShowRegenerateStoryboardDialog = (index: number) => {
    setStoryboardToRegenerate(index)
    setShowRegenerateStoryboardDialog(true)
  }

  // 显示单个帧重新生成确认弹窗
  const handleShowRegenerateSingleFrame = (index: number, frameType: 'first' | 'last') => {
    setStoryboardToRegenerate(index)
    setShowRegenerateStoryboardDialog(true)
  }

  // 显示单个剧情视频重新生成确认弹窗
  const handleShowRegenerateSceneVideoDialog = (index: number) => {
    setSceneVideoToRegenerate(index)
    setShowRegenerateSceneVideoDialog(true)
  }
  // 执行单个剧情视频重新生成（使用通用函数）
  const handleConfirmRegenerateSceneVideo = async () => {
    if (sceneVideoToRegenerate === null || !scriptData || !characterData || characterData.length === 0) {
      setShowRegenerateSceneVideoDialog(false)
      setIsRegeneratingSceneVideo(null)
      return
    }

    setShowRegenerateSceneVideoDialog(false)
    const index = sceneVideoToRegenerate
    setIsRegeneratingSceneVideo(index)

    // 生成版本组ID（用于关联同一批次的重新生成任务）
    const vgId = generateVersionGroupId()

    // 清空该剧情视频的URL，显示"生成中"状态
    if (sceneVideos[index]) {
      const updatedSceneVideos = [...sceneVideos]
      updatedSceneVideos[index] = { ...updatedSceneVideos[index], videoUrl: null }
      setSceneVideos(updatedSceneVideos)
    }

    // 设置工作流状态（与第一次生成一致）
    setWorkflowStep('scenes')
    setWorkflowLoading(true)
    setWorkflowError(null)  // 初始化错误状态（与第一次生成一致）

    // 创建 AbortController 用于暂停（与第一次生成一致）
    abortControllerRef.current = new AbortController()

    try {
      const scene = (scriptData?.scenes ?? [])[index]
      const storyboardImage = storyboardImages[index]

      // 使用通用函数生成单个剧情视频
      const videoItem = await generateSceneVideoForScene({
        scene,
        sceneIndex: index,
        storyboardImage,
        aspectRatio,
        consolePrefix: '[operate] regenerate',
        versionId: currentEditVersionId.current || undefined,
        versionGroupId: vgId,
      })

      // 检查是否有错误
      if (videoItem.error) {
        setWorkflowError(videoItem.error)
        setWorkflowLoading(false)
        // 不抛出异常，只显示错误信息
        return
      }

      // 检查是否有有效的视频 URL
      if (!videoItem.videoUrl) {
        const errorMessage = t('sceneVideoRegenerateFailed')
        setWorkflowError(errorMessage)
        setWorkflowLoading(false)
        // 不抛出异常，只显示错误信息
        return
      }

      console.log('[operate] regenerate scene video - updated videoItem:', {
        sceneIndex: videoItem.sceneIndex,
        videoUrl: videoItem.videoUrl ? videoItem.videoUrl.substring(0, 80) + '...' : null
      })

      // 回填该场景剧情视频到 UI state（否则会一直停留在“生成中”）
      const nextSceneVideos = [...sceneVideos]
      nextSceneVideos[index] = videoItem
      setSceneVideos(nextSceneVideos)

      // 检查是否暂停（与第一次生成一致）
      await waitForWorkflowResume()

      // 自动重新生成完整视频（与单个主角一致）
      setWorkflowStep('video')
      setWorkflowLoading(true)
      setVideoData(null) // 清空旧的总视频，显示"生成中"状态

      // 使用通用函数生成完整视频（重新生成的那个 + 其他已有的）
      const mergedSceneVideos = [...nextSceneVideos]

      abortControllerRef.current = new AbortController()

      const videoData = await composeSceneVideosWithFAL(
        mergedSceneVideos,
        scriptData,
        abortControllerRef.current?.signal,
        currentProjectId || undefined,
        currentEditVersionId.current || undefined,
        vgId
      )

      if (!videoData) {
        setWorkflowLoading(false)
        setIsRegeneratingSceneVideo(null)
        toast({
          title: t("videoComposeSkipped"),
          description: t("noValidSceneVideosSkipFinal"),
        })
      } else {
        setVideoData(videoData)
        setWorkflowLoading(false)

        // 检查是否暂停（与第一次生成一致）
        await waitForWorkflowResume()

        if (videoData) {
          setWorkflowLoading(false)
        }

        toast({
          title: t("videoGeneratedSuccess"),
          description: t("newVideoAndFinalReady", { index: index + 1 }),
        })
        setIsRegeneratingSceneVideo(null)
      }

    } catch (error) {
      // 如果是用户主动取消（暂停），设置中断标志（与第一次生成一致）
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('单个剧情视频重新生成工作流被用户暂停')
        workflowInterruptedRef.current = true
        // 暂停时不设置 isGenerating 为 false，保持暂停按钮可见
        setWorkflowLoading(false)
        abortControllerRef.current = null
        setIsRegeneratingSceneVideo(null)
        return
      }

      console.warn('单个剧情视频重新生成工作流错误:', error)
      setWorkflowError(error instanceof Error ? error.message : t('regenerationFailed'))
      // 只显示普通提示，不显示错误弹窗
      toast({
        title: t("regenerationFailed"),
        description: t("retryLater"),
      })

      // 只有在真正出错时才设置 isGenerating 为 false
      setWorkflowLoading(false)
      abortControllerRef.current = null
      setIsRegeneratingSceneVideo(null)
    }
  }

  // 从中断处继续工作流
  const resumeWorkflow = async () => {
    try {
      setIsGenerating(true)
      setWorkflowError(null)

      // 根据当前步骤从中断处继续
      switch (workflowStep) {
        case 'script':
          // 继续生成剧情（从积分不足中断处继续，直接调用 handleSend 重新生成）
          await handleSend()
          break

        case 'character':
          // 继续生成主角（和第一次生成逻辑完全一样）
          if (!scriptData) {
            throw new Error(t('missingScriptData'))
          }

          setWorkflowStep('character')
          setWorkflowLoading(true)
          abortControllerRef.current = new AbortController()

          // 准备调用正式主角图生成功能：/api/ai/generate-character-image
          const allChars = (scriptData && Array.isArray(scriptData.characters) && scriptData.characters.length > 0)
            ? scriptData.characters
            : [{ id: 'char_default', name: t('protagonist'), generationPrompt: `realistic portrait, mid-shot, soft key light, ${scriptData?.title || t('protagonist')}` }]

          // 使用单个主角通用函数并行生成，保持与分镜图/剧情视频一致
          const resumeCharPromises = allChars.map((c: any) =>
            generateCharacterForSingle({
              character: c,
              allCharactersSnapshot: allChars,
              consolePrefix: '[resumeWorkflow]',
              versionId: currentEditVersionId.current || undefined,
            })
          )
          const resumeCharResults = await Promise.all(resumeCharPromises)
          const mergedChars = mergeCharactersFromResults(allChars, resumeCharResults, '[resumeWorkflow]')

          setWorkflowLoading(false)

          // 检查是否暂停
          await waitForWorkflowResume()

          // 继续下一步：生成分镜图
          await resumeStoryboardGeneration(null)
          break

        case 'storyboard':
          // 继续生成分镜图
          if (!scriptData) {
            throw new Error(t('missingScriptData'))
          }

          await resumeStoryboardGeneration(null)
          break

        case 'scenes':
          // 继续生成剧情视频
          if (!scriptData) {
            throw new Error(t('missingScriptData'))
          }

          await resumeSceneVideosGeneration()
          break

        case 'video':
          // 继续生成完整视频
          if (!scriptData) {
            throw new Error(t('missingScriptData'))
          }

          await resumeVideoSynthesis()
          break

        default:
          // 如果没有明确的步骤，从头开始
          await handleSend()
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('工作流被用户暂停')
        workflowInterruptedRef.current = true
        setWorkflowLoading(false)
        abortControllerRef.current = null
        return
      }

      console.error('继续工作流失败:', error)
      setWorkflowError(error instanceof Error ? error.message : t('continueFailed'))
      toast({
        title: t("continueFailed"),
        description: error instanceof Error ? error.message : t("unknownError"),
        variant: "destructive",
      })
      setIsGenerating(false)
    }
  }

  // 继续生成剧情视频的辅助函数
  const resumeSceneVideosGeneration = async () => {
    setWorkflowStep('scenes')
    setWorkflowLoading(true)
    abortControllerRef.current = new AbortController()

    const sceneVideosPromises = (scriptData?.scenes ?? []).map(
      async (scene: StoryScene, index: number) => {
        const storyboardImage = storyboardImages[index]

        return await generateSceneVideoForScene({
          scene,
          sceneIndex: index,
          storyboardImage,
          aspectRatio,
          consolePrefix: '[resumeSceneVideosGeneration]',
          versionId: currentEditVersionId.current || undefined,
        })
      }
    )

    // 等待所有剧情视频处理完成（错误不会中断流程）
    const sceneVideosResults = await Promise.all(sceneVideosPromises)
    console.log(
      '[resumeSceneVideosGeneration] 剧情视频全部处理完成:',
      sceneVideosResults.map((sv) => ({
        videoUrl: sv?.videoUrl,
        sceneIndex: sv?.sceneIndex,
        error: sv?.error,
      }))
    )

    setWorkflowLoading(false)

    // 检查是否暂停
    await waitForWorkflowResume()

    // 继续下一步：生成完整视频
    await resumeVideoSynthesis()
  }

  // 继续生成完整视频的辅助函数
  const resumeVideoSynthesis = async () => {
    setWorkflowStep('video')
    setWorkflowLoading(true)
    abortControllerRef.current = new AbortController()

    // 使用 FAL AI 生成完整视频（与第一次生成一致，支持 abort）
    const videoDataResult = await composeSceneVideosWithFAL(sceneVideos, scriptData, abortControllerRef.current?.signal, currentProjectId || undefined, currentEditVersionId.current || undefined)

    if (!videoDataResult) {
      setWorkflowLoading(false)
      toast({
        title: t("videoComposeSkipped"),
        description: t("noValidSceneVideosSkipFinal"),
      })
      setIsGenerating(false)
    } else {
      setVideoData(videoDataResult)
      setWorkflowLoading(false)

      toast({
        title: t("videoComposeSuccess"),
        description: t("finalVideoGenerated"),
      })

      // 工作流完成
      setIsGenerating(false)
    }
  }

  // 暂停/继续工作流
  const handlePauseResumeWorkflow = async () => {
    const newPausedState = !workflowPausedRef.current
    console.log(`工作流${newPausedState ? t('workflowPaused') : t('workflowResumed')}`)
    workflowPausedRef.current = newPausedState
    setWorkflowPaused(newPausedState)

    // 如果暂停，先等待已发送的 API 请求完成（Pusher 回调回来），再真正暂停
    if (newPausedState) {
      // 检查是否有正在等待的 Pusher 任务
      const pendingTaskIds = Array.from(pendingTasksRef.current.keys())
      console.log(`[暂停] 检查待完成的任务: ${pendingTaskIds.length} 个任务`)

      if (pendingTaskIds.length > 0) {
        console.log(`[暂停] 等待 ${pendingTaskIds.length} 个任务完成...`)
        setWorkflowLoading(true) // 保持加载状态

        // 等待所有 pending 任务完成
        const pendingPromises = Array.from(pendingTasksRef.current.values()).map(
          (task) => new Promise((resolve) => {
            // 用一个临时变量存储原来的 resolve
            const originalResolve = task.resolve
            task.resolve = (data: any) => {
              originalResolve(data)
              resolve(data)
            }
            // 设置一个超时，防止任务永远不完成
            setTimeout(() => {
              console.log(`[暂停] 任务超时，继续暂停流程`)
              resolve(null)
            }, 60000) // 60秒超时
          })
        )

        await Promise.all(pendingPromises)
        console.log(`[暂停] 所有任务完成，继续暂停流程`)
      }

      // 现在所有已发送的请求都有结果了，可以安全地取消新的请求
      if (abortControllerRef.current) {
        console.log('[暂停] 取消新请求')
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }

      // 停止加载状态
      setWorkflowLoading(false)
    }

    // 如果是从暂停状态继续，并且工作流被中断过，从中断处继续工作流
    if (!newPausedState && workflowInterruptedRef.current) {
      console.log('从暂停状态恢复，从中断处继续工作流')
      workflowInterruptedRef.current = false
      try {
        await resumeWorkflow()
      } catch (error) {
        console.error('继续工作流失败:', error)
      }
    }
  }

  // 通用下载文件（图片/视频）
  // 编辑剧情后，在保存脚本后自动重新生成后续步骤（主角 -> 分镜图 -> 剧情视频 -> 完整视频）
  // 注意：保存脚本后 setScriptData 是异步的，因此这里必须使用保存时的脚本快照，避免读到旧的 scriptData。
  const handleAutoRegenerateAfterSave = async (scriptOverride?: any) => {
    const scriptSnapshot = scriptOverride ?? scriptData
    if (!scriptSnapshot) return
    setWorkflowLoading(true)
    setIsGenerating(true)
    setWorkflowError(null)

    // 生成版本组ID（用于关联同一批次的重新生成任务）
    const vgId = generateVersionGroupId()

    try {
      // 生成主角（使用正式 API）
      setWorkflowStep('character')
      setWorkflowLoading(true)
  
      // 创建 AbortController 用于暂停（与第一次生成一致）
      abortControllerRef.current = new AbortController()
  
      const allChars = Array.isArray(scriptSnapshot.characters) && scriptSnapshot.characters.length > 0
        ? scriptSnapshot.characters
        : [{ id: 'char_default', name: t('protagonist'), generationPrompt: `realistic portrait, mid-shot, soft key light, ${scriptSnapshot?.title || 'protagonist'}` }]
  
      // 使用单个主角通用函数并行生成，保持与分镜图/剧情视频一致
      const autoRegenCharPromises = allChars.map((c: any) =>
        generateCharacterForSingle({
          character: c,
          allCharactersSnapshot: allChars,
          consolePrefix: '[handleAutoRegenerateAfterSave]',
          versionId: currentEditVersionId.current || undefined,
          versionGroupId: vgId,
        })
      )
      const autoRegenCharResults = await Promise.all(autoRegenCharPromises)
      const finalCharacterData = mergeCharactersFromResults(allChars, autoRegenCharResults, '[handleAutoRegenerateAfterSave]')
      setCharacterData(finalCharacterData)

      setWorkflowLoading(false)
  
      // 检查是否暂停（与第一次生成一致）
      await waitForWorkflowResume()
  
      // 生成分镜图
      setWorkflowStep('storyboard')
      setWorkflowLoading(true)
  
      // 创建 AbortController 用于暂停
      abortControllerRef.current = new AbortController()
  
      const storyboardPromises = scriptSnapshot.scenes.map(async (scene: any, index: number) => {
        // 根据场景的 characterIds 筛选角色
        const sceneCharacterIds = (scene.characterIds && scene.characterIds.length > 0) ? scene.characterIds : []
        console.log(`[handleAutoRegenerateAfterSave] 分镜图 ${index + 1} - sceneCharacterIds:`, sceneCharacterIds)
  
        // 使用已生成的 finalCharacterData 主角数据
        const mergedCharacterData = finalCharacterData
        console.log(`[handleAutoRegenerateAfterSave] 分镜图 ${index + 1} - mergedCharacterData count:`, mergedCharacterData.length)
  
        // 只筛选出场景中实际出现的角色，如果没有指定角色则不传递任何主角
        const relevantCharacters = sceneCharacterIds.length > 0
          ? mergedCharacterData.filter((char: any) => sceneCharacterIds.includes(char.id))
          : []
  
        console.log(`[handleAutoRegenerateAfterSave] 分镜图 ${index + 1} - relevantCharacters:`, relevantCharacters.map((c: any) => ({ id: c.id, imageUrl: c.imageUrl })))
  
        // 构建角色图片数组，包含 imageUrl 和 imagePrompt
        const characterImages = relevantCharacters.length > 0
          ? relevantCharacters.map((char: any) => ({
              characterId: char.id,
              imageUrl: char.imageUrl,
              imagePrompt: char.generationPrompt || char.prompt || char.description || ''
            }))
          : []
  
        console.log(`[handleAutoRegenerateAfterSave] 分镜图 ${index + 1} - characterImages:`, characterImages)

        return await generateStoryboardForScene({
          scene,
          sceneIndex: index,
          aspectRatio: scriptSnapshot?.aspectRatio || aspectRatio,
          characterImages,
          consolePrefix: '[handleAutoRegenerateAfterSave]',
          versionId: currentEditVersionId.current || undefined,
          versionGroupId: vgId,
          itemId: scene.id,
        })
      })
  
      // 等待所有分镜图处理完成（错误不会中断流程）
      const storyboardResults = await Promise.all(storyboardPromises)
      console.log('[handleAutoRegenerateAfterSave] 分镜图全部处理完成:', storyboardResults.map(sb => ({ url: sb?.url, sceneIndex: sb?.sceneIndex, error: sb?.error })))

      setStoryboardImages(storyboardResults)

      setWorkflowLoading(false)

      // 检查是否暂停（与第一次生成一致）
      await waitForWorkflowResume()

      // 自动重新生成剧情视频
      setWorkflowStep('scenes')
      setWorkflowLoading(true)

      // 创建 AbortController 用于暂停
      abortControllerRef.current = new AbortController()

      const sceneVideosPromises = scriptSnapshot.scenes.map(
        async (scene: any, index: number) => {
          const storyboardImage = storyboardResults[index]

          return await generateSceneVideoForScene({
            scene,
            sceneIndex: index,
            storyboardImage,
            aspectRatio: scriptSnapshot?.aspectRatio || aspectRatio,
            consolePrefix: '[handleAutoRegenerateAfterSave]',
            versionId: currentEditVersionId.current || undefined,
            versionGroupId: vgId,
          })
        }
      )

      // 等待所有剧情视频处理完成
      const sceneVideosResults = await Promise.all(sceneVideosPromises)
      console.log('[handleAutoRegenerateAfterSave] 剧情视频全部处理完成:', sceneVideosResults.map((v, i) => ({ videoUrl: v?.videoUrl, sceneIndex: i, error: v?.error })))
      setSceneVideos(sceneVideosResults)

      setWorkflowLoading(false)

      // 检查是否暂停（与第一次生成一致）
      await waitForWorkflowResume()

      // 生成完整视频
      setWorkflowStep('video')
      setWorkflowLoading(true)

      // 创建 AbortController 用于暂停（与第一次生成一致）
      abortControllerRef.current = new AbortController()

      // 使用通用函数生成完整视频
      const videoData = await composeSceneVideosWithFAL(
        sceneVideosResults,
        scriptSnapshot,
        abortControllerRef.current?.signal,
        currentProjectId || undefined,
        currentEditVersionId.current || undefined,
        vgId
      )

      if (!videoData) {
        setWorkflowLoading(false)
        toast({
          title: t("videoComposeSkipped"),
          description: t("noValidSceneVideosSkipFinal"),
        })
        setIsGenerating(false)
      } else {
        setVideoData(videoData)

        setWorkflowLoading(false)

        toast({
          title: t("videoGeneratedSuccess"),
          description: t("videoReady"),
        })

        // 工作流完成，设置生成状态为 false（与第一次生成一致）
        setIsGenerating(false)
      }

      } catch (error) {
        // 如果是用户主动取消（暂停），设置中断标志
        if (error instanceof Error && error.name === 'AbortError') {
          console.log('自动重新生成工作流被用户暂停')
          workflowInterruptedRef.current = true
          // 暂停时不设置 isGenerating 为 false，保持暂停按钮可见
          setWorkflowLoading(false)
          abortControllerRef.current = null
          return
        }
  
        console.error('自动重新生成工作流错误:', error)
        setWorkflowError(error instanceof Error ? error.message : t('autoRegenerateFailed'))
        toast({
          title: t("autoGenerationFailed"),
          description: error instanceof Error ? error.message : t("retryLater"),
          variant: "destructive",
        })
  
        // 只有在真正出错时才设置 isGenerating 为 false
        setIsGenerating(false)
        setWorkflowLoading(false)
        abortControllerRef.current = null
      }
   }

  // 从恢复的项目继续生成（跳过已完成步骤）
  const handleResumeContinueGeneration = async () => {
    if (!scriptData) {
      console.log('[恢复继续生成] ❌ 没有脚本数据')
      toast({
        title: t("resume.noScript"),
        variant: "destructive",
      })
      return
    }

    setWorkflowLoading(true)
    setIsGenerating(true)
    setWorkflowError(null)

    // 检查已完成步骤，确定从哪一步开始
    const totalScenes = scriptData.scenes?.length || 0
    const completedCharacters = characterData.filter(c => c.imageUrl).length
    const completedStoryboards = storyboardImages.filter(s => s.imageUrl || s.url).length
    const completedSceneVideos = sceneVideos.filter(v => v.videoUrl).length

    console.log('[恢复继续生成] 状态检查:', {
      totalScenes,
      completedCharacters,
      completedStoryboards,
      completedSceneVideos,
      hasVideo: !!videoData?.url,
      existingVersionGroupId: versionGroupIdRef.current
    })

    // 判断从哪一步开始（判据与 handleResumeContinue 对齐：有主角缺图才重跑角色，
    // 不能拿「角色数 < 场景数」比较——单主角多场景时恒真，导致永远从角色重跑烧积分）
    const totalCharacters = characterData.length || 0
    const hasCharacterWithoutImage = totalCharacters > 0 && completedCharacters < totalCharacters
    let startStep: 'character' | 'storyboard' | 'scenes' | 'video' = 'character'
    if (hasCharacterWithoutImage) {
      startStep = 'character'
    } else if (completedStoryboards < totalScenes) {
      startStep = 'storyboard'
    } else if (completedSceneVideos < totalScenes) {
      startStep = 'scenes'
    } else if (!videoData?.url) {
      startStep = 'video'
    } else {
      console.log('[恢复继续生成] ✅ 所有步骤已完成，无需继续')
      setWorkflowLoading(false)
      setIsGenerating(false)
      toast({
        title: t("resume.alreadyCompleted"),
      })
      return
    }

    console.log('[恢复继续生成] 从第', startStep, '步开始')

    // 继续生成时使用已有的版本ID，不生成新的版本组ID
    // versionGroupIdRef.current 可能为 null（如果是旧项目），这是正常的
    const vgId = versionGroupIdRef.current
    console.log('[恢复继续生成] 使用版本组ID:', vgId ?? '(无)')

    // 用于存储各步骤结果
    let finalCharacterData = characterData
    let storyboardResults = storyboardImages
    let sceneVideosResults = sceneVideos

    try {
      // ========== 主角生成步骤 ==========
      if (startStep === 'character') {
        console.log('[恢复继续生成] 执行: 主角生成')
        setWorkflowStep('character')
        setWorkflowLoading(true)
        abortControllerRef.current = new AbortController()

        const allChars = Array.isArray(scriptData.characters) && scriptData.characters.length > 0
          ? scriptData.characters
          : [{ id: 'char_default', name: t('protagonist'), generationPrompt: `realistic portrait, mid-shot, soft key light, ${scriptData?.title || 'protagonist'}` }]

        const autoRegenCharPromises = allChars.map((c: any) =>
          generateCharacterForSingle({
            character: c,
            allCharactersSnapshot: allChars,
            consolePrefix: '[恢复继续生成]',
            versionId: currentEditVersionId.current || undefined,
            versionGroupId: vgId ?? undefined,
          })
        )
        const autoRegenCharResults = await Promise.all(autoRegenCharPromises)
        finalCharacterData = mergeCharactersFromResults(allChars, autoRegenCharResults, '[恢复继续生成]')
        setCharacterData(finalCharacterData)
        setWorkflowLoading(false)
        await waitForWorkflowResume()
      } else {
        console.log('[恢复继续生成] 跳过: 主角生成 (已有', completedCharacters, '/', totalScenes, ')')
        finalCharacterData = characterData
      }

      // ========== 分镜图生成步骤 ==========
      if (startStep === 'character' || startStep === 'storyboard') {
        console.log('[恢复继续生成] 执行: 分镜图生成')
        setWorkflowStep('storyboard')
        setWorkflowLoading(true)
        abortControllerRef.current = new AbortController()

        const storyboardPromises = (scriptData?.scenes ?? []).map(async (scene: StoryScene, index: number) => {
          // 检查是否已有分镜图
          const existingSb = storyboardImages[index]
          if (existingSb?.imageUrl || existingSb?.url) {
            console.log(`[恢复继续生成] 分镜图 ${index + 1} 已存在，跳过`)
            return existingSb
          }

          const sceneCharacterIds = (scene.characterIds && scene.characterIds.length > 0) ? scene.characterIds : []
          const mergedCharacterData = finalCharacterData
          const relevantCharacters = sceneCharacterIds.length > 0
            ? mergedCharacterData.filter((char: CharacterItem) => sceneCharacterIds.includes(String(char.id)))
            : []
          const characterImages = relevantCharacters.length > 0
            ? relevantCharacters.map((char: CharacterItem) => ({
                characterId: char.id ?? '',
                imageUrl: char.imageUrl ?? null,
                imagePrompt: String(char.generationPrompt ?? char.description ?? '')
              }))
            : []

          return await generateStoryboardForScene({
            scene,
            sceneIndex: index,
            aspectRatio: scriptData?.aspectRatio || aspectRatio,
            characterImages,
            consolePrefix: '[恢复继续生成]',
            versionId: currentEditVersionId.current || undefined,
            versionGroupId: vgId ?? undefined,
            itemId: scene.id,
          })
        })

        storyboardResults = await Promise.all(storyboardPromises)
        console.log('[恢复继续生成] 分镜图处理完成:', storyboardResults.map(sb => ({ url: sb?.url, sceneIndex: sb?.sceneIndex, error: sb?.error })))
        setStoryboardImages(storyboardResults)
        setWorkflowLoading(false)
        await waitForWorkflowResume()
      } else {
        console.log('[恢复继续生成] 跳过: 分镜图生成 (已有', completedStoryboards, '/', totalScenes, ')')
        storyboardResults = storyboardImages
      }

      // ========== 剧情视频生成步骤 ==========
      if (startStep === 'character' || startStep === 'storyboard' || startStep === 'scenes') {
        console.log('[恢复继续生成] 执行: 剧情视频生成')
        setWorkflowStep('scenes')
        setWorkflowLoading(true)
        abortControllerRef.current = new AbortController()

        const sceneVideosPromises = (scriptData?.scenes ?? []).map(
          async (scene: StoryScene, index: number) => {
            // 检查是否已有剧情视频
            const existingSv = sceneVideos[index]
            if (existingSv?.videoUrl) {
              console.log(`[恢复继续生成] 剧情视频 ${index + 1} 已存在，跳过`)
              return existingSv
            }

            const storyboardImage = storyboardResults[index]
            return await generateSceneVideoForScene({
              scene,
              sceneIndex: index,
              storyboardImage,
              aspectRatio: scriptData?.aspectRatio || aspectRatio,
              consolePrefix: '[恢复继续生成]',
              versionId: currentEditVersionId.current || undefined,
              versionGroupId: vgId ?? undefined,
            })
          }
        )

        sceneVideosResults = await Promise.all(sceneVideosPromises)
        console.log('[恢复继续生成] 剧情视频处理完成:', sceneVideosResults.map((v, i) => ({ videoUrl: v?.videoUrl, sceneIndex: i, error: v?.error })))
        setSceneVideos(sceneVideosResults)
        setWorkflowLoading(false)
        await waitForWorkflowResume()
      } else {
        console.log('[恢复继续生成] 跳过: 剧情视频生成 (已有', completedSceneVideos, '/', totalScenes, ')')
        sceneVideosResults = sceneVideos
      }

      // ========== 完整视频生成步骤 ==========
      if (startStep === 'character' || startStep === 'storyboard' || startStep === 'scenes' || startStep === 'video') {
        console.log('[恢复继续生成] 执行: 完整视频生成')
        setWorkflowStep('video')
        setWorkflowLoading(true)
        abortControllerRef.current = new AbortController()

        const videoData = await composeSceneVideosWithFAL(
          sceneVideosResults,
          scriptData,
          abortControllerRef.current?.signal,
          currentProjectId || undefined,
          currentEditVersionId.current || undefined,
          vgId ?? undefined
        )

        if (!videoData) {
          setWorkflowLoading(false)
          toast({
            title: t("videoComposeSkipped"),
            description: t("noValidSceneVideosSkipFinal"),
          })
          setIsGenerating(false)
        } else {
          setVideoData(videoData)
          console.log('[恢复继续生成] videoData 已设置:', { url: videoData.url, thumbnail: videoData.thumbnailUrl })
          setWorkflowLoading(false)
          toast({
            title: t("videoGeneratedSuccess"),
            description: t("videoReady"),
          })
          setIsGenerating(false)
        }
      }

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[恢复继续生成] 用户暂停')
        workflowInterruptedRef.current = true
        setWorkflowLoading(false)
        abortControllerRef.current = null
        return
      }

      console.error('[恢复继续生成] 错误:', error)
      setWorkflowError(error instanceof Error ? error.message : t('autoRegenerateFailed'))
      toast({
        title: t("autoGenerationFailed"),
        description: error instanceof Error ? error.message : t("retryLater"),
        variant: "destructive",
      })
      setIsGenerating(false)
      setWorkflowLoading(false)
      abortControllerRef.current = null
    }
  }

  // =============================================
  // 剧情编辑功能已暂时禁用（因数据库保存逻辑不完整）
  // =============================================
  // // 开始编辑脚本
  // const handleStartEditScript = () => {
  //   if (scriptData) {
  //     setEditedScriptData(JSON.parse(JSON.stringify(scriptData))) // 深拷贝
  //     setIsEditingScript(true)
  //     setShowScriptPreview(true)
  //   }
  // }

  // 保存编辑的脚本
  // =============================================
  // 剧情编辑功能已暂时禁用（因数据库保存逻辑不完整）
  // =============================================
  // const handleSaveEditedScript = async () => {
  //   if (editedScriptData) {
  //     setScriptData(editedScriptData)
  //     setIsEditingScript(false)
  //     setShowScriptPreview(false)
  //
  //     // 清空后续步骤，开始自动重新生成工作流
  //     setCharacterData([])
  //     setStoryboardImages([])
  //     setSceneVideos([])
  //     setVideoData(null)
  //     toast({
  //       title: t("scriptSaved"),
  //       description: t("canContinueGenerateCharacter"),
  //     })
  //     // 保存后自动生成后续步骤
  //     void handleAutoRegenerateAfterSave(editedScriptData)
  //   }
  // }

  // // 取消编辑脚本
  // const handleCancelEditScript = () => {
  //   setIsEditingScript(false)
  //   setEditedScriptData(null)
  // }

  // // 更新场景
  // const handleUpdateScene = (sceneId: number, field: string, value: any) => {
  //   if (!editedScriptData) return
  //
  //   const updatedScenes = editedScriptData.scenes.map((scene: any) => {
  //     if (scene.id === sceneId) {
  //       return { ...scene, [field]: value }
  //     }
  //     return scene
  //   })
  //
  //   // 重新计算总时长
  //   const totalDuration = updatedScenes.reduce((sum: number, scene: any) => sum + (scene.duration || 5), 0)
  //
  //   setEditedScriptData({
  //     ...editedScriptData,
  //     scenes: updatedScenes,
  //     totalDuration
  //   })
  // }

  // // 删除场景
  // const handleDeleteScene = (sceneId: number) => {
  //   if (!editedScriptData) return
  //
  //   // 找到要删除的场景索引
  //   const deletedSceneIndex = editedScriptData.scenes.findIndex((scene: any) => scene.id === sceneId)
  //   if (deletedSceneIndex === -1) return
  //
  //   const updatedScenes = editedScriptData.scenes
  //     .filter((scene: any) => scene.id !== sceneId)
  //     .map((scene: any, index: number) => ({ ...scene, id: index + 1 })) // 重新编号
  //
  //   // 重新计算总时长
  //   const totalDuration = updatedScenes.reduce((sum: number, scene: any) => sum + (scene.duration || 5), 0)
  //
  //   // 同步删除对应的 storyboard 数据
  //   const updatedStoryboards = storyboardImages
  //     .filter((sb: any) => sb.sceneIndex !== deletedSceneIndex)
  //     .map((sb: any, index: number) => ({
  //       ...sb,
  //       sceneIndex: index // 重新编号
  //     }))
  //
  //   // 同步删除对应的 video 数据
  //   const updatedSceneVideos = sceneVideos
  //     .filter((sv: any) => sv.sceneIndex !== deletedSceneIndex)
  //     .map((sv: any, index: number) => ({
  //       ...sv,
  //       sceneIndex: index // 重新编号
  //     }))
  //
  //   setEditedScriptData({
  //     ...editedScriptData,
  //     scenes: updatedScenes,
  //     totalDuration
  //   })
  //   setStoryboardImages(updatedStoryboards)
  //   setSceneVideos(updatedSceneVideos)
  // }

  // // 添加场景（自动生成plot）
  // const handleAddScene = async () => {
  //   if (!editedScriptData || isGeneratingScenePlot) return
  //
  //   setIsGeneratingScenePlot(true)
  //   const newSceneIndex = editedScriptData.scenes.length
  //
  //   // 先添加一个空场景（带加载状态）
  //   const emptyScene = {
  //     id: newSceneIndex + 1,
  //     duration: 5,
  //     plot: t("newScenePlot"),
  //     narration: "",
  //     visualElements: [],
  //     isGenerating: true // 标记正在生成
  //   }
  //
  //   const updatedScenesWithLoading = [...editedScriptData.scenes, emptyScene]
  //   const totalDurationWithLoading = updatedScenesWithLoading.reduce((sum: number, scene: any) => sum + (scene.duration || 5), 0)
  //
  //   setEditedScriptData({
  //     ...editedScriptData,
  //     scenes: updatedScenesWithLoading,
  //     totalDuration: totalDurationWithLoading
  //   })
  //
  //   // 调用AI生成plot
  //   try {
  //     const response = await fetch('/api/ai/generate-scene-plot', {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({
  //         storyTitle: editedScriptData.title,
  //         summary: editedScriptData.description,
  //         existingScenes: editedScriptData.scenes,
  //         newSceneIndex: newSceneIndex,
  //         aspectRatio: editedScriptData.aspectRatio || '16:9',
  //         targetDuration: 5,
  //       }),
  //     })
  //
  //     if (!response.ok) {
  //       const errorData = await response.json().catch(() => ({}))
  //       toast({
  //         title: t("generatePlotFailed"),
  //         description: errorData.error || t("retryLater"),
  //         variant: "destructive",
  //       })
  //       // 生成失败时移除空场景
  //       const updatedScenesFailed = editedScriptData.scenes
  //       setEditedScriptData({
  //         ...editedScriptData,
  //         scenes: updatedScenesFailed,
  //         totalDuration: updatedScenesFailed.reduce((sum: number, scene: any) => sum + (scene.duration || 5), 0)
  //       })
  //       return
  //     }
  //
  //     const result = await response.json()
  //
  //     if (result.success && result.data) {
  //       // Get aspect ratio from previous scene or use default
  //       const previousScene = editedScriptData.scenes[newSceneIndex - 1]
  //       const newAspectRatio = previousScene?.aspectRatio || editedScriptData.aspectRatio || '16:9'
  //
  //       // AI成功生成plot，更新新场景
  //       const generatedScene = {
  //         id: newSceneIndex + 1,
  //         duration: result.data.duration || 5,
  //         aspectRatio: newAspectRatio,
  //         plot: result.data.description || result.data.plot || t("newScenePlot"),
  //         narration: result.data.narration || "",
  //         visualElements: result.data.visualElements || [],
  //         storyboardPrompt: result.data.storyboardPrompt || '',
  //         sceneVideoPrompt: result.data.sceneVideoPrompt || '',
  //         transition: result.data.transition || 'cut',
  //         characterIds: result.data.characterIds || [],
  //         storyboardCharacterImages: result.data.storyboardCharacterImages || [],
  //         isGenerating: false
  //       }
  //
  //       const finalScenes = [...editedScriptData.scenes, generatedScene]
  //       const finalDuration = finalScenes.reduce((sum: number, scene: any) => sum + (scene.duration || 5), 0)
  //
  //       setEditedScriptData({
  //         ...editedScriptData,
  //         scenes: finalScenes,
  //         totalDuration: finalDuration
  //       })
  //
  //       toast({
  //         title: t("plotGeneratedSuccess"),
  //         description: t("plotGeneratedForNewScene"),
  //       })
  //       // 分镜图/剧情视频/完整视频在用户点击「保存编辑」后由 handleAutoRegenerateAfterSave 统一生成
  //     } else {
  //       throw new Error(result.error || 'Failed to generate plot')
  //     }
  //   } catch (error) {
  //     console.error('生成plot失败:', error)
  //     toast({
  //       title: t("generatePlotFailed"),
  //       description: t("retryLater"),
  //       variant: "destructive",
  //     })
  //     // 生成失败时移除空场景
  //     const updatedScenesFailed = editedScriptData.scenes
  //     setEditedScriptData({
  //       ...editedScriptData,
  //       scenes: updatedScenesFailed,
  //       totalDuration: updatedScenesFailed.reduce((sum: number, scene: any) => sum + (scene.duration || 5), 0)
  //     })
  //   } finally {
  //     setIsGeneratingScenePlot(false)
  //   }
  // }

  // 开始编辑分镜图
  const handleStartEditStoryboard = (index: number, frameType?: 'first' | 'last') => {
    if (storyboardImages[index]) {
      const sb = storyboardImages[index]
      const dataToEdit = JSON.parse(JSON.stringify(sb))

      // 如果是首尾帧模式且有尾帧，根据传入的 frameType 设置编辑数据
      if (sb.lastFrameUrl && sb.lastFrameUrl !== sb.firstFrameUrl && frameType) {
        if (frameType === 'first') {
          // 只编辑首帧
          dataToEdit.url = sb.firstFrameUrl || sb.url
          dataToEdit.isEditingFirstFrame = true
        } else {
          // 只编辑尾帧
          dataToEdit.url = sb.lastFrameUrl
          dataToEdit.isEditingLastFrame = true
          dataToEdit.lastFrameUrl = sb.lastFrameUrl  // 确保 lastFrameUrl 被复制
          dataToEdit.firstFrameUrl = sb.firstFrameUrl  // 保留首帧 URL
        }
      }

      setEditedStoryboardData(dataToEdit)
      setEditingStoryboardIndex(index)
      setIsEditingStoryboard(true)
      setShowStoryboardPreview(true)
      setStoryboardEditMode('none')
    }
  }

  // 显示编辑分镜图保存确认弹窗
  const handleShowSaveEditStoryboardDialog = () => {
    setShowSaveEditStoryboardDialog(true)
  }

  // 执行保存编辑的分镜图
  const handleConfirmSaveEditedStoryboard = async () => {
    // 先关闭确认弹窗、编辑弹窗和详情弹窗，并清空选中状态，避免确认后仍看到「分镜图详情」或关闭动画时闪现 Close 按钮
    const indexToSave = editingStoryboardIndex
    const dataToSave = editedStoryboardData ? { ...editedStoryboardData } : null
    const wasUploadingImage = Boolean(storyboardImageFile)

    setShowSaveEditStoryboardDialog(false)
    setIsEditingStoryboard(false)
    setShowStoryboardPreview(false)
    setEditingStoryboardIndex(null)
    setEditedStoryboardData(null)
    setStoryboardImageFile(null)
    setStoryboardEditMode('none')

    if (dataToSave != null && indexToSave !== null && scriptData && characterData) {
      // 检查是否上传了新图片
      const originalStoryboard = storyboardImages[indexToSave]
      const originalUrl = originalStoryboard?.url || ''
      const imageProvided = Boolean(dataToSave.url && dataToSave.url !== originalUrl)
      const imageChanged = wasUploadingImage || (imageProvided && dataToSave.localUrl)

      // 检查 prompt 是否被修改
      const currentPrompt = String(dataToSave.prompt ?? '')
      const originalPrompt = String(originalStoryboard?.prompt ?? '')
      const promptChanged = currentPrompt.trim() !== originalPrompt.trim()

      // 上传分镜图和修改 prompt 只能选择其一，不能同时进行
      if (imageChanged && promptChanged) {
        toast({
          title: t("cannotDoBoth"),
          description: t("chooseImageOrPrompt"),
        })
        return
      }

      // 如果没有上传新图片也没有修改 prompt，则提示未做修改并返回（不关闭编辑框）
      if (!imageChanged && !promptChanged) {
        toast({
          title: t("noChanges"),
          description: t("uploadNewImageOrEditPrompt"),
        })
        return
      }

      // 生成版本组ID（用于关联同一批次的重新生成任务）
      // 如果修改了 prompt 或上传了图片，都需要创建新版本
      const vgId = generateVersionGroupId()

      let finalStoryboardData = { ...dataToSave }

      // 如果修改了 prompt，重新生成（区分首帧/尾帧模式）
      if (promptChanged && !imageChanged) {
        const editedData = editedStoryboardData || {}
        
        // 如果是首尾帧模式且编辑单个帧，只更新对应的 prompt
        if ((editedData.isEditingFirstFrame || editedData.isEditingLastFrame) && generationMode === 'first-last-frame') {
          // 只更新 prompt，不重新生成分镜图
          if (editedData.isEditingFirstFrame) {
            finalStoryboardData = {
              ...finalStoryboardData,
              firstFramePrompt: currentPrompt,
              prompt: currentPrompt, // 同时更新主 prompt
            }
          } else if (editedData.isEditingLastFrame) {
            finalStoryboardData = {
              ...finalStoryboardData,
              lastFramePrompt: currentPrompt,
              prompt: currentPrompt,
            }
          }
          
          toast({
            title: t("promptUpdated"),
            description: editedData.isEditingFirstFrame ? t("firstFramePromptUpdated") : t("lastFramePromptUpdated"),
          })

          // ========== 编辑单个帧的 prompt 后，需要先生成分镜图，再生成剧情视频 ==========
          setWorkflowLoading(true)
          setWorkflowStep('storyboard')
          setIsRegeneratingStoryboard(indexToSave)

          toast({
            title: t("regeneratingStoryboard"),
            description: t("pleaseWait"),
          })

          // 保留原有分镜图数据，添加生成中状态
          // （不清空 URL，这样卡片会显示图片 + "生成中"覆盖层）
          const updatedStoryboardsForGenerate = [...storyboardImages]
          updatedStoryboardsForGenerate[indexToSave] = {
            ...updatedStoryboardsForGenerate[indexToSave],
            isGenerating: true,  // 标记生成中
          }
          setStoryboardImages(updatedStoryboardsForGenerate)

          // 同时清空对应剧情视频的 URL
          if (sceneVideos[indexToSave]) {
            const updatedSceneVideosForGenerate = [...sceneVideos]
            updatedSceneVideosForGenerate[indexToSave] = { ...updatedSceneVideosForGenerate[indexToSave], videoUrl: null }
            setSceneVideos(updatedSceneVideosForGenerate)
          }

          try {
            const scene = (scriptData?.scenes ?? [])[indexToSave]
            const sceneCharacterIds = scene?.characterIds || []
            const sceneCharacters = characterData.filter((char: CharacterItem) => sceneCharacterIds.includes(String(char.id)))

            const characterImages = sceneCharacters.length > 0
              ? sceneCharacters.map((char: any) => ({
                  characterId: char.id,
                  imageUrl: char.imageUrl,
                  imagePrompt: char.generationPrompt || char.prompt || char.description || ''
                }))
              : []

            // 调用 API 生成分镜图
            const storyboardItem = await generateStoryboardForScene({
              scene,
              sceneIndex: indexToSave,
              aspectRatio,
              characterImages,
              consolePrefix: '[handleConfirmSaveEditedStoryboard]',
              versionId: currentEditVersionId.current || undefined,
              versionGroupId: vgId,
              itemId: scene.id,
              regenerateFrameType: editedData.isEditingFirstFrame ? 'first' : 'last',
            })

            // 清除生成中状态
            setIsRegeneratingStoryboard(null)

            if (storyboardItem && storyboardItem.error) {
              setWorkflowError(storyboardItem.error)
              setWorkflowLoading(false)
              return
            }

            // 获取新生成的图片 URL
            const newImageUrl = storyboardItem.images?.firstFrame?.url ||
                                storyboardItem.images?.lastFrame?.url ||
                                storyboardItem.url ||
                                storyboardItem.imageUrl || ''

            // 更新分镜图状态 - 只更新指定的帧
            const updatedStoryboardsAfterGenerate = [...storyboardImages]
            const currentStoryboard = updatedStoryboardsAfterGenerate[indexToSave] || {}

            if (editedData.isEditingFirstFrame) {
              // 更新首帧 - 保留原有的尾帧 URL
              updatedStoryboardsAfterGenerate[indexToSave] = {
                ...currentStoryboard,
                ...storyboardItem,
                firstFrameUrl: newImageUrl,
                url: newImageUrl,
                lastFrameUrl: currentStoryboard.lastFrameUrl,  // 保留原有尾帧 URL
                firstFramePrompt: currentPrompt,
                prompt: currentPrompt,
                error: undefined,
                isGenerating: undefined,
              }
            } else if (editedData.isEditingLastFrame) {
              // 更新尾帧 - 保留原有的首帧 URL
              updatedStoryboardsAfterGenerate[indexToSave] = {
                ...currentStoryboard,
                ...storyboardItem,
                firstFrameUrl: currentStoryboard.firstFrameUrl || currentStoryboard.url,  // 保留原有首帧 URL
                lastFrameUrl: newImageUrl,
                lastFramePrompt: currentPrompt,
                prompt: currentPrompt,
                error: undefined,
                isGenerating: undefined,
              }
            }

            setStoryboardImages(updatedStoryboardsAfterGenerate)
            setWorkflowLoading(false)

            // 检查是否暂停
            await waitForWorkflowResume()

            // 重新生成对应的剧情视频和完整视频
            await regenerateCorrespondingSceneVideo(
              indexToSave,
              updatedStoryboardsAfterGenerate[indexToSave],
              updatedStoryboardsAfterGenerate,
              vgId
            )
          } catch (error) {
            setWorkflowLoading(false)
            setIsRegeneratingStoryboard(null)
            // 清除生成中状态
            const updatedStoryboardsAfterError = [...storyboardImages]
            if (updatedStoryboardsAfterError[indexToSave]) {
              updatedStoryboardsAfterError[indexToSave] = {
                ...updatedStoryboardsAfterError[indexToSave],
                isGenerating: undefined,
              }
              setStoryboardImages(updatedStoryboardsAfterError)
            }
            if (error instanceof Error && error.name === 'AbortError') {
              toast({
                title: t("operationCancelled"),
                description: t("retryLater"),
              })
            } else {
              toast({
                title: t("regenerationFailed"),
                description: error instanceof Error ? error.message : t("retryLater"),
                variant: "destructive",
              })
            }
          }

          // 发送保存成功事件
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('storyboard-saved', {
              detail: {
                index: indexToSave,
                data: finalStoryboardData,
                frameType: editedData.isEditingFirstFrame ? 'first' : 'last'
              }
            }))
          }

          return
        }
        
        // 普通模式或全部分镜图编辑，重新生成分镜图
        setWorkflowLoading(true)
        setWorkflowStep('storyboard')
        setIsRegeneratingStoryboard(indexToSave)

        toast({
          title: t("regeneratingStoryboard"),
          description: t("pleaseWait"),
        })

        // ========== 清空该分镜图 URL，进入「生成中」视觉状态 ==========
        const updatedStoryboardsForGenerate = [...storyboardImages]
        updatedStoryboardsForGenerate[indexToSave] = null as unknown as StoryboardItem
        setStoryboardImages(updatedStoryboardsForGenerate)

        // 同时清空对应剧情视频的 URL
        if (sceneVideos[indexToSave]) {
          const updatedSceneVideosForGenerate = [...sceneVideos]
          updatedSceneVideosForGenerate[indexToSave] = { ...updatedSceneVideosForGenerate[indexToSave], videoUrl: null }
          setSceneVideos(updatedSceneVideosForGenerate)
        }

        try {
          // 调用 API 重新生成分镜图
          const scene = (scriptData?.scenes ?? [])[indexToSave]
          const sceneCharacterIds = scene.characterIds || []
          const sceneCharacters = characterData.filter((char: CharacterItem) => sceneCharacterIds.includes(String(char.id)))

          const characterImages = sceneCharacters.length > 0
            ? sceneCharacters.map((char: any) => ({
                characterId: char.id,
                imageUrl: char.imageUrl,
                imagePrompt: char.generationPrompt || char.prompt || char.description || ''
              }))
            : []

          // 检查是否是编辑单个帧（首尾帧模式）
          const editedData = editedStoryboardData || {}
          const isEditingSingleFrame = editedData.isEditingFirstFrame || editedData.isEditingLastFrame

          // 创建临时 scene 对象，包含自定义 prompt
          // 如果是编辑单个帧，只更新对应帧的 prompt
          const sceneWithCustomPrompt: any = {
            ...scene,
            storyboardPrompt: currentPrompt,
          }
          
          if (generationMode === 'first-last-frame' && isEditingSingleFrame) {
            if (editedData.isEditingFirstFrame) {
              sceneWithCustomPrompt.firstFramePrompt = currentPrompt
            } else if (editedData.isEditingLastFrame) {
              sceneWithCustomPrompt.lastFramePrompt = currentPrompt
            }
          }

          const regenerateFrameType = editedData.isEditingFirstFrame ? 'first' : 
                                     editedData.isEditingLastFrame ? 'last' : undefined

          const storyboardItem = await generateStoryboardForScene({
            scene: sceneWithCustomPrompt,
            sceneIndex: indexToSave,
            aspectRatio: String(scene.aspectRatio || '16:9'),
            characterImages,
            consolePrefix: '[edit-storyboard]',
            versionId: currentEditVersionId.current || undefined,
            versionGroupId: vgId,
            itemId: scene.id,
            regenerateFrameType,  // 只重新生成指定的帧
          })

          if (storyboardItem?.url) {
            finalStoryboardData = {
              ...finalStoryboardData,
              url: storyboardItem.url,
              thumbnailUrl: storyboardItem.thumbnailUrl || storyboardItem.url,
              prompt: storyboardItem.prompt || currentPrompt,
              // 保留首尾帧信息
              firstFrameUrl: storyboardItem.firstFrameUrl || storyboardItem.url,
              lastFrameUrl: storyboardItem.lastFrameUrl || '',
              firstFramePrompt: storyboardItem.firstFramePrompt || '',
              lastFramePrompt: storyboardItem.lastFramePrompt || '',
            }
          }
        } catch (error) {
          console.error('重新生成分镜图失败:', error)
          toast({
            title: t("regenerateFailed"),
            description: t("retryLater"),
            variant: "destructive",
          })
          setWorkflowLoading(false)
          setIsRegeneratingStoryboard(null)
          return
        }

        // 清除「重新生成中」状态
        setIsRegeneratingStoryboard(null)
        setWorkflowLoading(false)
      }

      // 如果是上传了图片，直接使用上传的图片，不需要重新生成
      if (imageChanged) {
        const editedData = editedStoryboardData || {}
        toast({
          title: t("imageUpdated"),
          description: t("storyboardUpdated"),
        })

        // 如果是编辑单个帧，只更新对应帧的 URL
        if (editedData.isEditingFirstFrame) {
          finalStoryboardData = {
            ...finalStoryboardData,
            firstFrameUrl: finalStoryboardData.url,
            url: finalStoryboardData.url,
            thumbnailUrl: finalStoryboardData.thumbnailUrl || finalStoryboardData.url,
          }
        } else if (editedData.isEditingLastFrame) {
          finalStoryboardData = {
            ...finalStoryboardData,
            lastFrameUrl: finalStoryboardData.url,
            thumbnailUrl: finalStoryboardData.thumbnailUrl || finalStoryboardData.url,
          }
        } else {
          // 普通模式
          finalStoryboardData = {
            ...finalStoryboardData,
            thumbnailUrl: finalStoryboardData.thumbnailUrl || finalStoryboardData.url,
          }
        }
      }

      // 如果有本地URL（上传失败时的备用），清理它
      if (finalStoryboardData.localUrl) {
        finalStoryboardData = {
          ...finalStoryboardData,
          localUrl: undefined
        }
      }

      finalStoryboardData = {
        ...finalStoryboardData,
        sceneId: (scriptData?.scenes ?? [])[indexToSave]?.id ?? '',
        sceneIndex: indexToSave,
        // 移除编辑标记
        isEditingFirstFrame: undefined,
        isEditingLastFrame: undefined,
      }

      // 更新分镜图数据
      const updatedStoryboardImages = [...storyboardImages]
      updatedStoryboardImages[indexToSave] = finalStoryboardData
      setStoryboardImages(updatedStoryboardImages)

      // 重新生成对应的剧情视频和完整视频（分镜图变更后必须级联更新）
      await regenerateCorrespondingSceneVideo(
        indexToSave,
        finalStoryboardData,
        updatedStoryboardImages,
        vgId
      )

      if (promptChanged) {
        toast({
          title: t("promptUpdated"),
          description: t("storyboardRegenerated"),
        })
      }
    }
  }

  // 取消编辑分镜图
  const handleCancelEditStoryboard = () => {
    setIsEditingStoryboard(false)
    setEditingStoryboardIndex(null)
    setEditedStoryboardData(null)
    setStoryboardImageFile(null)
    setStoryboardEditMode('none')
  }

  // 重新生成对应的剧情视频和完整视频
  const regenerateCorrespondingSceneVideo = async (sceneIndex: number, updatedStoryboardImage: any, updatedStoryboardImages?: any[], versionGroupId?: string) => {
    if (!scriptData || !characterData || characterData.length === 0) return

    // 设置「重新生成中」状态
    setIsRegeneratingSceneVideo(sceneIndex)

    try {
      setWorkflowLoading(true)
      setWorkflowStep('scenes')

      // 只重新生成对应的剧情视频
      const scene = (scriptData?.scenes ?? [])[sceneIndex]

      const videoItem = await generateSceneVideoForScene({
        scene,
        sceneIndex,
        storyboardImage: updatedStoryboardImage,
        aspectRatio,
        consolePrefix: '[operate]',
        versionId: currentEditVersionId.current || undefined,
        versionGroupId: versionGroupId,
      })

      // 如果是错误结果（有 error 字段），直接抛出错误，中断后续的完整视频生成
      if (videoItem && videoItem.error) {
        throw new Error(videoItem.error)
      }

      // 检查是否暂停（与单个主角一致）
      await waitForWorkflowResume()

      // 自动重新生成完整视频（与单个主角一致）
      setWorkflowStep('video')
      setWorkflowLoading(true)
      setVideoData(null) // 清空旧的总视频，显示"生成中"状态

      // 使用通用函数生成完整视频
      const mergedSceneVideos = [...sceneVideos]
      mergedSceneVideos[sceneIndex] = videoItem

      abortControllerRef.current = new AbortController()

      const finalVideoData = await composeSceneVideosWithFAL(
        mergedSceneVideos,
        scriptData,
        abortControllerRef.current?.signal,
        currentProjectId || undefined,
        currentEditVersionId.current || undefined,
        versionGroupId
      )

      if (!finalVideoData) {
        setWorkflowLoading(false)
        setIsRegeneratingSceneVideo(null)
        toast({
          title: t("videoComposeSkipped"),
          description: t("noValidSceneVideosSkipFinal"),
        })
      } else {
        setVideoData(finalVideoData)

        setWorkflowLoading(false)
        setIsRegeneratingSceneVideo(null)
      }

    } catch (error) {
      setWorkflowLoading(false)
      setIsRegeneratingSceneVideo(null)
      toast({
        title: t("regenerationFailed"),
        description: error instanceof Error ? error.message : t("retryLater"),
        variant: "destructive",
      })
    }
  }

    // 开始编辑场景视频
    const handleStartEditSceneVideo = (index: number) => {
      if (sceneVideos[index]) {
        setEditedSceneVideoData(JSON.parse(JSON.stringify(sceneVideos[index])))
        setEditingSceneVideoIndex(index)
        setIsEditingSceneVideo(true)
        setShowSceneVideoPreview(true)
      }
    }
  
    // 显示编辑剧情视频保存确认弹窗
    const handleShowSaveEditSceneVideoDialog = () => {
      setShowSaveEditSceneVideoDialog(true)
    }
  
    // 执行保存编辑的剧情视频
    const handleConfirmSaveEditedSceneVideo = async () => {
      // 先关闭确认弹窗、编辑弹窗和详情弹窗，并清空选中状态，避免确认后仍看到「剧情视频详情」或关闭动画时闪现 Close 按钮
      const indexToSave = editingSceneVideoIndex
      const dataToSave = editedSceneVideoData ? { ...editedSceneVideoData } : null

      setShowSaveEditSceneVideoDialog(false)
      setIsEditingSceneVideo(false)
      setShowSceneVideoPreview(false)
      setEditingSceneVideoIndex(null)
      setEditedSceneVideoData(null)

      if (dataToSave != null && indexToSave !== null && scriptData && characterData) {
        // 检查提示词是否被修改
        const originalSceneVideo = sceneVideos[indexToSave]
        const currentPrompt = String(dataToSave.prompt ?? '')
        const originalPrompt = String(originalSceneVideo?.prompt ?? '')
        const promptChanged = currentPrompt.trim() !== originalPrompt.trim()

        // 生成版本组ID（用于关联同一批次的重新生成任务）
        const vgId = generateVersionGroupId()

        let finalSceneVideoData = { ...dataToSave }

        // 如果提示词被修改，重新生成视频（与分镜图流程一致）
        if (promptChanged && currentPrompt.trim()) {
          setWorkflowLoading(true)
          setWorkflowStep('scenes')
          setIsRegeneratingSceneVideo(indexToSave)

          toast({
            title: t("regeneratingSceneVideo"),
            description: t("pleaseWait"),
          })

          // ========== 清空该剧情视频 URL，进入「生成中」视觉状态 ==========
          if (sceneVideos[indexToSave]) {
            const updatedSceneVideosForGenerate = [...sceneVideos]
            updatedSceneVideosForGenerate[indexToSave] = { ...updatedSceneVideosForGenerate[indexToSave], videoUrl: null }
            setSceneVideos(updatedSceneVideosForGenerate)
          }

          try {
            const scene = (scriptData?.scenes ?? [])[indexToSave]
            // 创建临时 scene 对象，包含自定义 prompt
            const sceneWithCustomPrompt = {
              ...scene,
              sceneVideoPrompt: currentPrompt,
            }

            // 获取对应的分镜图
            const storyboardImage = storyboardImages[indexToSave]

            const videoItem = await generateSceneVideoForScene({
              scene: sceneWithCustomPrompt,
              sceneIndex: indexToSave,
              storyboardImage,
              aspectRatio: String(dataToSave.aspectRatio ?? aspectRatio ?? '16:9'),
              consolePrefix: '[edit-scene-video]',
              versionId: currentEditVersionId.current || undefined,
              versionGroupId: vgId,
            })

            if (videoItem?.videoUrl) {
              finalSceneVideoData = {
                ...finalSceneVideoData,
                videoUrl: videoItem.videoUrl,
                thumbnailUrl: videoItem.thumbnailUrl || videoItem.videoUrl,
                prompt: videoItem.prompt || currentPrompt,
                duration: videoItem.duration || finalSceneVideoData.duration,
              }
            }
          } catch (error) {
            console.error('重新生成剧情视频失败:', error)
            toast({
              title: t("regenerateFailed"),
              description: t("retryLater"),
              variant: "destructive",
            })
            setWorkflowLoading(false)
            setIsRegeneratingSceneVideo(null)
            return
          }

          // 清除「重新生成中」状态
          setIsRegeneratingSceneVideo(null)
          setWorkflowLoading(false)
        }

        // 更新剧情视频数据
        finalSceneVideoData = {
          ...finalSceneVideoData,
          sceneId: (scriptData?.scenes ?? [])[indexToSave]?.id ?? '',
          sceneIndex: indexToSave
        }

        const updatedSceneVideos = [...sceneVideos]
        updatedSceneVideos[indexToSave] = finalSceneVideoData
        setSceneVideos(updatedSceneVideos)

        setIsEditingSceneVideo(false)
        setEditingSceneVideoIndex(null)
        setEditedSceneVideoData(null)
        setShowSceneVideoPreview(false)

        if (promptChanged) {
          // 重新生成完整视频
          toast({
            title: t("sceneVideoSavedAndRegenerated"),
            description: t("autoRecomposingFinalVideo"),
          })

          try {
            setWorkflowLoading(true)
            setVideoData(null) // 清空旧的总视频，显示"生成中"状态
            // 使用 FAL AI 生成完整视频
            const videoDataResult = await composeSceneVideosWithFAL(updatedSceneVideos, scriptData, undefined, currentProjectId || undefined, currentEditVersionId.current || undefined, vgId)

            if (videoDataResult) {
              setVideoData(videoDataResult)
              setWorkflowLoading(false)

              toast({
                title: t("finalVideoRecomposed"),
                description: t("sceneVideosAndFinalUpdated"),
              })
            } else {
              setWorkflowLoading(false)
              toast({
                title: t("videoComposeSkipped"),
                description: t("noValidSceneVideosSkipFinal"),
              })
            }
          } catch (error) {
            setWorkflowLoading(false)
            toast({
              title: t("videoComposeFailedTitle"),
              description: error instanceof Error ? error.message : t("manuallyRecomposeFinalVideo"),
              variant: "destructive",
            })
          }
        } else {
          toast({
            title: t("sceneVideoSaved"),
            description: t("canContinueEditOrRecompose"),
          })
        }
      }
    }
  
    // 取消编辑场景视频
    const handleCancelEditSceneVideo = () => {
      setIsEditingSceneVideo(false)
      setEditingSceneVideoIndex(null)
      setEditedSceneVideoData(null)
    }

  // 处理分镜图图片上传
  const handleStoryboardImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 检查文件类型
    if (!file.type.startsWith('image/')) {
      toast({
        title: t("fileTypeError"),
        description: t("pleaseUploadImageFile"),
        variant: "destructive",
      })
      return
    }

    // 检查文件大小
    const sizeLimit = computeFileSizeLimit(subscriptionPlan)
    if (file.size > sizeLimit) {
      handleFileSizeExceeded()
      return
    }

    setStoryboardImageFile(file)
    setIsUploadingStoryboardImage(true)

    // 直接上传，不显示本地预览
    ;(async () => {
      const reader = new FileReader()
      const dataUrl: string = await new Promise((resolve, reject) => {
        reader.onerror = () => reject(new Error("File read error"))
        reader.onload = () => resolve(String(reader.result))
        reader.readAsDataURL(file)
      })
      const base64Data = dataUrl.split(',')[1]

      // 检查存储空间
      const { available, storageInfo } = await checkStorageAvailable(file.size)
      if (!available && storageInfo) {
        handleStorageLimitExceeded(storageInfo)
        setIsUploadingStoryboardImage(false)
        return
      }

      try {
        const uploadResponse = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type,
            data: base64Data
          })
        })

        if (!uploadResponse.ok) {
          const data = await uploadResponse.json().catch(() => ({}))
          throw new Error(data.message || t('uploadFailed'))
        }

        const uploadResult = await uploadResponse.json()

        // 上传成功，显示预览
        setEditedStoryboardData({
          ...editedStoryboardData,
          url: uploadResult.url
        })
        // 用户上传图片时设置为 image 模式（用于 UI 禁用 Prompt 输入框）
        setStoryboardEditMode('image')
        setIsUploadingStoryboardImage(false)
      } catch (error) {
        setIsUploadingStoryboardImage(false)
        toast({
          title: t("uploadFailed"),
          description: error instanceof Error ? error.message : t("pleaseRetry"),
          variant: "destructive",
        })
      }
    })()
  }

  // 处理粘贴分镜图图片
  const handleStoryboardImagePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile()
        if (file) {
          // 检查文件大小
          const sizeLimit = computeFileSizeLimit(subscriptionPlan)
          if (file.size > sizeLimit) {
            handleFileSizeExceeded()
            return
          }

          setStoryboardImageFile(file)
          setIsUploadingStoryboardImage(true)

          // 直接上传，不显示本地预览
          ;(async () => {
            const reader = new FileReader()
            const dataUrl: string = await new Promise((resolve, reject) => {
              reader.onerror = () => reject(new Error("File read error"))
              reader.onload = () => resolve(String(reader.result))
              reader.readAsDataURL(file)
            })
            const base64Data = dataUrl.split(',')[1]

            // 检查存储空间
            const { available, storageInfo } = await checkStorageAvailable(file.size)
            if (!available && storageInfo) {
              handleStorageLimitExceeded(storageInfo)
              setIsUploadingStoryboardImage(false)
              return
            }

            try {
              const uploadResponse = await fetch('/api/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  filename: file.name || 'pasted-image.png',
                  contentType: file.type || 'image/png',
                  data: base64Data
                })
              })

              if (!uploadResponse.ok) {
                const data = await uploadResponse.json().catch(() => ({}))
                throw new Error(data.message || t('uploadFailed'))
              }

              const uploadResult = await uploadResponse.json()

              setEditedStoryboardData({
                ...editedStoryboardData,
                url: uploadResult.url
              })
              // 用户上传图片时设置为 image 模式
              setStoryboardEditMode('image')
              setIsUploadingStoryboardImage(false)
            } catch (error) {
              setIsUploadingStoryboardImage(false)
              toast({
                title: t("uploadFailed"),
                description: error instanceof Error ? error.message : t("pleaseRetry"),
                variant: "destructive",
              })
            }
          })()
        }
        break
      }
    }
  }

  // TODO: 测试阶段暂时注释积分获取，正式上线时取消注释
  useEffect(() => {
    // 获取当前用户积分
    // const fetchPoints = async () => {
    //   try {
    //     const res = await fetch("/api/user/points")
    //     if (!res.ok) return
    //     const json = await res.json()
    //     if (json?.success && json?.data?.points != null) {
    //       setCurrentPoints(Number(json.data.points))
    //     }
    //   } catch (err) {
    //     console.error("fetch points error:", err)
    //   }
    // }

    // if (status === "authenticated") {
    //   fetchPoints()
    // }
  }, [status])

  // 获取文件大小超限提示
  const getFileSizeExceededMessage = (type: "image" | "audio" | "video"): { title: string; description: string } => {
    const limit = computeFileSizeLimit(subscriptionPlan)
    const limitMB = Math.round(limit / (1024 * 1024))
    let limitText = `${limitMB}MB`

    // Annual 显示无限制
    if (subscriptionPlan === 'annual') {
      limitText = t("noLimit")
    }

    const typeText = type === "image" ? t("image") : (type === "audio" ? t("audio") : t("video"))
    return {
      title: t("fileTooLarge"),
      description: t("fileSizeExceeded", { type: typeText, limit: limitText })
    }
  }

  // 上传清单/链接图片清单管理（hooks/use-upload-items.ts，拆分 T11，函数体逐字搬移，行为与原来一致）
  const {
    uploadingItems,
    setUploadingItems,
    handleFileSelect,
    addImageUrl,
    removeImageUrl,
    handleAddLink,
  } = useUploadItems({
    subscriptionPlan,
    checkStorageAvailable,
    handleStorageLimitExceeded,
    handleFileSizeExceeded,
    onImageUpload,
    setSelectedImages,
    imageUrls,
    setImageUrls,
    setVideoUrls,
    setAudioUrls,
    fileInputRef,
    setShowUploadPopover,
    linkInput,
    setLinkInput,
    setShowLinkInput,
  })

  // 素材库选择弹窗状态（hooks/use-library-selection.ts，行为与原来一致）
  const { libraryOpen, openLibrary, handleSelect: handleLibrarySelect, setLibraryOpen } = useLibrarySelection(addImageUrl)

  const [previewIndex, setPreviewIndex] = useState<number | null>(null)

  const [videoModel, setVideoModel] = useState<string>("auto") // auto/veo31Fast/veo31Lite/veo31Quality/geminiOmni/seedance25/seedance2Fast/seedance2Mini/seedance2/kling3/happyHorse/wan27/minimaxH3
  const [videoResolution, setVideoResolution] = useState<string>("720p") // 480p/720p/1080p（仅声明支持的模型可选，默认档跟随现状）
  // 场景视频生成积分预估（与路由预检同源：主模型×所选分辨率档；auto 视为默认路由）——公式在 lib/points-estimate.ts（拆分 T11）
  const estimateSceneVideoPoints = (sceneIndex?: number | null): number => {
    const scene = scriptData?.scenes?.[sceneIndex ?? -1] as { duration?: number } | undefined
    return estimateSceneVideoPointsPure({ videoModel, videoResolution, sceneDuration: scene?.duration })
  }

  // 一键生成积分预估：大头是视频生成（总时长 × 选中模型×分辨率单价）；剧本/主角/分镜为
  // 小额固定项未计入，故为「起」价。auto 模型按默认路由、时长 auto 按 24s 估——公式在 lib/points-estimate.ts
  const pointsCost = estimateWorkflowPoints({ videoModel, videoResolution, duration })
  const [generationMode, setGenerationMode] = useState<string>("auto") // auto/first-last-frame
  // 故事板/分镜图生成状态块（hooks/use-storyboard-generation.ts，函数体逐字搬移，行为与原来一致）
  const {
    generateStoryboardForScene,
    regenerateSingleFrame,
    handleConfirmRegenerateStoryboard,
    resumeStoryboardGeneration,
  } = useStoryboardGeneration({
    abortControllerRef,
    versionGroupIdRef,
    currentProjectIdRef,
    currentEditVersionId,
    workflowPausedRef,
    workflowInterruptedRef,
    aspectRatio,
    generationMode,
    characterData,
    scriptData,
    sceneVideos,
    storyboardImages,
    currentProjectId,
    storyboardToRegenerate,
    setCurrentPoints,
    setPurchaseDialogType,
    setShowPurchaseDialog,
    setWorkflowPaused,
    setStoryboardImages,
    setIsRegeneratingStoryboard,
    setSceneVideos,
    setVideoData,
    setWorkflowError,
    setWorkflowLoading,
    setWorkflowStep,
    setShowRegenerateStoryboardDialog,
    waitForGenerationResult,
    waitForWorkflowResume,
    generateVersionGroupId,
    generateSceneVideoForScene,
    composeSceneVideosWithFAL,
    resumeSceneVideosGeneration,
  })
  // 主角图片生成状态块（hooks/use-character-generation.ts，函数体逐字切片搬移，行为与原来一致）
  const {
    generateCharacterForSingle,
    mergeCharactersFromResults,
    handleShowRegenerateCharacterDialog,
    handleConfirmRegenerateCharacter,
    handleStartEditCharacter,
    handleShowSaveEditCharacterDialog,
    handleConfirmSaveEditedCharacter,
    handleCancelEditCharacter,
    handleCharacterImageUpload,
    handleCharacterImageUrl,
    handleCharacterImagePaste,
  } = useCharacterGeneration({
    abortControllerRef,
    versionGroupIdRef,
    currentProjectIdRef,
    currentEditVersionId,
    workflowInterruptedRef,
    workflowPausedRef,
    aspectRatio,
    characterData,
    scriptData,
    storyboardImages,
    currentProjectId,
    characterToRegenerate,
    sceneVideos,
    subscriptionPlan,
    editedCharacterData,
    characterImageFile,
    setCharacterData,
    setCurrentPoints,
    setPurchaseDialogType,
    setShowPurchaseDialog,
    setWorkflowPaused,
    setIsGenerating,
    setIsRegeneratingCharacterId,
    setSceneVideos,
    setShowRegenerateCharacterDialog,
    setStoryboardImages,
    setVideoData,
    setWorkflowError,
    setWorkflowLoading,
    setWorkflowStep,
    setCharacterEditMode,
    setCharacterImageFile,
    setEditedCharacterData,
    setIsEditingCharacter,
    setIsRegeneratingSceneVideo,
    setIsRegeneratingStoryboard,
    setShowCharacterPreview,
    setShowSaveEditCharacterDialog,
    setIsUploadingCharacterImage,
    setScriptData,
    waitForGenerationResult,
    waitForWorkflowResume,
    generateVersionGroupId,
    generateSceneVideoForScene,
    generateStoryboardForScene,
    composeSceneVideosWithFAL,
    checkStorageAvailable,
    handleStorageLimitExceeded,
    computeFileSizeLimit,
    setCharacterToRegenerate,
    handleFileSizeExceeded,
  })

  // 上传视频/音频时，强制只允许 seedance2 / seedance2Fast / seedance2Mini / seedance25；当前模型不兼容则自动切换
  const hasMedia = uploadingItems.some(
    (it) => it.type === "video" || it.type === "audio",
  )
  useEffect(() => {
    if (hasMedia) {
      if (!MEDIA_COMPATIBLE_VIDEO_MODELS.includes(videoModel)) {
        // 默认落到兼容档里最便宜的 seedance2Fast（2分/秒），最贵的 seedance25（9分/秒）
        // 保留给用户手动选择，避免上传素材即被切进高价档
        setVideoModel("seedance2Fast")
      }
    }
  }, [hasMedia])

  const [videoStyle, setVideoStyle] = useState<string>("auto")
  const [showSettingsPopover, setShowSettingsPopover] = useState(false)

  const openPreviewAt = (index: number) => {
    if (index < 0 || index >= imageUrls.length) return
    if (previewImage) {
      // no object URL to revoke when previewing remote images, just clear state
      setPreviewImage(null)
    }
    const url = imageUrls[index]
    setPreviewImage(url)
    setPreviewIndex(index)
    if (typeof window !== "undefined") {
      document.body.classList.add("preview-open")
    }
  }

  const openPreview = (url: string) => {
    const idx = imageUrls.findIndex((u) => u === url)
    if (idx !== -1) openPreviewAt(idx)
  }

  const closePreview = () => {
    if (previewImage) {
      URL.revokeObjectURL(previewImage)
      setPreviewImage(null)
      if (typeof window !== "undefined") {
        document.body.classList.remove("preview-open")
      }
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return

    const files: File[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const file = item.getAsFile()
      if (file) files.push(file)
    }
    if (files.length === 0) return

    // 支持图片、音频、视频
    const validFiles = files.filter((f) => {
      const type = f.type.startsWith("image/") || f.type.startsWith("audio/") || f.type.startsWith("video/")
      return type
    })
    const invalidCount = files.length - validFiles.length
    if (invalidCount > 0) {
      toast({
        title: t("fileTypeError"),
        description: t("invalidFileType"),
        variant: "destructive",
      })
    }
    if (validFiles.length === 0) return

    // prevent default paste behavior when files are present
    e.preventDefault()

    // 分类文件
    const imageFiles = validFiles.filter((f) => f.type.startsWith("image/"))

    // reuse the same upload workflow as file select
    if (imageFiles.length > 0) {
      setSelectedImages((prev) => [...prev, ...imageFiles])
    }

    // 计算所有文件的总大小
    const totalSize = validFiles.reduce((sum, file) => sum + file.size, 0)

    // 检查存储空间是否足够
    ;(async () => {
      const { available, storageInfo } = await checkStorageAvailable(totalSize)
      if (!available && storageInfo) {
        handleStorageLimitExceeded(storageInfo)
        return
      }

      // 处理所有文件的上传
      validFiles.forEach((file) => {
        const fileType = file.type.startsWith("image/") ? "image" : (file.type.startsWith("audio/") ? "audio" : "video")
        const sizeLimit = computeFileSizeLimit(subscriptionPlan)

        // 检查文件大小
        if (file.size > sizeLimit) {
          handleFileSizeExceeded()
          return
        }

        if (fileType === "image") {
          onImageUpload?.(file)
        }

        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const localUrl = URL.createObjectURL(file)
        setUploadingItems((prev) => [...prev, { id, filename: file.name, localUrl, status: "uploading", type: fileType }])

        ;(async () => {
          try {
            const reader = new FileReader()
            const dataUrl: string = await new Promise((resolve, reject) => {
              reader.onerror = () => reject(new Error("File read error"))
              reader.onload = () => resolve(String(reader.result))
              reader.readAsDataURL(file)
            })
            const match = dataUrl.match(/^data:(.+);base64,(.+)$/)
            if (!match) throw new Error("Invalid file data")
            const contentType = match[1]
            const base64 = match[2]

            const res = await fetch("/api/upload", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                filename: file.name,
                contentType,
                data: base64,
              }),
            })
            if (!res.ok) {
              const data = await res.json().catch(() => ({}))
              console.error("Upload failed", data.message || t('uploadFailed'))
              setUploadingItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "error" } : it)))
            } else {
              const json = await res.json()
              if (json?.url) {
                setUploadingItems((prev) =>
                  prev.map((it) => (it.id === id ? { ...it, status: "done", url: json.url } : it))
                )
                // 只将图片 URL 添加到 imageUrls
                if (fileType === "image") {
                  setImageUrls((prev) => [...prev, json.url])
                }
                try {
                  URL.revokeObjectURL(localUrl)
                } catch {}
              } else {
                setUploadingItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "error" } : it)))
              }
            }
          } catch (err) {
            console.error("Upload error:", err)
            setUploadingItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "error" } : it)))
          }
        })()
      })
    })()
  }

  const touchStartX = useRef<number | null>(null)
  const touchEndX = useRef<number | null>(null)

  const showPrev = (e?: React.MouseEvent | TouchEvent) => {
    e?.stopPropagation()
    if (previewIndex == null) return
    const prev = (previewIndex - 1 + imageUrls.length) % imageUrls.length
    const url = imageUrls[prev]
    setPreviewImage(url)
    setPreviewIndex(prev)
  }

  const showNext = (e?: React.MouseEvent | TouchEvent) => {
    e?.stopPropagation()
    if (previewIndex == null) return
    const next = (previewIndex + 1) % imageUrls.length
    const url = imageUrls[next]
    setPreviewImage(url)
    setPreviewIndex(next)
  }

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    touchEndX.current = e.changedTouches[0].clientX
    if (touchStartX.current != null && touchEndX.current != null) {
      const dx = touchEndX.current - touchStartX.current
      if (Math.abs(dx) > 50) {
        if (dx > 0) showPrev()
        else showNext()
      }
    }
    touchStartX.current = null
    touchEndX.current = null
  }

  return (
    <div className="w-full h-full flex items-center justify-center p-4 md:p-8 pb-16">
      <div className="w-full max-w-full px-2 md:px-0">
        <div className="relative">
          {showInputBox && (
            <CreatePanel
              message={message}
              setMessage={setMessage}
              isGenerating={isGenerating}
              status={status}
              handleSend={handleSend}
              handleKeyDown={handleKeyDown}
              handlePaste={handlePaste}
              placeholderText={placeholderText}
              uploadingItems={uploadingItems}
              setUploadingItems={setUploadingItems}
              imageUrls={imageUrls}
              setImageUrls={setImageUrls}
              videoUrls={videoUrls}
              setVideoUrls={setVideoUrls}
              audioUrls={audioUrls}
              setAudioUrls={setAudioUrls}
              selectedImages={selectedImages}
              hasMedia={hasMedia}
              showUploadPopover={showUploadPopover}
              setShowUploadPopover={setShowUploadPopover}
              showSettingsPopover={showSettingsPopover}
              setShowSettingsPopover={setShowSettingsPopover}
              setShowLinkInput={setShowLinkInput}
              fileInputRef={fileInputRef}
              textareaRef={textareaRef}
              handleFileSelect={handleFileSelect}
              openLibrary={openLibrary}
              fetchStorageInfo={fetchStorageInfo}
              openPreview={openPreview}
              openPreviewAt={openPreviewAt}
              removeImageUrl={removeImageUrl}
              setPreviewImage={setPreviewImage}
              setStorageLimitInfo={setStorageLimitInfo}
 storageLimitInfo={storageLimitInfo}
              setIsSignInDialogOpen={setIsSignInDialogOpen}
              subscriptionPlan={subscriptionPlan}
              videoModel={videoModel}
              setVideoModel={setVideoModel}
              videoResolution={videoResolution}
              setVideoResolution={setVideoResolution}
              generationMode={generationMode}
              setGenerationMode={setGenerationMode}
              aspectRatio={aspectRatio}
              setAspectRatio={setAspectRatio}
              duration={duration}
              setDuration={setDuration}
              videoStyle={videoStyle}
              setVideoStyle={setVideoStyle}
              pointsCost={pointsCost}
            />
          )}
	        </div>

        {/* 工作流步骤展示 - 独立区域 */}
        {(workflowStep !== 'idle' || scriptData) && (
          <div className="w-full max-w-7xl -mt-24">
            <div className={cn(
              "rounded-[28px] bg-background/95 backdrop-blur-md border p-4 md:p-6 shadow-2xl shadow-primary/5",
              workflowPaused ? "border-orange-500/50 bg-orange-500/5" : "border-border"
            )}>
              <div className="space-y-4">
              <WorkflowHeader
                workflowStep={workflowStep}
                workflowPaused={workflowPaused}
                workflowLoading={workflowLoading}
                isGenerating={isGenerating}
                scriptData={scriptData}
                characterData={characterData}
                storyboardImages={storyboardImages}
                sceneVideos={sceneVideos}
                videoData={videoData}
                resumeProjectId={resumeProjectId}
                restoredVersionHasVideo={restoredVersionHasVideo}
                restoredProjectCompleted={restoredProjectCompleted}
                handlePauseResumeWorkflow={handlePauseResumeWorkflow}
                handleResumeContinue={handleResumeContinue}
              />
              <ScriptStep
                scriptData={scriptData}
                workflowLoading={workflowLoading}
                workflowPaused={workflowPaused}
                handleShowRegenerateScriptDialog={handleShowRegenerateScriptDialog}
              />
              {/* 步骤2: 主角展示 */}
              {characterData && characterData.length > 0 && (
                <div className="p-4 rounded-lg bg-muted/50 border border-border space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{t("characterListTitle", { count: characterData.length })}</span>
                  </div>

                  {/* 主角列表 */}
                  <div className="space-y-3">
                    {characterData.map((character: any, index: number) => (
                      <div key={character.id || index} className="p-3 rounded-lg bg-background border border-border">
                        <div className="flex gap-3">
                          <div className="w-12 h-12 md:w-16 md:h-16 rounded-lg overflow-hidden relative bg-muted/20 flex items-center justify-center">
                            { (character.thumbnailUrl || character.imageUrl) ? (
                              <img
                                src={character.thumbnailUrl || character.imageUrl}
                                alt={character.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" className="w-10 h-10 text-muted-foreground">
                                <rect x="4" y="4" width="92" height="92" rx="8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.06" />
                                <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
                                  <path d="M10 10 L90 90" opacity="0.12" />
                                  <path d="M10 90 L90 10" opacity="0.08" />
                                </g>
                              </svg>
                            )}

                            {/* 失败状态显示（优先显示重新生成状态，然后才是错误） */}
                            {isRegeneratingCharacterId === character.id ? (
                              <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg text-white text-xs">
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                {t("generating")}
                              </div>
                            ) : character.generationError ? (
                              <div className="absolute inset-0 bg-red-500/80 flex items-center justify-center rounded-lg text-white text-xs p-1 text-center">
                                <span className="line-clamp-2">{character.generationError}</span>
                              </div>
                            ) : (
                              /* 只要没有图片且没有错误就显示"正在生成" */
                              (workflowLoading && workflowStep === 'character' && !(character.thumbnailUrl || character.imageUrl)) ? (
                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg text-white text-xs">
                                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                  {t("generating")}
                                </div>
                              ) : null
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-bold mb-1">{t("characterNamePrefix", { name: character.name })}</h4>
                            <p className="text-xs text-muted-foreground mb-2">{character.description}</p>
                            <div className="flex flex-wrap gap-2 text-xs">
                              <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full">{character.role}</span>
                            </div>
                            {/* 提示词在查看模式下已隐藏 */}
                          </div>
                        </div>

                        {/* 单个主角的操作按钮 */}
                        <div className="flex flex-col sm:flex-row gap-2 mt-3 pt-3 border-t border-border min-w-0">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditedCharacterData(character)
                              setIsEditingCharacter(false)
                              setShowCharacterPreview(true)
                            }}
                            disabled={(!character.thumbnailUrl && !character.imageUrl) || !!character.generationError}
                            className="w-full sm:flex-1 min-w-0"
                          >
                            <Eye className="w-3 h-3 mr-1" />
                            {t("view")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const url = character.thumbnailUrl || character.imageUrl
                              const key = `character-${character.id || index}`
                              handleDownloadFile(url, `${character.name || 'character'}.png`, key)
                            }}
                            disabled={(!character.thumbnailUrl && !character.imageUrl) || !!character.generationError}
                            className="w-full sm:flex-1 min-w-0"
                          >
                            {downloadingKey === `character-${character.id || index}` ? (
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
                          {/* 单个主角编辑按钮 */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleStartEditCharacter(character)}
                            disabled={workflowLoading}
                            className="w-full sm:flex-1 min-w-0"
                          >
                            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            {t("edit")}
                          </Button>
                          {/* 重新生成按钮：即使生成失败也显示，只在工作流加载时或暂停时禁用 */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleShowRegenerateCharacterDialog(character)}
                            disabled={workflowLoading || isRegeneratingCharacterId === character.id || workflowPaused}
                            className="w-full sm:flex-1 min-w-0"
                            title={workflowPaused ? t("pauseWorkflow") : ""}
                          >
                            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            {t("regenerate")}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                </div>
              )}

              {/* 合并展示：每个剧情一行三栏（剧情详情 + 分镜图 + 剧情视频） */}
              {scriptData?.scenes && scriptData.scenes.length > 0 && (storyboardImages.length > 0 || sceneVideos.length > 0 || workflowStep === 'storyboard') && (
                <div className="p-3 md:p-4 rounded-lg bg-muted/50 border border-border space-y-3">
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <span className="text-lg">🎞️</span>
                    <span>{t("scriptAndVideo")}</span>
                  </h3>
                  <div className="space-y-3">
                    {scriptData.scenes.map((scene: any, index: number) => {
                      const sb = storyboardImages[index] as StoryboardItem | undefined
                      // 提前提取，避免在外层 `sb ?` 的 else 分支里对 sb 做 truthy 收窄（TS 会窄化为 never）
                      const sbError = sb?.error
                      const sbUrl = sb?.url
                      const sv = sceneVideos.find((v: any) => v?.sceneIndex === index) || sceneVideos?.[index]
                      // 优先使用 characterIds 数组匹配，兼容旧逻辑作为后备
                      const protagonists = (characterData || []).filter((char: any) => {
                        // 方案1：直接匹配 characterIds（最可靠）
                        if (Array.isArray(scene.characterIds) && scene.characterIds.includes(char.id)) {
                          return true
                        }
                        // 方案2：匹配 plot 中的名称（后备方案，需完全匹配）
                        return (scene.plot && char.name && scene.plot.includes(char.name)) ||
                          (scene.visualElements && Array.isArray(scene.visualElements) && scene.visualElements.some((el: any) => el.type === 'character' && el.name === char.name))
                      })

                      const aspectRatioValue = sv?.aspectRatio || sb?.aspectRatio || scene.aspectRatio
                      const durationValue = sv?.duration || scene.duration

                      return (
                        <div key={scene.id || index} className="p-3 md:p-4 rounded-md bg-background/50 border border-border">
                          <div className="flex flex-col md:flex-row gap-3">
                            {/* 第一栏：剧情详情 + 引用主角 */}
                            <div className="w-full md:w-1/4 min-w-0">
                          <div className="p-3 bg-background/50 border border-border rounded-md h-full">
                              <h4 className="text-sm font-medium mb-1">
                                {t("sceneWithIndex", { index: index + 1 })}
                                <span className="text-xs font-normal text-muted-foreground ml-2">
                                  {t("aspectRatioAndDuration", { ratio: aspectRatioValue || '—', duration: durationValue ? `${durationValue}秒` : '—' })}
                                </span>
                              </h4>
                              <div className="text-xs text-muted-foreground">
                                {scene.plot || <span className="text-muted-foreground">{t('noPlotDescription')}</span>}
                              </div>
                              {/* 比例与时长已在标题后显示，底部详情移除 */}

                              {protagonists.length > 0 && (
                                <div className="mt-3">
                                  <div className="font-medium text-xs mb-1">{t("referencedCharacters")}</div>
                                  <div className="flex flex-wrap gap-3">
                                    {protagonists.map((p: any, i: number) => (
                                      <div key={p.id || i} className="flex items-center gap-2 text-xs">
                                        {p.thumbnailUrl || p.imageUrl ? (
                                          <img src={p.thumbnailUrl || p.imageUrl} alt={p.name} className="w-6 h-6 md:w-8 md:h-8 rounded" />
                                        ) : (
                                          <div className="w-6 h-6 md:w-8 md:h-8 rounded bg-muted" />
                                        )}
                                        <div>{p.name}</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              </div>
                            </div>

                            {/* 第二栏：分镜图 + 提示词 + 操作 */}
                            <div className="w-full md:flex-1 min-w-0">
                              <div className="p-3 bg-background/50 border border-border rounded-md h-full">
                                    {sb ? (
                                <>
                                  {/* 分镜图轮播展示（支持首尾帧模式） */}
                                  <div className="w-full overflow-hidden rounded-lg max-h-48">
                                    {sb.url || sb.firstFrameUrl ? (
                                      <div className="relative group">
                                        {/* 轮播容器 */}
                                        <div 
                                          className="flex overflow-x-auto gap-1 snap-x snap-mandatory scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                                          style={{ scrollSnapType: 'x mandatory' }}
                                          onScroll={(e) => {
                                            const container = e.currentTarget
                                            const scrollLeft = container.scrollLeft
                                            const clientWidth = container.clientWidth
                                            const position = scrollLeft < clientWidth / 2 ? 'first' : 'last'
                                            setStoryboardCarouselPositions(prev => ({ ...prev, [index]: position }))
                                          }}
                                        >
                                          {/* 首帧 */}
                                          <div className="flex-shrink-0 snap-start relative w-full">
                                            <img src={sb.firstFrameUrl || sb.url} alt={t("storyboardAlt", { index: index + 1 })} className="w-full h-auto max-h-48 object-contain" />
                                            {(sb.lastFrameUrl || sb.firstFrameUrl) && (
                                              <span className="absolute top-1 left-1 px-1.5 py-0.5 text-[10px] bg-black/60 text-white rounded">
                                                {sb.firstFrameUrl ? t("firstFrame") : "1/1"}
                                              </span>
                                            )}
                                            {/* 生成中覆盖层 */}
                                            {isRegeneratingStoryboard === index && sb.isGenerating && (
                                              <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                                                <div className="flex items-center gap-2 text-white">
                                                  <Loader2 className="w-4 h-4 animate-spin" />
                                                  {t("generating")}
                                                </div>
                                              </div>
                                            )}
                                          </div>

                                          {/* 尾帧（如果有） */}
                                          {sb.lastFrameUrl && sb.lastFrameUrl !== sb.firstFrameUrl && (
                                            <div className="flex-shrink-0 snap-start relative w-full">
                                              <img src={sb.lastFrameUrl} alt={t("storyboardAlt", { index: index + 1 }) + " " + t("lastFrame")} className="w-full h-auto max-h-48 object-contain" />
                                              <span className="absolute top-1 left-1 px-1.5 py-0.5 text-[10px] bg-black/60 text-white rounded">
                                                {t("lastFrame")}
                                              </span>
                                              {/* 生成中覆盖层 */}
                                              {isRegeneratingStoryboard === index && sb.isGenerating && (
                                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                                                  <div className="flex items-center gap-2 text-white">
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    {t("generating")}
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                        
                                        {/* 左右滑动按钮（如果有尾帧） */}
                                        {sb.lastFrameUrl && sb.lastFrameUrl !== sb.firstFrameUrl && (
                                          <>
                                            <button
                                              onClick={(e) => {
                                                const container = e.currentTarget.closest('.overflow-hidden')?.querySelector('.overflow-x-auto') as HTMLElement;
                                                if (container) {
                                                  container.scrollBy({ left: -container.clientWidth, behavior: 'smooth' });
                                                }
                                              }}
                                              className="absolute left-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                                            >
                                              <ChevronLeft className="w-4 h-4" />
                                            </button>
                                            <button
                                              onClick={(e) => {
                                                const container = e.currentTarget.closest('.overflow-hidden')?.querySelector('.overflow-x-auto') as HTMLElement;
                                                if (container) {
                                                  container.scrollBy({ left: container.clientWidth, behavior: 'smooth' });
                                                }
                                              }}
                                              className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                                            >
                                              <ChevronRight className="w-4 h-4" />
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="w-full h-48 bg-muted/30 flex items-center justify-center rounded-lg">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120" className="w-full max-w-xs h-28 text-muted-foreground">
                                          <rect x="2" y="2" width="196" height="116" rx="8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.06" />
                                          <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
                                            <path d="M20 20 L180 100" opacity="0.12" />
                                            <path d="M20 100 L180 20" opacity="0.08" />
                                          </g>
                                        </svg>
                                      </div>
                                    )}
                                  </div>
                                  {/* 分镜图提示词在查看模式下已隐藏 */}
                      <div className="flex flex-col sm:flex-row flex-wrap gap-2 mt-2 min-w-0">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setEditingStoryboardIndex(index)
                                        setIsEditingStoryboard(false)
                                        setShowStoryboardPreview(true)
                                      }}
                                      disabled={!sb.url || !!sb.error}
                                    className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      <Eye className="w-3 h-3 mr-1" />
                                      {t("view")}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        // 如果有尾帧，根据当前轮播位置决定下载哪一帧
                                        const position = sb.lastFrameUrl && sb.lastFrameUrl !== sb.firstFrameUrl
                                          ? storyboardCarouselPositions[index] || 'first'
                                          : 'first'
                                        const url = position === 'last' && sb.lastFrameUrl ? sb.lastFrameUrl : (sb.firstFrameUrl || sb.url)
                                        const key = `storyboard-${index}-${position}`
                                        handleDownloadFile(url, `storyboard-${index + 1}-${position === 'first' ? 'first' : 'last'}.png`, key)
                                      }}
                                      disabled={!sb.url || !!sb.error}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      {downloadingKey?.includes(`storyboard-${index}`) ? (
                                        <>
                                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                          {t("downloading")}
                                        </>
                                      ) : (
                                        <>
                                          <Download className="w-3 h-3 mr-1" />
                                          {sb.lastFrameUrl && sb.lastFrameUrl !== sb.firstFrameUrl ? (
                                            storyboardCarouselPositions[index] === 'last' ? t("downloadLast") : t("downloadFirst")
                                          ) : t("download")}
                                        </>
                                      )}
                                    </Button>
                                    {/* 单个分镜编辑按钮 */}
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        // 如果有尾帧，根据当前轮播位置决定编辑哪一帧
                                        const position = sb.lastFrameUrl && sb.lastFrameUrl !== sb.firstFrameUrl
                                          ? (storyboardCarouselPositions[index] || 'first')
                                          : null
                                        handleStartEditStoryboard(index, position || undefined)
                                      }}
                                      disabled={workflowLoading || isRegeneratingStoryboard === index}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                      {sb.lastFrameUrl && sb.lastFrameUrl !== sb.firstFrameUrl ? (
                                        storyboardCarouselPositions[index] === 'last' ? t("editLast") : t("editFirst")
                                      ) : t("edit")}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={async () => {
                                        // 如果有尾帧，根据当前轮播位置决定重新生成哪一帧
                                        if (sb.lastFrameUrl && sb.lastFrameUrl !== sb.firstFrameUrl) {
                                          const position = storyboardCarouselPositions[index] || 'first'
                                          await regenerateSingleFrame(index, position)
                                        } else {
                                          handleShowRegenerateStoryboardDialog(index)
                                        }
                                      }}
                                      disabled={workflowLoading || isRegeneratingStoryboard === index || workflowPaused}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      {isRegeneratingStoryboard === index ? (
                                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                      ) : (
                                        <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                        </svg>
                                      )}
                                      {sb.lastFrameUrl && sb.lastFrameUrl !== sb.firstFrameUrl ? (
                                        storyboardCarouselPositions[index] === 'last' ? t("regenerateLast") : t("regenerateFirst")
                                      ) : t("regenerate")}
                                    </Button>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="w-full rounded-lg bg-muted/30 h-48 flex items-center justify-center relative">
                                    <div className="text-center">
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        viewBox="0 0 200 120"
                                        className="mx-auto w-full max-w-xs h-28 text-muted-foreground"
                                        role="img"
                                        aria-label={t("storyboard") + " " + t("previewImageAlt")}
                                      >
                                        <rect x="2" y="2" width="196" height="116" rx="8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.06" />
                                        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
                                          <path d="M20 20 L180 100" opacity="0.12" />
                                          <path d="M20 100 L180 20" opacity="0.08" />
                                        </g>
                                        {/* visible label removed per UX: keep SVG shape only */}
                                      </svg>
                                    </div>
                                    {/* 失败状态显示（优先显示重新生成状态，然后才是错误） */}
                                    {isRegeneratingStoryboard === index ? (
                                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                                        <div className="flex items-center gap-2 text-white">
                                          <Loader2 className="w-4 h-4 animate-spin" />
                                          {t("generating")}
                                        </div>
                                      </div>
                                    ) : sbError ? (
                                      <div className="absolute inset-0 bg-red-500/80 flex items-center justify-center rounded-lg">
                                        <div className="text-white text-xs text-center px-2">
                                          <div className="font-medium mb-1">{t("generationFailed")}</div>
                                          <div className="line-clamp-3">{sbError}</div>
                                        </div>
                                      </div>
                                    ) : (
                                      /* 只要没有图片就显示"正在生成" */
                                      !sbUrl ? (
                                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                                          <div className="flex items-center gap-2 text-white">
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            {t("generating")}
                                          </div>
                                        </div>
                                      ) : null
                                    )}
                                  </div>
                                  {/* 即使生成失败也显示按钮，但禁用 */}
                                  <div className="flex flex-col sm:flex-row flex-wrap gap-2 mt-2 min-w-0">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setEditingStoryboardIndex(index)
                                        setIsEditingStoryboard(false)
                                        setShowStoryboardPreview(true)
                                      }}
                                      disabled={!sbUrl || !!sbError}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      <Eye className="w-3 h-3 mr-1" />
                                      {t("view")}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        const url = sbUrl
                                        const key = `storyboard-${index}`
                                        handleDownloadFile(url, `storyboard-${index + 1}.png`, key)
                                      }}
                                      disabled={!sbUrl || !!sbError}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      {downloadingKey === `storyboard-${index}` ? (
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
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleShowRegenerateStoryboardDialog(index)}
                                      disabled={workflowLoading || isRegeneratingStoryboard === index || workflowPaused}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                      </svg>
                                      {t("regenerate")}
                                    </Button>
                                  </div>
                                </>
                              )}
                              </div>
                            </div>

                            {/* 第三栏：剧情视频 + 提示词 + 操作 */}
                            <div className="w-full md:flex-1 min-w-0">
                              <div className="p-3 bg-background/50 border border-border rounded-md h-full">
                              {sv?.videoUrl ? (
                                <>
                                  <div className="w-full overflow-hidden rounded-lg max-h-48">
                                    <video
                                      src={sv.videoUrl}
                                      controls
                                      className="w-full h-auto max-h-48 object-contain"
                                      poster={sv.thumbnailUrl}
                                    />
                                  </div>
                                  {/* 剧情视频提示词在查看模式下已隐藏 */}
                                  <div className="flex flex-col sm:flex-row flex-wrap gap-2 mt-2 min-w-0">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setEditedSceneVideoData(sv)
                                        setEditingSceneVideoIndex(index)
                                        setIsEditingSceneVideo(false)
                                        setShowSceneVideoPreview(true)
                                      }}
                                      disabled={!sv.videoUrl || !!sv.error}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      <Eye className="w-3 h-3 mr-1" />
                                      {t("view")}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        const key = `scene-video-${index}`
                                        handleDownloadFile(sv.videoUrl ?? undefined, `scene-video-${index + 1}.mp4`, key)
                                      }}
                                      disabled={!sv.videoUrl || !!sv.error}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      {downloadingKey === `scene-video-${index}` ? (
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
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleStartEditSceneVideo(index)}
                                      disabled={workflowLoading}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                      {t("edit")}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleShowRegenerateSceneVideoDialog(index)}
                                      disabled={workflowLoading || isRegeneratingSceneVideo === index || workflowPaused}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                      </svg>
                                      {t("regenerate")}
                                    </Button>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="w-full rounded-lg bg-muted/30 h-48 flex items-center justify-center relative">
                                    <div className="text-center">
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        viewBox="0 0 200 120"
                                        className="mx-auto w-full max-w-xs h-28 text-muted-foreground"
                                        role="img"
                                        aria-label={t("sceneVideo") + " " + t("previewImageAlt")}
                                      >
                                        <rect x="2" y="2" width="196" height="116" rx="8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.06" />
                                        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
                                          <path d="M20 20 L180 100" opacity="0.12" />
                                          <path d="M20 100 L180 20" opacity="0.08" />
                                        </g>
                                        {/* visible label removed per UX: keep SVG shape only */}
                                      </svg>
                                    </div>
                                    {/* 失败状态显示（优先显示重新生成状态，然后才是错误） */}
                                    {isRegeneratingSceneVideo === index ? (
                                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                                        <div className="flex items-center gap-2 text-white">
                                          <Loader2 className="w-4 h-4 animate-spin" />
                                          {t("generating")}
                                        </div>
                                      </div>
                                    ) : sv?.error ? (
                                      <div className="absolute inset-0 bg-red-500/80 flex items-center justify-center rounded-lg">
                                        <div className="text-white text-xs text-center px-2">
                                          <div className="font-medium mb-1">{t("generationFailed")}</div>
                                          <div className="line-clamp-3">{sv.error}</div>
                                        </div>
                                      </div>
                                    ) : (
                                      /* 显示等待/生成中状态：
                                         - 分镜图还没生成时显示"等待生成"
                                         - 分镜图已生成但剧情视频未生成时显示"生成中"
                                      */
                                      !sb?.url ? (
                                        <div className="absolute inset-0 bg-muted/50 flex items-center justify-center rounded-lg">
                                          <div className="flex items-center gap-2 text-muted-foreground">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            {t("waitingForGeneration")}
                                          </div>
                                        </div>
                                      ) : !sv?.videoUrl ? (
                                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                                          <div className="flex items-center gap-2 text-white">
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            {t("generating")}
                                          </div>
                                        </div>
                                      ) : null
                                    )}
                                  </div>
                                  {/* 即使生成失败也显示按钮，但禁用 */}
                                  <div className="flex flex-col sm:flex-row flex-wrap gap-2 mt-2 min-w-0">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setEditedSceneVideoData(sv)
                                        setEditingSceneVideoIndex(index)
                                        setIsEditingSceneVideo(false)
                                        setShowSceneVideoPreview(true)
                                      }}
                                      disabled={!sv?.videoUrl || !!sv?.error}
                                    className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      <Eye className="w-3 h-3 mr-1" />
                                      {t("view")}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        const key = `scene-video-${index}`
                                        handleDownloadFile(sv?.videoUrl ?? undefined, `scene-video-${index + 1}.mp4`, key)
                                      }}
                                      disabled={!sv?.videoUrl || !!sv?.error}
                                    className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      {downloadingKey === `scene-video-${index}` ? (
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
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleStartEditSceneVideo(index)}
                                      disabled={workflowLoading}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                      {t("edit")}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleShowRegenerateSceneVideoDialog(index)}
                                      disabled={workflowLoading || isRegeneratingSceneVideo === index || workflowPaused}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                      </svg>
                                      {t("regenerate")}
                                    </Button>
                                  </div>
                                </>
                              )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <FinalVideoStep
                videoData={videoData}
                workflowLoading={workflowLoading}
                workflowStep={workflowStep}
                workflowError={workflowError}
                scriptData={scriptData}
                downloadingKey={downloadingKey}
                handleDownloadFile={handleDownloadFile}
              />
            </div>
          </div>
        </div>
      )}

      {/* 素材库/链接输入/图片预览弹窗（components/operate/operate-dialogs.tsx，拆分 T9，行为与原来一致） */}
      <MediaDialogMounts
        libraryOpen={libraryOpen}
        setLibraryOpen={setLibraryOpen}
        handleLibrarySelect={handleLibrarySelect}
        showLinkInput={showLinkInput}
        setShowLinkInput={setShowLinkInput}
        linkInput={linkInput}
        setLinkInput={setLinkInput}
        handleAddLink={handleAddLink}
        previewImage={previewImage}
        closePreview={closePreview}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        showPrev={showPrev}
        showNext={showNext}
        selectedImages={selectedImages}
      />

      </div>

      {/* 购买/限额/详情编辑/确认/登录弹窗（components/operate/operate-dialogs.tsx，拆分 T9，行为与原来一致） */}
      <OverlayDialogMounts
        showPurchaseDialog={showPurchaseDialog}
        setShowPurchaseDialog={setShowPurchaseDialog}
        purchaseDialogType={purchaseDialogType}
        currentPoints={currentPoints}
        showFileSizeLimitDialog={showFileSizeLimitDialog}
        setShowFileSizeLimitDialog={setShowFileSizeLimitDialog}
        fileSizeLimitMB={fileSizeLimitMB}
        showStorageLimitDialog={showStorageLimitDialog}
        setShowStorageLimitDialog={setShowStorageLimitDialog}
        storageLimitInfo={storageLimitInfo}
        showMediaValidationDialog={showMediaValidationDialog}
        setShowMediaValidationDialog={setShowMediaValidationDialog}
        mediaValidationMessage={mediaValidationMessage}
        setMediaValidationMessage={setMediaValidationMessage}
        pricingDialogTriggerRef={pricingDialogTriggerRef}
        showCharacterPreview={showCharacterPreview}
        setShowCharacterPreview={setShowCharacterPreview}
        isEditingCharacter={isEditingCharacter}
        setIsEditingCharacter={setIsEditingCharacter}
        editedCharacterData={editedCharacterData}
        setEditedCharacterData={setEditedCharacterData}
        characterImageFile={characterImageFile}
        setCharacterImageFile={setCharacterImageFile}
        characterEditMode={characterEditMode}
        setCharacterEditMode={setCharacterEditMode}
        isUploadingCharacterImage={isUploadingCharacterImage}
        characterImageInputRef={characterImageInputRef}
        handleCharacterImageUpload={handleCharacterImageUpload}
        handleCharacterImagePaste={handleCharacterImagePaste}
        handleCancelEditCharacter={handleCancelEditCharacter}
        handleShowSaveEditCharacterDialog={handleShowSaveEditCharacterDialog}
        showStoryboardPreview={showStoryboardPreview}
        setShowStoryboardPreview={setShowStoryboardPreview}
        isEditingStoryboard={isEditingStoryboard}
        setIsEditingStoryboard={setIsEditingStoryboard}
        editingStoryboardIndex={editingStoryboardIndex}
        setEditingStoryboardIndex={setEditingStoryboardIndex}
        editedStoryboardData={editedStoryboardData}
        setEditedStoryboardData={setEditedStoryboardData}
        storyboardEditMode={storyboardEditMode}
        setStoryboardEditMode={setStoryboardEditMode}
        isUploadingStoryboardImage={isUploadingStoryboardImage}
        storyboardImageInputRef={storyboardImageInputRef}
        storyboardImageFile={storyboardImageFile}
        handleStoryboardImageUpload={handleStoryboardImageUpload}
        handleStoryboardImagePaste={handleStoryboardImagePaste}
        handleCancelEditStoryboard={handleCancelEditStoryboard}
        handleShowSaveEditStoryboardDialog={handleShowSaveEditStoryboardDialog}
        storyboardImages={storyboardImages}
        scriptData={scriptData}
        showSceneVideoPreview={showSceneVideoPreview}
        setShowSceneVideoPreview={setShowSceneVideoPreview}
        isEditingSceneVideo={isEditingSceneVideo}
        setIsEditingSceneVideo={setIsEditingSceneVideo}
        editingSceneVideoIndex={editingSceneVideoIndex}
        setEditingSceneVideoIndex={setEditingSceneVideoIndex}
        editedSceneVideoData={editedSceneVideoData}
        setEditedSceneVideoData={setEditedSceneVideoData}
        sceneVideos={sceneVideos}
        aspectRatio={aspectRatio}
        handleCancelEditSceneVideo={handleCancelEditSceneVideo}
        handleShowSaveEditSceneVideoDialog={handleShowSaveEditSceneVideoDialog}
        showRegenerateCharacterDialog={showRegenerateCharacterDialog}
        setShowRegenerateCharacterDialog={setShowRegenerateCharacterDialog}
        characterToRegenerate={characterToRegenerate}
        handleConfirmRegenerateCharacter={handleConfirmRegenerateCharacter}
        showSaveEditCharacterDialog={showSaveEditCharacterDialog}
        setShowSaveEditCharacterDialog={setShowSaveEditCharacterDialog}
        characterData={characterData}
        handleConfirmSaveEditedCharacter={handleConfirmSaveEditedCharacter}
        showRegenerateStoryboardDialog={showRegenerateStoryboardDialog}
        setShowRegenerateStoryboardDialog={setShowRegenerateStoryboardDialog}
        storyboardToRegenerate={storyboardToRegenerate}
        handleConfirmRegenerateStoryboard={handleConfirmRegenerateStoryboard}
        showSaveEditStoryboardDialog={showSaveEditStoryboardDialog}
        setShowSaveEditStoryboardDialog={setShowSaveEditStoryboardDialog}
        handleConfirmSaveEditedStoryboard={handleConfirmSaveEditedStoryboard}
        showRegenerateScriptDialog={showRegenerateScriptDialog}
        setShowRegenerateScriptDialog={setShowRegenerateScriptDialog}
        handleConfirmRegenerateScript={handleConfirmRegenerateScript}
        showRegenerateSceneVideoDialog={showRegenerateSceneVideoDialog}
        setShowRegenerateSceneVideoDialog={setShowRegenerateSceneVideoDialog}
        sceneVideoToRegenerate={sceneVideoToRegenerate}
        estimateSceneVideoPoints={estimateSceneVideoPoints}
        handleConfirmRegenerateSceneVideo={handleConfirmRegenerateSceneVideo}
        showSaveEditSceneVideoDialog={showSaveEditSceneVideoDialog}
        setShowSaveEditSceneVideoDialog={setShowSaveEditSceneVideoDialog}
        handleConfirmSaveEditedSceneVideo={handleConfirmSaveEditedSceneVideo}
        isSignInDialogOpen={isSignInDialogOpen}
        setIsSignInDialogOpen={setIsSignInDialogOpen}
      />
    </div>
  )
}
