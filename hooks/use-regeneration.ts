"use client"

/* eslint-disable @typescript-eslint/no-explicit-any -- 函数体逐字搬移自 operate.tsx 的存量弱类型(拆分 T14);逐处改类型将淹没「只移动不改行为」的 diff 证明,随批次五后续清理票收敛 */

import { useTranslations } from "next-intl"
import { useToast } from "@/hooks/use-toast"
import type { Dispatch, SetStateAction } from "react"
import { tryParsePossiblyMalformedJson } from "@/lib/json-parse"
import type { CharacterItem, StoryScene, StoryboardItem } from "@/lib/types"
import type { CharacterImageRef } from "@/lib/types"
import type {
  WorkflowGenerationDeps,
} from "@/hooks/use-workflow-generation-deps"

/**
 * 再生族 hook 的 deps（拆分 T14）:
 * 共享接缝复用 WorkflowGenerationDeps,另补剧情再生管线专属依赖。
 */
export interface RegenerationDeps extends WorkflowGenerationDeps {
  // 剧情再生管线读取的当次渲染值
  message: string
  duration: string
  videoModel: string
  videoStyle: string
  sceneVideoToRegenerate: number | null
  // ref 写入收敛为注入回调(hook 参数不可变,react-compiler 惯用法)
  setCurrentEditVersionId: (v: string) => void
  // 专属 setter
  setSceneVideoToRegenerate: Dispatch<SetStateAction<number | null>>
  setIsGenerating: (v: boolean) => void
  setScriptData: Dispatch<SetStateAction<WorkflowGenerationDeps["scriptData"]>>
  setCharacterData: Dispatch<SetStateAction<CharacterItem[]>>
  setShowRegenerateScriptDialog: (v: boolean) => void
  setShowRegenerateStoryboardDialog: (v: boolean) => void
  setStoryboardToRegenerate: Dispatch<SetStateAction<number | null>>
  setShowRegenerateSceneVideoDialog: (v: boolean) => void
  setIsRegeneratingSceneVideo: Dispatch<SetStateAction<number | null>>
  // 上游生成 hook 的实现(经 operate 注入)
  generateCharacterForSingle: (params: {
    character: CharacterItem
    allCharactersSnapshot: CharacterItem[]
    consolePrefix: string
    versionId?: string
    versionGroupId?: string
    itemId?: string
  }) => Promise<{
    characterId: string | number | undefined
    imageUrl: string
    requestId: string | null
    raw: unknown
    error?: string
  }>
  mergeCharactersFromResults: (
    allChars: CharacterItem[],
    results: Array<{
      characterId: string | number | undefined
      imageUrl: string
      requestId: string | null
      raw: unknown
      error?: string
    }>,
    consolePrefix: string
  ) => CharacterItem[]
  generateStoryboardForScene: (params: {
    scene: StoryScene
    sceneIndex: number
    aspectRatio: string
    characterImages: CharacterImageRef[]
    consolePrefix: string
    versionId?: string
    versionGroupId?: string
    itemId?: string
  }) => Promise<StoryboardItem>
}

/**
 * 剧情与分镜再生族（自 operate.tsx 拆分 T14）:
 * 剧情重新生成完整管线、分镜/单帧/场景视频再生确认弹窗族、
 * 分镜图更新后联动再生对应场景视频。
 * 函数体逐字搬移,行为不变;i18n 与 toast hook 内自持,其余依赖注入。
 */
export function useRegeneration(deps: RegenerationDeps) {
  const {
    abortControllerRef,
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
    setScriptData,
    setCharacterData,
    setStoryboardImages,
    setSceneVideos,
    setVideoData,
    setWorkflowError,
    setWorkflowLoading,
    setWorkflowStep,
    setWorkflowPaused,
    setCurrentPoints,
    setPurchaseDialogType,
    setShowPurchaseDialog,
    setIsGenerating,
    setShowRegenerateScriptDialog,
    setShowRegenerateStoryboardDialog,
    setStoryboardToRegenerate,
    setShowRegenerateSceneVideoDialog,
    setIsRegeneratingSceneVideo,
    message,
    duration,
    videoModel,
    videoStyle,
    sceneVideoToRegenerate,
    setSceneVideoToRegenerate,
    waitForWorkflowResume,
    setCurrentEditVersionId,
    generateVersionGroupId,
    generateSceneVideoForScene,
    composeSceneVideosWithFAL,
    generateCharacterForSingle,
    mergeCharactersFromResults,
    generateStoryboardForScene,
  } = deps
  const t = useTranslations("operate")
  const { toast } = useToast()

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
        setCurrentEditVersionId(String(scriptResult.version))
        console.log('[handleRegenerateScript] 设置版本 ID:', currentEditVersionId.current)
      }

      // 解析返回：兼容 data 对象或 output 文本
      // 【bug 修复 2026-09-04】原实现此行恒为 null,mapToUiScriptData(null) 在
      // Array.isArray(data.scenes) 处抛 TypeError,导致「重新生成全部剧情」一直是失败路径。
      // 现对齐 use-workflow-pipeline(handleSend)的解析逻辑(T16 为正确参照实现)。
      let parsedScriptData: any = null

      if (scriptResult.output && typeof scriptResult.output === 'string') {
        const parsed = tryParsePossiblyMalformedJson(scriptResult.output)
        if (parsed !== null) {
          parsedScriptData = parsed
        } else {
          console.error('parse scriptResult.output failed: invalid JSON, falling back to raw', { output: scriptResult.output })
          parsedScriptData = scriptResult.raw ?? scriptResult.output
        }
      } else if (scriptResult.data) {
        parsedScriptData = scriptResult.data
      } else {
        parsedScriptData = scriptResult
      }

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

      // 回填该场景剧情视频到 UI state（否则会一直停留在"生成中"）
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

  // 分镜图更新后联动再生对应场景视频（编辑族与再生族的接缝）
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

  return {
    handleShowRegenerateScriptDialog,
    handleConfirmRegenerateScript,
    handleRegenerateScript,
    handleShowRegenerateStoryboardDialog,
    handleShowRegenerateSceneVideoDialog,
    handleConfirmRegenerateSceneVideo,
    regenerateCorrespondingSceneVideo,
  }
}
