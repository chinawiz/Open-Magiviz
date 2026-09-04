"use client"

/* eslint-disable @typescript-eslint/no-explicit-any -- 函数体逐字搬移自 operate.tsx 的存量弱类型(拆分 T16);逐处改类型将淹没「只移动不改行为」的 diff 证明,随后续清理票收敛 */

import { useTranslations } from "next-intl"
import { useSession } from "next-auth/react"
import { useToast } from "@/hooks/use-toast"
import { validateSeedanceMedia } from "@/components/operate/seedance-media"
import { MEDIA_COMPATIBLE_VIDEO_MODELS } from "@/lib/providers/video-models"
import { tryParsePossiblyMalformedJson } from "@/lib/json-parse"
import { buildUiScriptData, pickSceneCharacterImages } from "@/lib/script-mapper"
import type {
  WorkflowGenerationDeps,
} from "@/hooks/use-workflow-generation-deps"
import type { StoryboardItem } from "@/lib/types"

/**
 * handleSend 工作流管线 hook 的 deps(拆分 T16):
 * 共享接缝复用 WorkflowGenerationDeps;resumeWorkflow/createProject 现居调用方
 * (T17 将迁入 use-workflow-resume),经 deps 注入保持接线一次到位。
 */
export interface WorkflowPipelineDeps extends WorkflowGenerationDeps {
  // 当次渲染值
  message: string
  duration: string
  videoModel: string
  videoStyle: string
  imageUrls: string[]
  uploadingItems: any[]
  workflowStep: 'idle' | 'script' | 'character' | 'storyboard' | 'scenes' | 'video'
  videoData: any
  // 前置校验回调(调用方持有)
  setIsSignInDialogOpen: (v: boolean) => void
  setShowInputBox: (v: boolean) => void
  setShowSettingsPopover: (v: boolean) => void
  setMediaValidationMessage: (v: string) => void
  setShowMediaValidationDialog: (v: boolean) => void
  setVideoModel: (v: string) => void
  // 上游/接缝实现
  resumeWorkflow: () => Promise<void>
  createProject: () => Promise<string | null | undefined>
  generateCharacterForSingle: (params: {
    character: any
    allCharactersSnapshot: any[]
    consolePrefix: string
    versionId?: string
    versionGroupId?: string
    itemId?: string
  }) => Promise<any>
  mergeCharactersFromResults: (allChars: any[], results: any[], consolePrefix: string) => any[]
  generateStoryboardForScene: (params: {
    scene: any
    sceneIndex: number
    aspectRatio: string
    characterImages: any[]
    consolePrefix: string
    versionId?: string
    versionGroupId?: string
    itemId?: string
  }) => Promise<StoryboardItem>
  // ref 写入收敛为注入回调(hook 参数不可变,react-compiler 惯用法)
  setCurrentEditVersionId: (v: string) => void
  // 专属 setter
  setIsGenerating: (v: boolean) => void
  setScriptData: (v: any) => void
  setCharacterData: (v: any[]) => void
}

/**
 * handleSend 工作流管线(自 operate.tsx 拆分 T16):
 * send 触发的串行编排层——登录/媒体约束前置校验 → 剧情生成 → 主角 → 分镜图 →
 * 剧情视频 → 完整视频,含积分不足中断→购买弹窗接续。
 * 函数体逐字搬移,行为不变;i18n/toast/session hook 内自持,其余依赖注入。
 */

export function useWorkflowPipeline(deps: WorkflowPipelineDeps) {
  const {
    abortControllerRef,
    setWorkflowPaused,
    sceneVideos,
    workflowInterruptedRef,
    currentEditVersionId,
    storyboardImages,
    characterData,
    setCharacterData,
    setScriptData,
    workflowPausedRef,
    aspectRatio,
    setStoryboardImages,
    setSceneVideos,
    setVideoData,
    setWorkflowError,
    setWorkflowLoading,
    setWorkflowStep,
    setCurrentPoints,
    setPurchaseDialogType,
    setShowPurchaseDialog,
    waitForWorkflowResume,
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
    resumeWorkflow,
    createProject,
    generateCharacterForSingle,
    mergeCharactersFromResults,
    generateStoryboardForScene,
    setCurrentEditVersionId,
    setIsGenerating,
  } = deps
  const t = useTranslations("operate")
  const { toast } = useToast()
  const { status } = useSession()


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
        setCurrentEditVersionId(String(scriptResult.version))
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
      const uiScript = buildUiScriptData(parsedScriptData, aspectRatio, t)
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
          const { relevantCharacters, characterImages } = pickSceneCharacterImages(scene, mergedChars)

          console.log(`[handleSend] 分镜图 ${index + 1} - relevantCharacters:`, relevantCharacters.map((c: any) => ({ id: c.id, imageUrl: c.imageUrl })))


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

  return {
    handleSend,
  }
}
