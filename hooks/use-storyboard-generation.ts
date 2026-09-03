"use client"

import { useTranslations } from "next-intl"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import { useToast } from "@/hooks/use-toast"
import type {
  CharacterImageRef,
  CharacterItem,
  ComposedVideoResult,
  SceneVideoItem,
  ScriptData,
  StoryScene,
  StoryboardItem,
} from "@/lib/types"

/**
 * 故事板/分镜图生成状态块 hook。
 * 从 components/operate.tsx 拆出（拆分 T6），函数体逐字搬移、行为与原来一致：
 * - generateStoryboardForScene：单帧分镜图请求引擎（含 Pusher 等待/积分不足暂停/错误回写），
 *   被首次生成工作流、单帧重生成、整图重生成、断点续跑共用；
 * - regenerateSingleFrame：首/尾帧重生成完整流程（分镜图→剧情视频→完整视频）；
 * - handleConfirmRegenerateStoryboard：整张分镜图重生成完整流程（同上三段）；
 * - resumeStoryboardGeneration：断点续跑的分镜图阶段。
 * 与 operate 的耦合通过 deps 注入：共享 refs、当次渲染的状态值与 setter、
 * 以及仍留在 operate 的工作流回调（暂停等待/版本组/场景视频/合成/续跑/Pusher 等待）。
 */
interface StoryboardGenerationDeps {
  abortControllerRef: MutableRefObject<AbortController | null>
  versionGroupIdRef: MutableRefObject<string | null>
  currentProjectIdRef: MutableRefObject<string | null>
  currentEditVersionId: MutableRefObject<string | null>
  workflowPausedRef: MutableRefObject<boolean>
  workflowInterruptedRef: MutableRefObject<boolean>
  aspectRatio: string
  generationMode: string
  characterData: CharacterItem[]
  scriptData: ScriptData | null
  sceneVideos: SceneVideoItem[]
  storyboardImages: StoryboardItem[]
  currentProjectId: string | null
  storyboardToRegenerate: number | null
  setCurrentPoints: (v: number | null) => void
  setPurchaseDialogType: (v: 'points' | 'subscription' | 'card_verify') => void
  setShowPurchaseDialog: (v: boolean) => void
  setWorkflowPaused: (v: boolean) => void
  setStoryboardImages: Dispatch<SetStateAction<StoryboardItem[]>>
  setIsRegeneratingStoryboard: Dispatch<SetStateAction<number | null>>
  setSceneVideos: Dispatch<SetStateAction<SceneVideoItem[]>>
  setVideoData: Dispatch<SetStateAction<ComposedVideoResult | null>>
  setWorkflowError: Dispatch<SetStateAction<string | null>>
  setWorkflowLoading: Dispatch<SetStateAction<boolean>>
  setWorkflowStep: Dispatch<SetStateAction<'idle' | 'script' | 'character' | 'storyboard' | 'scenes' | 'video'>>
  setShowRegenerateStoryboardDialog: (v: boolean) => void
  waitForGenerationResult: (params: {
    taskId: string
    type: 'character' | 'storyboard' | 'video' | 'compose'
    timeoutMs?: number
  }) => Promise<ComposedVideoResult>
  waitForWorkflowResume: () => Promise<void>
  generateVersionGroupId: () => string
  generateSceneVideoForScene: (params: {
    scene: StoryScene
    sceneIndex: number
    storyboardImage?: StoryboardItem
    aspectRatio: string
    consolePrefix: string
    versionId?: string
    versionGroupId?: string
  }) => Promise<SceneVideoItem>
  composeSceneVideosWithFAL: (
    sceneVideosToCompose: SceneVideoItem[],
    scriptDataForCompose?: ScriptData | null,
    abortSignal?: AbortSignal,
    projectId?: string,
    versionId?: string,
    versionGroupId?: string
  ) => Promise<ComposedVideoResult | null>
  resumeSceneVideosGeneration: () => Promise<void>
}

export function useStoryboardGeneration(deps: StoryboardGenerationDeps) {
  const t = useTranslations("operate")
  const { toast } = useToast()
  const {
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
  } = deps


  // 通用函数：生成单个分镜图并更新状态（含 Pusher 处理）
  const generateStoryboardForScene = async (params: {
    scene: StoryScene
    sceneIndex: number
    aspectRatio: string
    characterImages: CharacterImageRef[]
    consolePrefix: string
    versionId?: string
    versionGroupId?: string
    itemId?: string
    regenerateFrameType?: 'first' | 'last'  // 只重新生成单个帧
  }): Promise<StoryboardItem> => {
    const { scene, sceneIndex, aspectRatio, characterImages, consolePrefix, itemId, regenerateFrameType } = params
    const versionGroupId = params.versionGroupId || versionGroupIdRef.current

    const basePrompt = String(scene.storyboardPrompt ?? '') || String(scene.plot ?? '') || String(scene.description ?? '') || t('noPlotDescription')
    const logPrefix = `${consolePrefix} 分镜图 ${sceneIndex + 1}`

    // 首尾帧模式：从 scene 中提取首帧和尾帧提示词
    const firstFramePrompt = String(scene.firstFramePrompt ?? '') || null
    const lastFramePrompt = String(scene.lastFramePrompt ?? '') || null
    const useFirstLastFrame = generationMode === 'first-last-frame' && firstFramePrompt && lastFramePrompt

    console.log(
      `${logPrefix} - request:`,
      {
        storyboardPrompt: basePrompt,
        aspectRatio,
        characterImagesCount: characterImages?.length ?? 0,
        itemId: itemId || scene.id,
        versionGroupId,
        generationMode,
        useFirstLastFrame,
      }
    )

    const requestBody: Record<string, unknown> = {
      storyboardPrompt: basePrompt,
      aspectRatio,
      characterImages,
      projectId: currentProjectIdRef.current || undefined,
      versionId: params.versionId || currentEditVersionId.current || undefined,
      versionGroupId: versionGroupId || undefined,
      itemId: itemId || scene.id,
      // 图生图：用户上传的场景图作为参考图（如果有），将作为 image_input 的第一张图
      referenceImage: (typeof scene.userImageUrl === 'string' && scene.userImageUrl.trim().length > 0)
        ? scene.userImageUrl
        : (typeof scene.referenceImage === 'string' && scene.referenceImage.trim().length > 0)
          ? scene.referenceImage
          : undefined,
    }

    // 如果是首尾帧模式，添加首尾帧提示词
    // 但是如果指定了 regenerateFrameType，则只传递指定帧的提示词
    if (useFirstLastFrame) {
      if (regenerateFrameType === 'first') {
        requestBody.regenerateFrameType = 'first'
        requestBody.firstFramePrompt = firstFramePrompt
        // 不传递 lastFramePrompt，让后端只生成首帧
      } else if (regenerateFrameType === 'last') {
        requestBody.regenerateFrameType = 'last'
        requestBody.lastFramePrompt = lastFramePrompt
        // 不传递 firstFramePrompt，让后端只生成尾帧
      } else {
        // 正常情况，两个都传递
        requestBody.firstFramePrompt = firstFramePrompt
        requestBody.lastFramePrompt = lastFramePrompt
      }
    }

    const storyboardResponse = await fetch('/api/ai/generate-storyboard-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: abortControllerRef.current?.signal,
    })

    // 先检查响应状态，再解析 JSON
    if (!storyboardResponse.ok) {
      let errorData: any = {}
      let errorText = ''
      try {
        errorText = await storyboardResponse.text()
        errorData = errorText ? JSON.parse(errorText) : {}
      } catch {
        // 如果解析失败，使用原始文本
        errorData = { error: errorText || `HTTP ${storyboardResponse.status}` }
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
        console.log('[generateStoryboardForScene] 检测到积分不足，已暂停工作流')
        
        const errorItem = {
          id: `storyboard_${sceneIndex + 1}`,
          url: '',
          sceneId: scene.id,
          sceneIndex,
          aspectRatio,
          prompt: basePrompt,
          generatedAt: new Date().toISOString(),
          error: errorMessage,
          code: 'INSUFFICIENT_POINTS'
        }

        // 实时更新错误状态
        setStoryboardImages((prev: any[]) => {
          const newItems = [...prev]
          newItems[sceneIndex] = errorItem
          return newItems
        })

        return errorItem
      }
      
      // 积分不足是可预期的业务错误，不打印 error 级别日志
      const isPointsInsufficient = errorData.code === 'INSUFFICIENT_POINTS' || (errorData.error && errorData.error.includes('积分不足'))
      if (isPointsInsufficient) {
        console.warn(`${logPrefix} 积分不足，跳过生成分镜图`)
      } else {
        console.error(`${logPrefix} 生成失败:`, storyboardResponse.status, errorData)
      }
      
      const errorMessage =
        errorData.error || t('storyboardGenerationFailed') + ` (status ${storyboardResponse.status})`

      const errorItem = {
        id: `storyboard_${sceneIndex + 1}`,
        url: '',
        sceneId: scene.id,
        sceneIndex,
        aspectRatio,
        prompt: basePrompt,
        generatedAt: new Date().toISOString(),
        error: errorMessage,
      }

      // 实时更新错误状态
      setStoryboardImages((prev: any[]) => {
        const newItems = [...prev]
        newItems[sceneIndex] = errorItem
        return newItems
      })

      return errorItem
    }

    const storyboardResult = await storyboardResponse.json().catch((e) => {
      console.error(`${logPrefix} - 解析 JSON 失败:`, e)
      const errorMessage = t('parseStoryboardResponseFailed')

      const errorItem = {
        id: `storyboard_${sceneIndex + 1}`,
        url: '',
        sceneId: scene.id,
        sceneIndex,
        aspectRatio,
        prompt: basePrompt,
        generatedAt: new Date().toISOString(),
        error: errorMessage,
      }

      setStoryboardImages((prev: any[]) => {
        const newItems = [...prev]
        newItems[sceneIndex] = errorItem
        return newItems
      })

      return errorItem
    })

    // 如果返回值本身带 error 字段，直接按错误处理
    if (storyboardResult && storyboardResult.error) {
      // 检查是否是积分不足错误
      if (storyboardResult.code === 'INSUFFICIENT_POINTS' || storyboardResult.error?.includes('积分不足')) {
        setCurrentPoints(storyboardResult.currentPoints || 0)
        setPurchaseDialogType('points')
        setShowPurchaseDialog(true)
        // 立即暂停工作流
        workflowPausedRef.current = true
        setWorkflowPaused(true)
        workflowInterruptedRef.current = true // 标记工作流被中断，以便后续可以继续
        console.log('[generateStoryboardForScene] 检测到积分不足（从结果中），已暂停工作流')
      }
      const errorItem = {
        id: `storyboard_${sceneIndex + 1}`,
        url: '',
        sceneId: scene.id,
        sceneIndex,
        aspectRatio,
        prompt: storyboardResult.prompt || basePrompt,
        generatedAt: new Date().toISOString(),
        error: storyboardResult.error,
      }

      setStoryboardImages((prev: any[]) => {
        const newItems = [...prev]
        newItems[sceneIndex] = errorItem
        return newItems
      })

      return errorItem
    }

    // ========== Pusher 模式处理 ==========
    let storyboardUrl =
      storyboardResult.images?.[0]?.url ||
      storyboardResult.imageUrl ||
      storyboardResult.images?.[0]

    // 检查是否是首尾帧模式（返回多个 requestId）
    const isFirstLastFrameMode = storyboardResult.requestIds && storyboardResult.requestIds.length >= 2
    
    if (storyboardResult.requestId && !storyboardUrl) {
      console.log(`${logPrefix} 使用 Pusher 模式:`, {
        requestId: storyboardResult.requestId,
        requestIds: storyboardResult.requestIds,
        isFirstLastFrameMode,
      })

      try {
        // 单帧重新生成模式：只等待一个 Pusher 结果
        if (params.regenerateFrameType) {
          const pusherData = await waitForGenerationResult({
            taskId: storyboardResult.requestId,
            type: 'storyboard',
            timeoutMs: 900000,
          })

          if (pusherData?.error) {
            const errorItem = {
              id: `storyboard_${sceneIndex + 1}`,
              url: '',
              sceneId: scene.id,
              sceneIndex,
              aspectRatio,
              prompt: storyboardResult.prompt || basePrompt,
              generatedAt: new Date().toISOString(),
              error: pusherData.error,
            }

            setStoryboardImages((prev: any[]) => {
              const newItems = [...prev]
              newItems[sceneIndex] = errorItem
              return newItems
            })

            return errorItem
          }

          // 获取生成的图片 URL
          const imageUrl = String(pusherData?.imageUrl || pusherData?.resultUrls?.[0] || '')
          
          console.log(`${logPrefix} 单帧 Pusher 结果 (${params.regenerateFrameType}):`, { imageUrl })
          
          if (!imageUrl) {
            const errorItem = {
              id: `storyboard_${sceneIndex + 1}`,
              url: '',
              sceneId: scene.id,
              sceneIndex,
              aspectRatio,
              prompt: storyboardResult.prompt || basePrompt,
              generatedAt: new Date().toISOString(),
              error: t('storyboardGenerationFailed'),
            }

            setStoryboardImages((prev: any[]) => {
              const newItems = [...prev]
              newItems[sceneIndex] = errorItem
              return newItems
            })

            return errorItem
          }

          // 返回单个帧的 URL
          return {
            id: `storyboard_${sceneIndex + 1}`,
            url: imageUrl,
            sceneId: scene.id,
            sceneIndex,
            aspectRatio,
            prompt: storyboardResult.prompt || basePrompt,
            generatedAt: new Date().toISOString(),
            [params.regenerateFrameType === 'first' ? 'firstFrameUrl' : 'lastFrameUrl']: imageUrl,
          }
        }
        
        // 首尾帧模式：等待两个 Pusher 结果
        if (isFirstLastFrameMode) {
          const [firstPusherData, lastPusherData] = await Promise.all([
            waitForGenerationResult({
              taskId: storyboardResult.requestIds[0],
              type: 'storyboard',
              timeoutMs: 900000,
            }),
            waitForGenerationResult({
              taskId: storyboardResult.requestIds[1],
              type: 'storyboard',
              timeoutMs: 900000,
            }),
          ])

          // 检查是否有错误
          const firstError = firstPusherData?.error
          const lastError = lastPusherData?.error

          if (firstError || lastError) {
            const errorItem = {
              id: `storyboard_${sceneIndex + 1}`,
              url: '',
              sceneId: scene.id,
              sceneIndex,
              aspectRatio,
              prompt: storyboardResult.prompt || basePrompt,
              generatedAt: new Date().toISOString(),
              error: firstError || lastError || 'Generation failed',
            }

            setStoryboardImages((prev: any[]) => {
              const newItems = [...prev]
              newItems[sceneIndex] = errorItem
              return newItems
            })

            return errorItem
          }

          // 提取首帧和尾帧 URL
          const firstFrameUrl = String(firstPusherData?.imageUrl || firstPusherData?.resultUrls?.[0] || '')
          const lastFrameUrl = String(lastPusherData?.imageUrl || lastPusherData?.resultUrls?.[0] || '')
          
          console.log(`${logPrefix} 首尾帧 Pusher 结果:`, { firstFrameUrl, lastFrameUrl })
          
          // 如果没有有效的首帧 URL，返回错误
          if (!firstFrameUrl) {
            const errorItem = {
              id: `storyboard_${sceneIndex + 1}`,
              url: '',
              sceneId: scene.id,
              sceneIndex,
              aspectRatio,
              prompt: storyboardResult.prompt || basePrompt,
              generatedAt: new Date().toISOString(),
              error: t('storyboardGenerationFailed'),
            }

            setStoryboardImages((prev: StoryboardItem[]) => {
              const newItems = [...prev]
              newItems[sceneIndex] = errorItem
              return newItems
            })

            return errorItem
          }

          // 构建 storyboardItem
          const storyboardItem: StoryboardItem = {
            id: `storyboard_${sceneIndex + 1}`,
            url: firstFrameUrl,
            sceneId: scene.id,
            sceneIndex,
            aspectRatio,
            prompt: storyboardResult.prompt || basePrompt,
            generatedAt: new Date().toISOString(),
            firstFrameUrl,
            lastFrameUrl,
            firstFramePrompt: firstFramePrompt ?? undefined,
            lastFramePrompt: lastFramePrompt ?? undefined,
          }

          setStoryboardImages((prev: StoryboardItem[]) => {
            const newItems = [...prev]
            newItems[sceneIndex] = {
              ...storyboardItem,
              error: undefined,
            }
            return newItems
          })

          console.log(`${logPrefix} 首尾帧模式已更新显示`, {
            hasFirstFrame: !!firstFrameUrl,
            hasLastFrame: !!lastFrameUrl,
          })

          return storyboardItem
        }

        // 普通模式：等待单个 Pusher 结果
        const pusherData = await waitForGenerationResult({
          taskId: storyboardResult.requestId,
          type: 'storyboard',
          timeoutMs: 900000,
        })

        // 检查是否有错误（onFail 会 resolve 包含 error 的数据）
        if (pusherData?.error) {
          const errorItem = {
            id: `storyboard_${sceneIndex + 1}`,
            url: '',
            sceneId: scene.id,
            sceneIndex,
            aspectRatio,
            prompt: storyboardResult.prompt || basePrompt,
            generatedAt: new Date().toISOString(),
            error: pusherData.error,
          }

          setStoryboardImages((prev: any[]) => {
            const newItems = [...prev]
            newItems[sceneIndex] = errorItem
            return newItems
          })

          return errorItem
        }

        storyboardUrl = String(pusherData.imageUrl || pusherData.resultUrls?.[0] || '')
        console.log(`${logPrefix} Pusher 结果:`, storyboardUrl)
      } catch (pusherError) {
        console.error(`${logPrefix} Pusher 等待失败:`, pusherError)
        const errorMessage = pusherError instanceof Error ? pusherError.message : t('generationFailed')
        // 超时不显示错误，任务可能还在后台处理
        if (errorMessage.includes('等待生成结果超时')) {
          return {
            id: `storyboard_${sceneIndex + 1}`,
            url: '',
            sceneId: scene.id,
            sceneIndex,
            aspectRatio,
            prompt: storyboardResult.prompt || basePrompt,
            generatedAt: new Date().toISOString(),
            error: undefined,
          }
        }

        const errorItem = {
          id: `storyboard_${sceneIndex + 1}`,
          url: '',
          sceneId: scene.id,
          sceneIndex,
          aspectRatio,
          prompt: storyboardResult.prompt || basePrompt,
          generatedAt: new Date().toISOString(),
          error: errorMessage,
        }

        setStoryboardImages((prev: any[]) => {
          const newItems = [...prev]
          newItems[sceneIndex] = errorItem
          return newItems
        })

        return errorItem
      }
    }

    // 提取图片 URL（支持首尾帧模式和普通模式）
    const firstFrameUrl = storyboardResult.images?.firstFrame?.url || 
                          storyboardResult.images?.[0]?.url || 
                          storyboardResult.imageUrl || 
                          ''
    const lastFrameUrl = storyboardResult.images?.lastFrame?.url || ''

    if (!firstFrameUrl) {
      console.error(`${logPrefix} - 未返回有效图片 URL`, storyboardResult)
      const errorItem = {
        id: `storyboard_${sceneIndex + 1}`,
        url: '',
        sceneId: scene.id,
        sceneIndex,
        aspectRatio,
        prompt: storyboardResult.prompt || basePrompt,
        generatedAt: new Date().toISOString(),
        error: t('storyboardGenerationFailed'),
      }

      setStoryboardImages((prev: any[]) => {
        const newItems = [...prev]
        newItems[sceneIndex] = errorItem
        return newItems
      })

      return errorItem
    }

    const storyboardItem: StoryboardItem = {
      id: `storyboard_${sceneIndex + 1}`,
      url: firstFrameUrl,
      sceneId: scene.id,
      sceneIndex,
      aspectRatio,
      prompt: storyboardResult.prompt || basePrompt,
      generatedAt: new Date().toISOString(),
    }

    // 如果是首尾帧模式，添加首帧和尾帧信息
    if (useFirstLastFrame) {
      storyboardItem.firstFrameUrl = firstFrameUrl
      storyboardItem.lastFrameUrl = lastFrameUrl
      storyboardItem.firstFramePrompt = firstFramePrompt
      storyboardItem.lastFramePrompt = lastFramePrompt
    }

    // ========== 实时更新：每成功生成一个分镜图就立即更新状态 ==========
    setStoryboardImages((prev: StoryboardItem[]) => {
      const newItems = [...prev]
      newItems[sceneIndex] = {
        ...storyboardItem,
        error: undefined, // 清除错误
      }
      return newItems
    })
    console.log(`${logPrefix} 已更新显示`, { 
      hasFirstFrame: !!firstFrameUrl, 
      hasLastFrame: !!lastFrameUrl,
      useFirstLastFrame 
    })
    // ========== 实时更新结束 ==========

    return storyboardItem
  }



  // 重新生成单个帧（首帧或尾帧）- 完整流程
  const regenerateSingleFrame = async (index: number, frameType: 'first' | 'last') => {
    if (!scriptData || !characterData) return

    setIsRegeneratingStoryboard(index)
    setWorkflowLoading(true)
    setWorkflowError(null)

    // 创建 AbortController 用于暂停
    abortControllerRef.current = new AbortController()

    const scene = (scriptData?.scenes ?? [])[index]
    const vgId = generateVersionGroupId()

    // 先设置 isGenerating: true，保留原有图片显示 + 生成中覆盖层
    const updatedStoryboardsBeforeGenerate = [...storyboardImages]
    updatedStoryboardsBeforeGenerate[index] = {
      ...updatedStoryboardsBeforeGenerate[index],
      isGenerating: true,
    }
    setStoryboardImages(updatedStoryboardsBeforeGenerate)

    try {
      // 获取场景的角色
      const sceneCharacterIds = scene.characterIds || []
      const relevantCharacters = characterData.filter((char: any) =>
        sceneCharacterIds.includes(char.id)
      )
      const characterImages = relevantCharacters.length > 0
        ? relevantCharacters.map((char: any) => ({
            characterId: char.id,
            imageUrl: char.imageUrl,
            imagePrompt: char.generationPrompt || char.prompt || char.description || ''
          }))
        : []

      console.log(`[regenerateSingleFrame] 开始重新生成${frameType === 'first' ? '首帧' : '尾帧'}:`, { sceneIndex: index, frameType })

      // 1. 重新生成分镜图
      setWorkflowStep('storyboard')

      const storyboardItem = await generateStoryboardForScene({
        scene,
        sceneIndex: index,
        aspectRatio,
        characterImages,
        consolePrefix: '[regenerateSingleFrame]',
        versionId: currentEditVersionId.current || undefined,
        versionGroupId: vgId,
        itemId: scene.id,
        regenerateFrameType: frameType,  // 只重新生成指定帧
      })

      // 检查错误
      if (storyboardItem && storyboardItem.error) {
        setWorkflowError(storyboardItem.error)
        throw new Error(storyboardItem.error)
      }

      // 获取新生成的图片 URL
      const newImageUrl = storyboardItem.images?.firstFrame?.url ||
                          storyboardItem.images?.lastFrame?.url ||
                          storyboardItem.url ||
                          storyboardItem.imageUrl || ''

      // 更新分镜图状态 - 只更新指定的帧，同时清除 isGenerating
      const updatedStoryboards = [...storyboardImages]
      const currentStoryboard = updatedStoryboards[index] || {}

      if (frameType === 'first') {
        // 更新首帧 - 保留原有的尾帧 URL
        updatedStoryboards[index] = {
          ...currentStoryboard,
          ...storyboardItem,
          firstFrameUrl: newImageUrl,
          url: newImageUrl,  // 同时更新主 URL
          lastFrameUrl: currentStoryboard.lastFrameUrl,  // 保留原有尾帧 URL
          isGenerating: undefined,  // 清除生成中状态
        }
      } else {
        // 更新尾帧 - 保留原有的首帧 URL
        updatedStoryboards[index] = {
          ...currentStoryboard,
          ...storyboardItem,
          firstFrameUrl: currentStoryboard.firstFrameUrl || currentStoryboard.url,  // 保留原有首帧 URL
          lastFrameUrl: newImageUrl,
          isGenerating: undefined,  // 清除生成中状态
        }
      }

      setStoryboardImages(updatedStoryboards)

      setWorkflowLoading(false)

      // 检查是否暂停
      await waitForWorkflowResume()

    // 2. 重新生成该场景的剧情视频
    setWorkflowStep('scenes')
    setWorkflowLoading(true)

    abortControllerRef.current = new AbortController()

    // 清空该场景视频显示"生成中"状态
    const currentSceneVideos = [...sceneVideos]
    if (currentSceneVideos[index]) {
      currentSceneVideos[index] = { ...currentSceneVideos[index], videoUrl: null }
      setSceneVideos(currentSceneVideos)
    }

    const videoItem = await generateSceneVideoForScene({
      scene,
      sceneIndex: index,
      storyboardImage: updatedStoryboards[index],
        aspectRatio,
        consolePrefix: '[regenerateSingleFrame]',
        versionId: currentEditVersionId.current || undefined,
        versionGroupId: vgId,
      })

      // 检查错误
      if (videoItem && videoItem.error) {
        throw new Error(videoItem.error)
      }

      // 合并回全量场景视频数组
      const finalSceneVideos = [...sceneVideos]
      finalSceneVideos[index] = videoItem
      setSceneVideos(finalSceneVideos)

      setWorkflowLoading(false)

      // 检查是否暂停
      await waitForWorkflowResume()

      // 3. 重新生成完整视频
      setWorkflowStep('video')
      setWorkflowLoading(true)
      setVideoData(null) // 清空旧的总视频

      abortControllerRef.current = new AbortController()

      const videoData = await composeSceneVideosWithFAL(
        finalSceneVideos,
        scriptData,
        abortControllerRef.current?.signal,
        currentProjectId || undefined,
        currentEditVersionId.current || undefined,
        vgId
      )

      setWorkflowLoading(false)
      setIsRegeneratingStoryboard(null)

      if (videoData) {
        setVideoData(videoData)
        toast({
          title: frameType === 'first' ? t("firstFrameRegenerated") : t("lastFrameRegenerated"),
          description: t("newStoryboardReady", { index: index + 1 }),
        })
      } else {
        toast({
          title: frameType === 'first' ? t("firstFrameRegenerated") : t("lastFrameRegenerated"),
          description: t("videoComposeSkipped"),
        })
      }

    } catch (error) {
      // 清除 isGenerating 状态
      const updatedStoryboardsOnError = [...storyboardImages]
      if (updatedStoryboardsOnError[index]) {
        updatedStoryboardsOnError[index] = {
          ...updatedStoryboardsOnError[index],
          isGenerating: undefined,
        }
        setStoryboardImages(updatedStoryboardsOnError)
      }

      // 如果是用户主动取消（暂停）
      if (error instanceof Error && error.name === 'AbortError') {
        console.log(`重新生成${frameType === 'first' ? '首帧' : '尾帧'}被用户暂停`)
        workflowInterruptedRef.current = true
        setWorkflowLoading(false)
        abortControllerRef.current = null
        setIsRegeneratingStoryboard(null)
        return
      }

      console.error(`重新生成${frameType === 'first' ? '首帧' : '尾帧'}失败:`, error)
      setWorkflowError(error instanceof Error ? error.message : t('regenerationFailed'))
      toast({
        title: t("regenerateFailed"),
        description: error instanceof Error ? error.message : t("retryLater"),
        variant: "destructive",
      })
      setWorkflowLoading(false)
      abortControllerRef.current = null
      setIsRegeneratingStoryboard(null)
    }
  }

  // 执行单个分镜图重新生成
  const handleConfirmRegenerateStoryboard = async () => {
    if (storyboardToRegenerate === null || !scriptData || !characterData || characterData.length === 0) {
      setShowRegenerateStoryboardDialog(false)
      setIsRegeneratingStoryboard(null)
      return
    }

    setShowRegenerateStoryboardDialog(false)
    const index = storyboardToRegenerate
    setIsRegeneratingStoryboard(index)

    // 生成版本组ID（用于关联同一批次的重新生成任务）
    const vgId = generateVersionGroupId()

    // 清空旧的分镜图URL，显示"生成中"状态（与总视频重新生成一致）
    const updatedStoryboards = [...storyboardImages]
    updatedStoryboards[index] = null as unknown as StoryboardItem
    setStoryboardImages(updatedStoryboards)

    // 同时清空对应剧情视频的URL（因为本流程会重新生成该场景剧情视频）
    if (sceneVideos[index]) {
      const updatedSceneVideos = [...sceneVideos]
      updatedSceneVideos[index] = { ...updatedSceneVideos[index], videoUrl: null }
      setSceneVideos(updatedSceneVideos)
    }

    setWorkflowStep('storyboard')
    setWorkflowLoading(true)
    setWorkflowError(null)  // 初始化错误状态（与第一次生成一致）

    // 创建 AbortController 用于暂停（与第一次生成一致）
    abortControllerRef.current = new AbortController()

    try {
      const scene = (scriptData?.scenes ?? [])[index]
      // 根据场景的 characterIds 筛选角色
      const sceneCharacterIds = scene?.characterIds || []
        const relevantCharacters = characterData.filter((char: CharacterItem) =>
          sceneCharacterIds.includes(String(char.id))
        )

      // 构建角色图片数组
      const characterImages = relevantCharacters.length > 0
        ? relevantCharacters.map((char: any) => ({
            characterId: char.id,
            imageUrl: char.imageUrl,
            imagePrompt: char.generationPrompt || char.prompt || char.description || ''
          }))
        : []

      // 日志：记录即将发送的生成请求（与第一次生成一致）
      console.log('[operate] regenerate storyboard - request:', { sceneIndex: index, storyboardPrompt: scene.storyboardPrompt || scene.plot || scene.description })

      const storyboardItem = await generateStoryboardForScene({
        scene,
        sceneIndex: index,
        aspectRatio,
        characterImages,
        consolePrefix: '[operate]',
        versionId: currentEditVersionId.current || undefined,
        versionGroupId: vgId,
        itemId: scene.id,
      })

      // 如果是错误结果（有 error 字段），将 workflowError 一并设置并中断后续流程
      if (storyboardItem && storyboardItem.error) {
        const errorMessage = storyboardItem.error
        setWorkflowError(errorMessage)
        throw new Error(errorMessage)
      }

      // 更新分镜图状态（在重新生成剧情视频之前）
      const updatedStoryboards = [...storyboardImages]
      updatedStoryboards[index] = storyboardItem
      setStoryboardImages(updatedStoryboards)

      setWorkflowLoading(false)

      // 检查是否暂停（与第一次生成一致）
      await waitForWorkflowResume()

      // 只重新生成对应的剧情视频（与重新生成主角一致）
      setWorkflowStep('scenes')
      setWorkflowLoading(true)

      // 创建 AbortController 用于暂停（与第一次生成一致）
      abortControllerRef.current = new AbortController()

      const videoItem = await generateSceneVideoForScene({
        scene,
        sceneIndex: index,
        storyboardImage: storyboardItem,
        aspectRatio,
        consolePrefix: '[handleConfirmRegenerateStoryboard]',
        versionId: currentEditVersionId.current || undefined,
        versionGroupId: vgId,
      })

      // 如果是错误结果（有 error 字段），直接抛出错误，中断后续的完整视频生成
      if (videoItem && videoItem.error) {
        throw new Error(videoItem.error)
      }

      // 合并回全量场景视频数组
      const updatedSceneVideos = [...sceneVideos]
      updatedSceneVideos[index] = videoItem

      setWorkflowLoading(false)

      // 检查是否暂停（与第一次生成一致）
      await waitForWorkflowResume()

      // 自动重新生成完整视频（与重新生成主角一致）
      setWorkflowStep('video')
      setWorkflowLoading(true)
      setVideoData(null) // 清空旧的总视频，显示"生成中"状态

      // 创建 AbortController 用于暂停（与第一次生成一致）
      abortControllerRef.current = new AbortController()

      // 使用通用函数生成完整视频
      const videoData = await composeSceneVideosWithFAL(
        updatedSceneVideos,
        scriptData,
        abortControllerRef.current?.signal,
        currentProjectId || undefined,
        currentEditVersionId.current || undefined,
        vgId
      )

      if (!videoData) {
        setWorkflowLoading(false)
        setIsRegeneratingStoryboard(null)
        toast({
          title: t("videoComposeSkipped"),
          description: t("noValidSceneVideosSkipFinal"),
        })
      } else {
        setVideoData(videoData)
        setWorkflowLoading(false)
        setIsRegeneratingStoryboard(null)

        toast({
          title: t("storyboardRegenerated"),
          description: t("newStoryboardReady", { index: index + 1 }),
        })
      }
    } catch (error) {
      // 如果是用户主动取消（暂停），设置中断标志（与第一次生成一致）
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('单个分镜图重新生成工作流被用户暂停')
        workflowInterruptedRef.current = true
        // 暂停时不设置 isGenerating 为 false，保持暂停按钮可见
        setWorkflowLoading(false)
        abortControllerRef.current = null
        setIsRegeneratingStoryboard(null)
        return
      }

      console.error('单个分镜图重新生成工作流错误:', error)
      setWorkflowError(error instanceof Error ? error.message : t('regenerationFailed'))
      toast({
        title: t("regenerationFailed"),
        description: error instanceof Error ? error.message : t("retryLater"),
        variant: "destructive",
      })

      // 只有在真正出错时才设置 isGenerating 为 false
      setWorkflowLoading(false)
      abortControllerRef.current = null
      setIsRegeneratingStoryboard(null)
    }
  }

  // 继续生成分镜图的辅助函数（_characterResult 参数保留调用方兼容，当前实现使用组件内 characterData）
  const resumeStoryboardGeneration = async (_characterResult: any) => {
    setWorkflowStep('storyboard')
    setWorkflowLoading(true)
    abortControllerRef.current = new AbortController()

    // 使用已生成的 characterData 主角数据
    const mergedCharacterData = characterData
    console.log('[resumeStoryboardGeneration] mergedCharacterData count:', mergedCharacterData.length)

    const storyboardPromises = (scriptData?.scenes ?? []).map(async (scene: StoryScene, index: number) => {
      // 根据场景的 characterIds 筛选角色，确保只传递该场景实际出现的角色
      const sceneCharacterIds = (scene.characterIds && scene.characterIds.length > 0) ? scene.characterIds : []
      console.log(`[resumeStoryboardGeneration] 分镜图 ${index + 1} - sceneCharacterIds:`, sceneCharacterIds)

      // 只筛选出场景中实际出现的角色，如果没有指定角色则不传递任何主角
      const relevantCharacters = sceneCharacterIds.length > 0
        ? mergedCharacterData.filter((char: CharacterItem) => sceneCharacterIds.includes(String(char.id)))
        : []

      console.log(`[resumeStoryboardGeneration] 分镜图 ${index + 1} - relevantCharacters:`, relevantCharacters.map((c: CharacterItem) => ({ id: c.id, imageUrl: c.imageUrl })))

      // 构建角色图片数组，包含 imageUrl 和 imagePrompt
      const characterImages = relevantCharacters.length > 0
        ? relevantCharacters.map((char: CharacterItem) => ({
            characterId: char.id ?? '',
            imageUrl: char.imageUrl ?? null,
            imagePrompt: String(char.generationPrompt ?? char.description ?? '')
          }))
        : []

      console.log(`[resumeStoryboardGeneration] 分镜图 ${index + 1} - characterImages:`, characterImages)

      return await generateStoryboardForScene({
        scene,
        sceneIndex: index,
        aspectRatio,
        characterImages,
        consolePrefix: '[resumeStoryboardGeneration]',
        versionId: currentEditVersionId.current || undefined,
        itemId: scene.id,
      })
    })

    // 等待所有分镜图处理完成（错误不会中断流程）
    const storyboardResults = await Promise.all(storyboardPromises)
    console.log('[resumeStoryboardGeneration] 分镜图全部处理完成:', storyboardResults.map(sb => ({ url: sb?.url, sceneIndex: sb?.sceneIndex, error: sb?.error })))

    setWorkflowLoading(false)

    // 检查是否暂停
    await waitForWorkflowResume()

    // 继续下一步：生成剧情视频
    await resumeSceneVideosGeneration()
  }

  return {
    generateStoryboardForScene,
    regenerateSingleFrame,
    handleConfirmRegenerateStoryboard,
    resumeStoryboardGeneration,
  }
}
