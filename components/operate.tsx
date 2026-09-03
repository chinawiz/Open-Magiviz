"use client"

import type React from "react"

import { useState, useRef, useEffect, type KeyboardEvent } from "react"
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
import { useTranslations } from "next-intl"
import { useSession } from "next-auth/react"
import { useToast } from "@/hooks/use-toast"
import { useLibrarySelection } from "@/hooks/use-library-selection"
import { computeFileSizeLimit } from "@/components/operate/format"
import { MediaDialogMounts, OverlayDialogMounts } from "@/components/operate/operate-dialogs"
import { CreatePanel } from "@/components/operate/create-panel"
import { WorkflowHeader, ScriptStep, FinalVideoStep } from "@/components/operate/workflow-steps"
import { ResultPanels } from "@/components/operate/result-panels"
import { getAllVideoDurations } from "@/components/operate/video"
import { estimateSceneVideoPoints as estimateSceneVideoPointsPure, estimateWorkflowPoints } from "@/lib/points-estimate"
import {
  VIDEO_MODEL_RESOLUTIONS,
  MEDIA_COMPATIBLE_VIDEO_MODELS,
} from "@/lib/providers/video-models"

import { useSubscriptionPlan } from "@/hooks/useSubscriptionPlan"
import { useTaskEvents } from "@/hooks/use-task-events"
import { useFileStorage } from "@/hooks/use-file-storage"
import { useRegeneration } from "@/hooks/use-regeneration"
import { useStoryboardEdit } from "@/hooks/use-storyboard-edit"
import { useWorkflowPipeline } from "@/hooks/use-workflow-pipeline"
import { useWorkflowResume } from "@/hooks/use-workflow-resume"
import { useProjectRestore } from "@/hooks/use-project-restore"
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

  const t = useTranslations("operate")
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



  // 编辑状态
  const [isEditingCharacter, setIsEditingCharacter] = useState(false)
  const [editedCharacterData, setEditedCharacterData] = useState<CharacterItem | null>(null)
  const [isEditingSceneVideo, setIsEditingSceneVideo] = useState(false)
  const [editingSceneVideoIndex, setEditingSceneVideoIndex] = useState<number | null>(null)
  const [editedSceneVideoData, setEditedSceneVideoData] = useState<SceneVideoItem | null>(null)
  const [isRegeneratingStoryboard, setIsRegeneratingStoryboard] = useState<number | null>(null)
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
  const storyboardImageInputRef = useRef<HTMLInputElement>(null)
  // 追踪用户编辑模式：'none' | 'image' | 'prompt'（互斥）

  // 图片上传状态
  const [isUploadingCharacterImage, setIsUploadingCharacterImage] = useState(false)

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

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // 显示重新生成全部剧情确认弹窗


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


  // 重新生成对应的剧情视频和完整视频

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
  // 前向引用桥：resumeSceneVideosGeneration/resumeWorkflow/createProject 的实现
  // 由下方 useWorkflowResume 提供（T6/T16 接线先于其声明，经桥转发；运行期已完成回填）
  let resumeSceneVideosGenerationImpl: () => Promise<void> = async () => {}
  let resumeWorkflowImpl: () => Promise<void> = async () => {}
  let createProjectImpl: () => Promise<string | null> = async () => null

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
    resumeSceneVideosGeneration: () => resumeSceneVideosGenerationImpl(),
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
    setIsUploadingCharacterImage,
    setShowSaveEditCharacterDialog,
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

  // 剧情与分镜再生族（hooks/use-regeneration.ts，拆分 T14，函数体逐字搬移，行为与原来一致）
  const {
    handleShowRegenerateScriptDialog,
    handleConfirmRegenerateScript,
    handleShowRegenerateStoryboardDialog,
    handleShowRegenerateSceneVideoDialog,
    handleConfirmRegenerateSceneVideo,
    regenerateCorrespondingSceneVideo,
  } = useRegeneration({
    abortControllerRef,
    versionGroupIdRef,
    currentProjectIdRef,
    currentEditVersionId,
    workflowPausedRef,
    workflowInterruptedRef,
    aspectRatio,
    characterData,
    scriptData,
    sceneVideos,
    storyboardImages,
    currentProjectId,
    setCurrentPoints,
    setPurchaseDialogType,
    setShowPurchaseDialog,
    setWorkflowPaused,
    setStoryboardImages,
    setSceneVideos,
    setVideoData,
    setWorkflowError,
    setWorkflowLoading,
    setWorkflowStep,
    waitForGenerationResult,
    waitForWorkflowResume,
    setCurrentEditVersionId: (v: string) => { currentEditVersionId.current = v },
    generateVersionGroupId,
    generateSceneVideoForScene,
    composeSceneVideosWithFAL,
    message,
    duration,
    videoModel,
    videoStyle,
    sceneVideoToRegenerate,
    setIsGenerating,
    setScriptData,
    setCharacterData,
    setShowRegenerateScriptDialog,
    setShowRegenerateStoryboardDialog,
    setStoryboardToRegenerate,
    setShowRegenerateSceneVideoDialog,
    setIsRegeneratingSceneVideo,
    setSceneVideoToRegenerate,
    generateCharacterForSingle,
    mergeCharactersFromResults,
    generateStoryboardForScene,
  })

  // 分镜编辑族（hooks/use-storyboard-edit.ts，拆分 T15，函数体逐字搬移，行为与原来一致）
  const {
    isEditingStoryboard,
    setIsEditingStoryboard,
    editingStoryboardIndex,
    setEditingStoryboardIndex,
    editedStoryboardData,
    setEditedStoryboardData,
    storyboardImageFile,
    storyboardEditMode,
    setStoryboardEditMode,
    isUploadingStoryboardImage,
    handleStartEditStoryboard,
    handleShowSaveEditStoryboardDialog,
    handleConfirmSaveEditedStoryboard,
    handleCancelEditStoryboard,
    handleStoryboardImageUpload,
    handleStoryboardImagePaste,
  } = useStoryboardEdit({
    abortControllerRef,
    versionGroupIdRef,
    currentProjectIdRef,
    currentEditVersionId,
    workflowPausedRef,
    workflowInterruptedRef,
    aspectRatio,
    characterData,
    scriptData,
    sceneVideos,
    storyboardImages,
    currentProjectId,
    setCurrentPoints,
    setPurchaseDialogType,
    setShowPurchaseDialog,
    setWorkflowPaused,
    setStoryboardImages,
    setSceneVideos,
    setVideoData,
    setWorkflowError,
    setWorkflowLoading,
    setWorkflowStep,
    waitForGenerationResult,
    waitForWorkflowResume,
    generateVersionGroupId,
    generateSceneVideoForScene,
    composeSceneVideosWithFAL,
    generationMode,
    subscriptionPlan,
    checkStorageAvailable,
    handleStorageLimitExceeded,
    handleFileSizeExceeded,
    generateStoryboardForScene,
    regenerateCorrespondingSceneVideo,
    setShowSaveEditStoryboardDialog,
    setShowStoryboardPreview,
    setIsRegeneratingStoryboard,
  })

  // handleSend 工作流管线（hooks/use-workflow-pipeline.ts，拆分 T16，函数体逐字搬移，行为与原来一致）
  const {
    handleSend,
  } = useWorkflowPipeline({
    abortControllerRef,
    versionGroupIdRef,
    currentProjectIdRef,
    currentEditVersionId,
    workflowPausedRef,
    workflowInterruptedRef,
    aspectRatio,
    scriptData,
    characterData,
    sceneVideos,
    storyboardImages,
    currentProjectId,
    setCurrentPoints,
    setPurchaseDialogType,
    setShowPurchaseDialog,
    setWorkflowPaused,
    setStoryboardImages,
    setSceneVideos,
    setVideoData,
    setWorkflowError,
    setWorkflowLoading,
    setWorkflowStep,
    waitForGenerationResult,
    waitForWorkflowResume,
    generateVersionGroupId,
    generateSceneVideoForScene,
    composeSceneVideosWithFAL,
    message,
    duration,
    videoModel,
    videoStyle,
    imageUrls,
    uploadingItems,
    workflowStep,
    videoData,
    setIsSignInDialogOpen,
    setShowInputBox,
    setShowSettingsPopover,
    setMediaValidationMessage,
    setShowMediaValidationDialog,
    setVideoModel,
    resumeWorkflow: () => resumeWorkflowImpl(),
    createProject: () => createProjectImpl(),
    generateCharacterForSingle,
    mergeCharactersFromResults,
    generateStoryboardForScene,
    setCurrentEditVersionId: (v: string) => { currentEditVersionId.current = v },
    setIsGenerating,
    setScriptData,
    setCharacterData,
  })

  // 恢复/续跑族（hooks/use-workflow-resume.ts，拆分 T17，函数体逐字搬移，行为与原来一致）
  const {
    createProject,
    resumeWorkflow,
    resumeSceneVideosGeneration,
    handlePauseResumeWorkflow,
    handleResumeContinueGeneration,
  } = useWorkflowResume({
    abortControllerRef,
    versionGroupIdRef,
    currentProjectIdRef,
    currentEditVersionId,
    workflowPausedRef,
    workflowInterruptedRef,
    aspectRatio,
    characterData,
    scriptData,
    sceneVideos,
    storyboardImages,
    currentProjectId,
    setCurrentPoints,
    setPurchaseDialogType,
    setShowPurchaseDialog,
    setWorkflowPaused,
    setStoryboardImages,
    setSceneVideos,
    setVideoData,
    setWorkflowError,
    setWorkflowLoading,
    setWorkflowStep,
    waitForGenerationResult,
    waitForWorkflowResume,
    generateVersionGroupId,
    generateSceneVideoForScene,
    composeSceneVideosWithFAL,
    message,
    duration,
    videoModel,
    videoStyle,
    generationMode,
    workflowStep,
    videoData,
    setCurrentProjectIdRefValue: (v: string | null) => { currentProjectIdRef.current = v },
    handleSend,
    generateCharacterForSingle,
    mergeCharactersFromResults,
    resumeStoryboardGeneration,
    generateStoryboardForScene,
    pendingTasksRef,
    setCurrentProjectId,
    setIsGenerating,
    setScriptData,
    setCharacterData,
    setShowInputBox,
  })
  resumeSceneVideosGenerationImpl = resumeSceneVideosGeneration
  resumeWorkflowImpl = resumeWorkflow
  createProjectImpl = createProject

  // 项目恢复（hooks/use-project-restore.ts，拆分 T17，函数体逐字搬移，行为与原来一致）
  const {
    handleResumeContinue,
  } = useProjectRestore({
    resumeProjectId,
    resumeVersionId,
    isGenerating,
    aspectRatio,
    workflowStep,
    scriptData,
    characterData,
    storyboardImages,
    sceneVideos,
    videoData,
    setMessage,
    setAspectRatio,
    setDuration,
    setVideoStyle,
    setVideoModel,
    setGenerationMode,
    setScriptData,
    setCharacterData,
    setStoryboardImages,
    setSceneVideos,
    setVideoData,
    setRestoredVersionHasVideo,
    setRestoredProjectCompleted,
    setCurrentProjectId,
    setWorkflowStep,
    setShowInputBox,
    setIsGenerating,
    handleResumeContinueGeneration,

    setVersionGroupIdRefValue: (v: string | null) => { versionGroupIdRef.current = v },
    setCurrentEditVersionIdRefValue: (v: string | null) => { currentEditVersionId.current = v },
  })

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
              {/* 步骤2-4 结果展示区（components/operate/result-panels.tsx，拆分 T18，行为与原来一致） */}
              <ResultPanels
                workflowStep={workflowStep}
                scriptData={scriptData}
                characterData={characterData}
                storyboardImages={storyboardImages}
                sceneVideos={sceneVideos}
                downloadingKey={downloadingKey}
                isRegeneratingCharacterId={isRegeneratingCharacterId}
                isRegeneratingSceneVideo={isRegeneratingSceneVideo}
                isRegeneratingStoryboard={isRegeneratingStoryboard}
                storyboardCarouselPositions={storyboardCarouselPositions}
                workflowLoading={workflowLoading}
                workflowPaused={workflowPaused}
                handleDownloadFile={handleDownloadFile}
                handleShowRegenerateCharacterDialog={handleShowRegenerateCharacterDialog}
                handleShowRegenerateStoryboardDialog={handleShowRegenerateStoryboardDialog}
                handleShowRegenerateSceneVideoDialog={handleShowRegenerateSceneVideoDialog}
                handleStartEditCharacter={handleStartEditCharacter}
                handleStartEditStoryboard={handleStartEditStoryboard}
                handleStartEditSceneVideo={handleStartEditSceneVideo}
                regenerateSingleFrame={regenerateSingleFrame}
                setStoryboardCarouselPositions={setStoryboardCarouselPositions}
                setEditedCharacterData={setEditedCharacterData}
                setEditedSceneVideoData={setEditedSceneVideoData}
                setEditingSceneVideoIndex={setEditingSceneVideoIndex}
                setEditingStoryboardIndex={setEditingStoryboardIndex}
                setIsEditingCharacter={setIsEditingCharacter}
                setIsEditingSceneVideo={setIsEditingSceneVideo}
                setIsEditingStoryboard={setIsEditingStoryboard}
                setShowCharacterPreview={setShowCharacterPreview}
                setShowSceneVideoPreview={setShowSceneVideoPreview}
                setShowStoryboardPreview={setShowStoryboardPreview}
              />

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
