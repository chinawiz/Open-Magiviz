"use client"

import { useTranslations } from "next-intl"
import type { ChangeEvent, Dispatch, MutableRefObject, SetStateAction } from "react"
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
 * 主角图片生成状态块 hook。
 * 从 components/operate.tsx 拆出（拆分 T7），函数体逐字切片搬移、行为与原来一致：
 * - generateCharacterForSingle:单主角图片请求引擎(Pusher 等待/积分不足暂停/错误回写);
 * - mergeCharactersFromResults:把生成结果合并为最终主角数组;
 * - handleShowRegenerateCharacterDialog / handleConfirmRegenerateCharacter:单主角重生成完整流程;
 * - handleStartEditCharacter 等编辑族:主角详情查看/编辑态流转与保存后的联动重生成;
 * - handleCharacterImageUpload/Url/Paste:编辑态换图三入口。
 * 与 operate 的耦合经 deps 注入:共享 refs、当次渲染状态值与 setter、工作流回调
 * (暂停等待/版本组/分镜图与剧情视频生成/合成/存储校验/Pusher 等待)。
 */
interface CharacterGenerationDeps {
  abortControllerRef: MutableRefObject<AbortController | null>
  versionGroupIdRef: MutableRefObject<string | null>
  currentProjectIdRef: MutableRefObject<string | null>
  currentEditVersionId: MutableRefObject<string | null>
  workflowInterruptedRef: MutableRefObject<boolean>
  workflowPausedRef: MutableRefObject<boolean>
  aspectRatio: string
  characterData: CharacterItem[]
  scriptData: ScriptData | null
  storyboardImages: StoryboardItem[]
  currentProjectId: string | null
  characterToRegenerate: any
  sceneVideos: SceneVideoItem[]
  subscriptionPlan: string | null
  editedCharacterData: CharacterItem | null
  characterImageFile: File | null
  setCharacterData: Dispatch<SetStateAction<CharacterItem[]>>
  setCurrentPoints: (v: number | null) => void
  setPurchaseDialogType: (v: 'points' | 'subscription' | 'card_verify') => void
  setShowPurchaseDialog: (v: boolean) => void
  setWorkflowPaused: (v: boolean) => void
  setIsGenerating: Dispatch<SetStateAction<boolean>>
  setIsRegeneratingCharacterId: Dispatch<SetStateAction<string | null>>
  setSceneVideos: Dispatch<SetStateAction<SceneVideoItem[]>>
  setShowRegenerateCharacterDialog: (v: boolean) => void
  setStoryboardImages: Dispatch<SetStateAction<StoryboardItem[]>>
  setVideoData: Dispatch<SetStateAction<ComposedVideoResult | null>>
  setWorkflowError: Dispatch<SetStateAction<string | null>>
  setWorkflowLoading: Dispatch<SetStateAction<boolean>>
  setWorkflowStep: Dispatch<SetStateAction<'idle' | 'script' | 'character' | 'storyboard' | 'scenes' | 'video'>>
  setCharacterEditMode: Dispatch<SetStateAction<'none' | 'image' | 'prompt'>>
  setCharacterImageFile: Dispatch<SetStateAction<File | null>>
  setEditedCharacterData: Dispatch<SetStateAction<CharacterItem | null>>
  setIsEditingCharacter: Dispatch<SetStateAction<boolean>>
  setIsRegeneratingSceneVideo: Dispatch<SetStateAction<number | null>>
  setIsRegeneratingStoryboard: Dispatch<SetStateAction<number | null>>
  setShowCharacterPreview: (v: boolean) => void
  setShowSaveEditCharacterDialog: (v: boolean) => void
  setIsUploadingCharacterImage: Dispatch<SetStateAction<boolean>>
  setScriptData: Dispatch<SetStateAction<ScriptData | null>>
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
  generateStoryboardForScene: (params: {
    scene: StoryScene
    sceneIndex: number
    aspectRatio: string
    characterImages: CharacterImageRef[]
    consolePrefix: string
    versionId?: string
    versionGroupId?: string
    itemId?: string
    regenerateFrameType?: 'first' | 'last'
  }) => Promise<StoryboardItem>
  composeSceneVideosWithFAL: (
    sceneVideosToCompose: SceneVideoItem[],
    scriptDataForCompose?: ScriptData | null,
    abortSignal?: AbortSignal,
    projectId?: string,
    versionId?: string,
    versionGroupId?: string
  ) => Promise<ComposedVideoResult | null>
  checkStorageAvailable: (totalFileSize: number) => Promise<{ available: boolean; storageInfo?: { usedStorage: number; storageLimit: number; availableStorage: number } }>
  handleStorageLimitExceeded: (storageInfo: { usedStorage: number; storageLimit: number; availableStorage: number }) => void
  computeFileSizeLimit: (plan: string | null) => number
  setCharacterToRegenerate: (v: any) => void
  handleFileSizeExceeded: () => void
}

export function useCharacterGeneration(deps: CharacterGenerationDeps) {
  const t = useTranslations("operate")
  const { toast } = useToast()
  const {
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
  } = deps


  // 通用函数：生成单个主角（含 Pusher 处理 & 实时更新），不负责最终数组合并/保存
  const generateCharacterForSingle = async (params: {
    character: CharacterItem
    allCharactersSnapshot: CharacterItem[]
    consolePrefix: string
    versionId?: string
    versionGroupId?: string
    itemId?: string
  }): Promise<{
    characterId: string | number | undefined
    imageUrl: string
    requestId: string | null
    raw: unknown
    error?: string
    code?: string
  }> => {
    const { character: c, allCharactersSnapshot: allChars, consolePrefix, itemId } = params
    const versionGroupId = params.versionGroupId || versionGroupIdRef.current

    const promptText = c.generationPrompt || `portrait of ${c.id || 'character'}`
    const payload = {
      prompt: String(promptText || '').trim(),
      projectId: currentProjectIdRef.current || undefined,
      versionId: params.versionId || currentEditVersionId.current || undefined,
      versionGroupId: versionGroupId || undefined,
      itemId: itemId || c.id,
      // 图生图：用户上传的角色图作为参考图（如果有）
      referenceImage: (typeof c.userImageUrl === 'string' && c.userImageUrl.trim().length > 0)
        ? c.userImageUrl
        : (typeof c.referenceImage === 'string' && c.referenceImage.trim().length > 0)
          ? c.referenceImage
          : undefined,
    }

    // show exact payload sent to backend
    console.log(`${consolePrefix} sending character generation payload:`, payload)

    const characterResponse = await fetch('/api/ai/generate-character-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortControllerRef.current?.signal
    })

    // Safely handle non-OK responses
    if (!characterResponse.ok) {
      let errorData: { code?: string; error?: string | null; currentPoints?: number } = {}
      let errorText = ''
      try {
        errorText = await characterResponse.text()
        errorData = errorText ? (JSON.parse(errorText) as { code?: string; error?: string | null; currentPoints?: number }) : {}
      } catch {
        // 如果解析失败，使用原始文本
        errorData = { error: errorText || `HTTP ${characterResponse.status}` }
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
        
        // ========== 失败：更新主角状态显示错误 ==========
        setCharacterData((prev: CharacterItem[]) => {
          const newItems = prev.length > 0 ? [...prev] : [...allChars]
          const idx = newItems.findIndex((item: CharacterItem) => String(item.id) === String(c.id))
          if (idx >= 0) {
            newItems[idx] = {
              ...newItems[idx],
              generationError: errorMessage  // 添加错误信息
            }
          }
          return newItems
        })
        // 返回失败结果而不是抛出错误
        return {
          characterId: c.id,
          imageUrl: '',
          requestId: null,
          raw: null,
          error: errorMessage,
          code: 'INSUFFICIENT_POINTS'
        }
      }

      // 积分不足是可预期的业务错误，不打印 error 级别日志
      const isPointsInsufficient = errorData.code === 'INSUFFICIENT_POINTS' || (errorData.error && errorData.error.includes('积分不足'))
      if (isPointsInsufficient) {
        console.warn(`${consolePrefix} 积分不足，跳过生成主角`)
      } else {
        console.error(`${consolePrefix} character generation failed:`, characterResponse.status, errorData)
      }
      
      const errorMessage = errorData.error || t('characterGenerationFailed') + ` (status ${characterResponse.status})`
      // ========== 失败：更新主角状态显示错误 ==========
      setCharacterData((prev: any[]) => {
        const newItems = prev.length > 0 ? [...prev] : [...allChars]
        const idx = newItems.findIndex((item: CharacterItem) => String(item.id) === String(c.id))
        if (idx >= 0) {
          newItems[idx] = {
            ...newItems[idx],
            generationError: errorMessage  // 添加错误信息
          }
        }
        return newItems
      })
      // 返回失败结果而不是抛出错误
      return {
        characterId: c.id,
        imageUrl: '',
        requestId: null,
        raw: null,
        error: errorMessage
      }
    }

    const characterResult = await characterResponse.json().catch((e) => {
      console.error(`${consolePrefix} failed to parse JSON from character generation response`, e)
      const errorMessage = t('parseCharacterResponseFailed')
      // ========== 失败：更新主角状态显示错误 ==========
      setCharacterData((prev: any[]) => {
        const newItems = prev.length > 0 ? [...prev] : [...allChars]
        const idx = newItems.findIndex((item: CharacterItem) => String(item.id) === String(c.id))
        if (idx >= 0) {
          newItems[idx] = {
            ...newItems[idx],
            generationError: errorMessage  // 添加错误信息
          }
        }
        return newItems
      })
      // 返回失败结果而不是抛出错误
      return {
        characterId: c.id,
        imageUrl: '',
        requestId: null,
        raw: null,
        error: errorMessage
      }
    })

    // 如果 characterResult 是错误结果（有 error 字段），直接返回
    if (characterResult && characterResult.error) {
      return characterResult
    }

    // log raw response from generate-character-image (stringified for full visibility)
    try {
      console.log(`${consolePrefix} single character generation - raw response:`, JSON.stringify(characterResult, null, 2))
    } catch {
      console.log(`${consolePrefix} single character generation - raw response (non-serializable):`, characterResult)
    }

    let imageUrl = ''
    
    // ========== Pusher 模式处理 ==========
    if (characterResult.requestId && (!characterResult.images || characterResult.images?.length === 0)) {
      console.log(`${consolePrefix} single character - 使用 Pusher 模式:`, { requestId: characterResult.requestId })
      
      try {
        const pusherData = await waitForGenerationResult({
          taskId: characterResult.requestId,
          type: 'character',
          timeoutMs: 900000
        })
        
        // 检查是否有错误（onFail 会 resolve 包含 error 的数据）
        if (pusherData?.error) {
          const errorMessage = pusherData.error
          setCharacterData((prev: any[]) => {
            const newItems = prev.length > 0 ? [...prev] : [...allChars]
            const idx = newItems.findIndex((item: CharacterItem) => String(item.id) === String(c.id))
            if (idx >= 0) {
              newItems[idx] = {
                ...newItems[idx],
                generationError: errorMessage  // 添加错误信息
              }
            }
            return newItems
          })
          // 返回失败结果而不是抛出错误
          return {
            characterId: c.id,
            imageUrl: '',
            requestId: characterResult.requestId || characterResult.request_id || null,
            raw: characterResult,
            error: errorMessage
          }
        }
        
        imageUrl = String(pusherData?.imageUrl || pusherData?.resultUrls?.[0] || '')
        console.log(`${consolePrefix} single character - Pusher 完成:`, imageUrl)

      } catch (pusherError) {
        console.error(`${consolePrefix} single character - Pusher 失败:`, pusherError)
        const errorMessage = pusherError instanceof Error ? pusherError.message : t('generationFailed')
        // 超时不显示错误，任务可能还在后台处理
        if (errorMessage.includes('等待生成结果超时')) {
          return {
            characterId: c.id,
            imageUrl: '',
            requestId: characterResult.requestId || characterResult.request_id || null,
            raw: characterResult,
            error: undefined
          }
        }
        // ========== 失败：更新状态显示错误 ==========
        setCharacterData((prev: CharacterItem[]) => {
          const newItems = prev.length > 0 ? [...prev] : [...allChars]
          const idx = newItems.findIndex((item: CharacterItem) => String(item.id) === String(c.id))
          if (idx >= 0) {
            newItems[idx] = {
              ...newItems[idx],
              generationError: errorMessage
            }
          }
          return newItems
        })
        // 返回失败结果而不是抛出错误
        return {
          characterId: c.id,
          imageUrl: '',
          requestId: characterResult.requestId || characterResult.request_id || null,
          raw: characterResult,
          error: errorMessage
        }
      }
      
    } else {
      // 轮询模式（回退）
      imageUrl = characterResult.images?.[0]?.url || 
                 characterResult.imageUrl || 
                 characterResult.images?.[0] || 
                 ''
    }

    const pushed = {
      characterId: c.id,
      imageUrl,
      requestId: characterResult.requestId || (characterResult.request_id || null),
      raw: characterResult
    }

    // ========== 实时更新：每成功生成一个主角就立即更新状态 ==========
    if (imageUrl && String(imageUrl).trim() !== '') {
      setCharacterData((prev: any[]) => {
        const newItems = prev.length > 0 ? [...prev] : [...allChars]
        const idx = newItems.findIndex((item: CharacterItem) => String(item.id) === String(c.id))
        if (idx >= 0) {
          newItems[idx] = {
            ...newItems[idx],
            imageUrl: imageUrl,
            thumbnailUrl: imageUrl,
            generationError: undefined  // 清除错误
          }
        }
        return newItems
      })
      console.log(`${consolePrefix} 主角 ${c.id} 生成成功，已实时更新显示`)
    }
    // ========== 实时更新结束 ==========

    return pushed
  }

  // 通用函数：将单个主角生成结果合并为最终主角数组，并更新状态（不发请求）
  const mergeCharactersFromResults = (
    allChars: CharacterItem[],
    results: {
      characterId: string | number | undefined
      imageUrl: string
      requestId:  string | null
      raw: unknown
      error?: string
    }[],
    consolePrefix: string
  ): CharacterItem[] => {
    console.log(`${consolePrefix} 所有主角生成完成:`, results.length)

    // Build a map from characterId -> resolved image URL
    const resultMap: Record<string, string> = {}
    for (const r of results) {
      if (r && r.characterId) {
        resultMap[String(r.characterId)] = r.imageUrl || ''
      }
    }

    const finalCharacterData = allChars.map((orig: CharacterItem) => {
      const foundImage = String(orig.imageUrl || '').trim()
      const rawImage = String(orig.imageUrl || '').trim()
      const rawThumb = String(orig.thumbnailUrl || '').trim()

      // 如果本次有新的生成结果，**强制**使用新图片，避免被旧快照覆盖
      if (foundImage !== '') {
        return {
          ...orig,
          imageUrl: foundImage,
          thumbnailUrl: foundImage,
          // 清理旧的错误状态
          generationError: undefined,
        }
      }

      // 否则保持原有图片（并做标准化）
      return {
        ...orig,
        imageUrl: rawImage !== '' ? rawImage : (rawThumb !== '' ? rawThumb : null),
        thumbnailUrl: rawThumb !== '' ? rawThumb : (rawImage !== '' ? rawImage : null),
      }
    })

    // log merged characters and image URLs to help diagnose missing images
    console.log(`${consolePrefix} finalCharacterData:`, finalCharacterData)
    finalCharacterData.forEach((mc: CharacterItem) =>
      console.log(
        `${consolePrefix} finalCharacterData imageUrl:`,
        mc.id,
        mc.imageUrl,
        'thumbnailUrl:',
        mc.thumbnailUrl
      )
    )

    setCharacterData(finalCharacterData)
    console.log(
      `${consolePrefix} 分镜图生成前 - finalCharacterData:`,
      finalCharacterData.map((c: CharacterItem) => ({ id: c.id, imageUrl: c.imageUrl }))
    )

    return finalCharacterData
  }

  // 显示单个主角重新生成确认弹窗
  const handleShowRegenerateCharacterDialog = (character: any) => {
    setCharacterToRegenerate(character)
    setShowRegenerateCharacterDialog(true)
  }


  // 执行单个主角重新生成（不修改提示词，不做兜底）
  const handleConfirmRegenerateCharacter = async () => {
    if (!characterToRegenerate || !scriptData) {
      toast({
        title: t("cannotRegenerate"),
        description: t("missingCharacterOrScript"),
        variant: "destructive",
      })
      return
    }

    setShowRegenerateCharacterDialog(false)
    setWorkflowStep('character')
    setWorkflowLoading(true)
    setIsRegeneratingCharacterId(characterToRegenerate.id)
    setWorkflowError(null)

    // 创建 AbortController 用于暂停（与第一次生成一致）
    abortControllerRef.current = new AbortController()

    try {
      // 基础角色快照：只使用当前已有的主角数据，不做兜底
      const baseChars: any[] =
        (Array.isArray(characterData) && characterData.length > 0)
          ? characterData
          : (Array.isArray(scriptData.characters) && scriptData.characters.length > 0
            ? scriptData.characters
            : [])

      if (!baseChars.length) {
        toast({
          title: t("cannotRegenerate"),
          description: t("noCharacterData"),
          variant: "destructive",
        })
        setWorkflowLoading(false)
        setIsRegeneratingCharacterId(null)
        return
      }

      const allCharsSnapshot = [...baseChars]

      const targetCharInSnapshot = allCharsSnapshot.find(
        (ch: any) => ch.id === characterToRegenerate.id
      )

      if (!targetCharInSnapshot) {
        toast({
          title: t("cannotRegenerate"),
          description: t("characterNotFound"),
          variant: "destructive",
        })
        setWorkflowLoading(false)
        setIsRegeneratingCharacterId(null)
        return
      }

      // ========== 清空该主角旧头像 URL，进入「生成中」视觉状态 ==========
      setCharacterData((prev: any[]) => {
        const newItems = prev && prev.length > 0 ? [...prev] : [...allCharsSnapshot]
        const idx = newItems.findIndex((item: any) => item.id === characterToRegenerate.id)
        if (idx >= 0) {
          newItems[idx] = {
            ...newItems[idx],
            imageUrl: null,
            thumbnailUrl: null,
            generationError: undefined, // 清理旧错误，避免干扰
          }
        }
        return newItems
      })

      // 仅用于日志展示，不回写覆盖原有提示词
      const generationPrompt =
        targetCharInSnapshot.generationPrompt ??
        targetCharInSnapshot.prompt ??
        targetCharInSnapshot.generation_prompt ??
        ''

      // 生成版本组ID（用于关联同一批次的重新生成任务）
      const vgId = generateVersionGroupId()

      console.log('[operate] regenerate character - request (via generateCharacterForSingle):', {
        characterId: characterToRegenerate.id,
        generationPrompt,
        versionGroupId: vgId,
      })

      // 调用通用单个主角生成函数（直接用当前主角 & 原始提示词）
      const singleResult = await generateCharacterForSingle({
        character: targetCharInSnapshot,
        allCharactersSnapshot: allCharsSnapshot,
        consolePrefix: '[handleConfirmRegenerateCharacter]',
        versionId: currentEditVersionId.current || undefined,
        versionGroupId: vgId,
      })

      // 将结果合并回全量主角数组（只有这个角色会被更新）
      const updatedCharacters = mergeCharactersFromResults(
        allCharsSnapshot,
        [singleResult],
        '[handleConfirmRegenerateCharacter]'
      )
      // 当前主角已重新生成完成，清除该主角的「重新生成中」状态
      setIsRegeneratingCharacterId(null)

      setWorkflowLoading(false)

      // 检查是否暂停（与第一次生成一致）
      await waitForWorkflowResume()

      // 找出引用了被重新生成角色的场景索引
      const affectedSceneIndices = (scriptData?.scenes ?? [])
        .map((scene: StoryScene, index: number) => {
          const sceneCharacterIds = scene.characterIds || []
          return sceneCharacterIds.includes(characterToRegenerate.id) ? index : -1
        })
        .filter((index: number) => index !== -1)

      console.log('[handleConfirmRegenerateCharacter] 受影响的场景索引:', affectedSceneIndices)

      if (affectedSceneIndices.length === 0) {
        // 如果没有场景引用该角色，直接返回
        setCharacterData(updatedCharacters)
        toast({
          title: t("characterRegeneratedSuccess"),
          description: t("noScenesAffected"),
        })
        setWorkflowLoading(false)
        return
      }

      // ========== 先把受影响场景的旧分镜图 / 剧情视频清空，进入「生成中」状态 ==========
      setStoryboardImages((prev: any[]) => {
        if (!prev || prev.length === 0) return prev
        const next = [...prev]
        affectedSceneIndices.forEach((idx: number) => {
          if (idx >= 0 && idx < next.length) {
            next[idx] = null
          }
        })
        return next
      })

      setSceneVideos((prev: any[]) => {
        if (!prev || prev.length === 0) return prev
        const next = [...prev]
        affectedSceneIndices.forEach((idx: number) => {
          if (idx >= 0 && idx < next.length && next[idx]) {
            next[idx] = { ...next[idx], videoUrl: null }
          }
        })
        return next
      })

      // 保存角色数据
      setCharacterData(updatedCharacters)

      toast({
        title: t("characterRegeneratedSuccess"),
        description: t("regeneratingScenes", { count: affectedSceneIndices.length }),
      })

      // 只重新生成分镜图（只处理引用了该角色的场景）
      setWorkflowStep('storyboard')
      setWorkflowLoading(true)

      // 创建 AbortController 用于暂停（与第一次生成一致）
      abortControllerRef.current = new AbortController()

      const storyboardPromises = affectedSceneIndices.map(async (sceneIndex: number) => {
        const scene = (scriptData?.scenes ?? [])[sceneIndex]

        // 根据场景的 characterIds 筛选角色
        const sceneCharacterIds = scene?.characterIds || []
        const relevantCharacters = updatedCharacters.filter((char: CharacterItem) =>
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

        return await generateStoryboardForScene({
          scene,
          sceneIndex,
          aspectRatio,
          characterImages,
          consolePrefix: '[handleRegenerateCharacter]',
          versionId: currentEditVersionId.current || undefined,
          versionGroupId: vgId,
          itemId: scene.id,
        })
      })

      const storyboardResults = await Promise.all(storyboardPromises)
      console.log('[handleRegenerateCharacter] 分镜图重新生成完成:', storyboardResults.map(sb => ({ url: sb?.url, sceneIndex: sb?.sceneIndex })))
      setStoryboardImages(storyboardResults)

      setWorkflowLoading(false)

      // 检查是否暂停（与第一次生成一致）
      await waitForWorkflowResume()

      // 只重新生成剧情视频（只处理引用了该角色的场景）
      setWorkflowStep('scenes')
      setWorkflowLoading(true)

      // 创建 AbortController 用于暂停（与第一次生成一致）
      abortControllerRef.current = new AbortController()

      const sceneVideosPromises = affectedSceneIndices.map(
        async (sceneIndex: number) => {
          const scene = (scriptData?.scenes ?? [])[sceneIndex]
          const storyboard = storyboardResults.find(
            (sb: StoryboardItem) => sb.sceneIndex === sceneIndex
          )

          return await generateSceneVideoForScene({
            scene,
            sceneIndex,
            storyboardImage: storyboard,
            aspectRatio,
            consolePrefix: '[handleRegenerateCharacter]',
            versionId: currentEditVersionId.current || undefined,
            versionGroupId: vgId,
          })
        }
      )

      const sceneVideosResults = await Promise.all(sceneVideosPromises)
      console.log('[handleRegenerateCharacter] 剧情视频重新生成完成:', sceneVideosResults.map(sv => ({ url: sv?.videoUrl, sceneIndex: sv?.sceneIndex })))

      // 合并回全量场景视频数组（只更新受影响场景）
      const allSceneVideos = [...sceneVideos]
      sceneVideosResults.forEach((video: any) => {
        if (video) allSceneVideos[video.sceneIndex] = video
      })
      setSceneVideos(allSceneVideos)

      setWorkflowLoading(false)

      // 检查是否暂停（与第一次生成一致）
      await waitForWorkflowResume()

      // 自动重新生成完整视频（与第一次生成一致）
      setWorkflowStep('video')
      setWorkflowLoading(true)
      setVideoData(null) // 清空旧的总视频，显示"生成中"状态

      // 创建 AbortController 用于暂停（与第一次生成一致）
      abortControllerRef.current = new AbortController()

      // 使用通用函数生成完整视频
      const videoData = await composeSceneVideosWithFAL(
        sceneVideosResults,
        scriptData,
        abortControllerRef.current?.signal,
        currentProjectId || undefined,
        currentEditVersionId.current || undefined,
        vgId // 传递版本组ID
      )

      if (!videoData) {
        setWorkflowLoading(false)
        setIsRegeneratingCharacterId(null)
        toast({
          title: t("videoComposeSkipped"),
          description: t("noValidSceneVideosSkipFinal"),
        })
      } else {
        setVideoData(videoData)
        setWorkflowLoading(false)
        setIsGenerating(false)
        toast({
          title: t("videoGeneratedSuccess"),
          description: t("videoReady"),
        })
      }

    } catch (error) {
      // 如果是用户主动取消（暂停），设置中断标志（与第一次生成一致）
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('单个主角重新生成工作流被用户暂停')
        workflowInterruptedRef.current = true
        // 暂停时不设置 isGenerating 为 false，保持暂停按钮可见
        setWorkflowLoading(false)
        abortControllerRef.current = null
        setIsRegeneratingCharacterId(null)
        return
      }

      console.error('单个主角重新生成工作流错误:', error)
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
      setIsRegeneratingCharacterId(null)
    }
  }

  // 开始编辑主角
  const handleStartEditCharacter = (character?: any) => {
    if (character) {
      const copy = JSON.parse(JSON.stringify(character)) // 深拷贝
      // 始终确保 prompt 和 generationPrompt 同步，避免保存时比较不一致
      const inferred = copy.generationPrompt ?? copy.generation_prompt ?? copy.prompt ?? (copy.description ? `realistic portrait, mid-shot, soft key light, ${copy.description}` : `realistic portrait, mid-shot, soft key light, ${copy.name ?? 'character'}`)
      copy.prompt = inferred
      copy.generationPrompt = inferred
      setEditedCharacterData(copy)
      setIsEditingCharacter(true)
      setCharacterEditMode('none') // 重置编辑模式
      setShowCharacterPreview(true)
    }
  }

  // 显示编辑主角保存确认弹窗
  const handleShowSaveEditCharacterDialog = () => {
    setShowSaveEditCharacterDialog(true)
  }

  // 执行保存编辑的主角
  const handleConfirmSaveEditedCharacter = async () => {
    // 先关闭确认弹窗、编辑弹窗和详情弹窗，并清空选中状态，避免确认后仍看到「主角详情」或关闭动画时闪现 Close 按钮
    const dataToSave = editedCharacterData ? { ...editedCharacterData } : null
    const wasUploadingImage = Boolean(characterImageFile)

    setShowSaveEditCharacterDialog(false)
    setIsEditingCharacter(false)
    setShowCharacterPreview(false)
    setEditedCharacterData(null)
    setCharacterImageFile(null)
    setCharacterEditMode('none')

    // 记录本次编辑是否包含用户上传的新图片（File 对象），必须在清理状态之前读取
    const uploadedThisEditAtSave = wasUploadingImage

    if (dataToSave && characterData && scriptData) {
      // 查找原始主角数据，检查图片和 prompt 是否被修改
      const originalCharacter = characterData.find(char => char.id === dataToSave.id)
      const originalImageUrl = originalCharacter ? (originalCharacter.imageUrl ?? originalCharacter.thumbnailUrl ?? '') : ''

      // 更宽松的比较：使用任意一个可用的 prompt 字段
      const originalPrompt = originalCharacter
        ? String(originalCharacter.generationPrompt ?? originalCharacter.prompt ?? originalCharacter.generation_prompt ?? '')
        : ''

      // 如果用户刚刚上传了图片，则优先使用上传图片
      const imageProvided = Boolean(dataToSave.imageUrl && dataToSave.imageUrl !== originalImageUrl)
      const imageChanged = uploadedThisEditAtSave || imageProvided

      // 检查 prompt 是否被修改 - 更宽松的比较
      const currentPrompt = String(dataToSave.generationPrompt ?? dataToSave.prompt ?? '')
      const promptChanged = currentPrompt.trim() !== String(originalPrompt).trim()

      // 如果没有上传新图片且没有修改 prompt，则提示未做修改
      if (!imageChanged && !promptChanged) {
        toast({
          title: t("noChanges"),
          description: t("uploadNewImageOrEditPrompt"),
        })
        return
      }

      // 生成版本组ID（用于关联同一批次的重新生成任务）
      // 如果修改了 prompt 或图片，都需要创建新版本
      const vgId = generateVersionGroupId()

      let finalCharacterData = { ...dataToSave }

        // 如果修改了 prompt 但没有上传新图片，需要重新生成主角图片
      if (promptChanged && !imageChanged) {
        setWorkflowLoading(true)
        setWorkflowStep('character')
        setIsRegeneratingCharacterId(dataToSave.id ?? null)

        toast({
          title: t("regeneratingCharacterImage"),
          description: t("pleaseWait"),
        })

        // ========== 清空该主角旧头像 URL，进入「生成中」视觉状态 ==========
        setCharacterData((prev: any[]) => {
          const newItems = prev && prev.length > 0 ? [...prev] : []
          const idx = newItems.findIndex((item: any) => item.id === dataToSave.id)
          if (idx >= 0) {
            newItems[idx] = {
              ...newItems[idx],
              imageUrl: null,
              thumbnailUrl: null,
              generationError: undefined,
            }
          }
          return newItems
        })

        // 生成版本组ID（用于关联同一批次的重新生成任务）
        // 注意：vgId 已在外部定义
        try {
          // 调用 AI 重新生成主角图片
          const singleResult = await generateCharacterForSingle({
            character: {
              id: finalCharacterData.id,
              name: finalCharacterData.name,
              generationPrompt: currentPrompt,
            },
            allCharactersSnapshot: characterData,
            consolePrefix: '[edit-character]',
            versionId: currentEditVersionId.current || undefined,
            versionGroupId: vgId,
          })

          if (singleResult?.imageUrl) {
            finalCharacterData = {
              ...finalCharacterData,
              imageUrl: singleResult.imageUrl,
              thumbnailUrl: (singleResult as any).thumbnailUrl || singleResult.imageUrl
            }
          }
        } catch (error) {
          console.error('重新生成主角图片失败:', error)
          toast({
            title: t("regenerateFailed"),
            description: t("retryLater"),
            variant: "destructive",
          })
          setWorkflowLoading(false)
          setIsRegeneratingCharacterId(null)
          return
        }

        // 清除「重新生成中」状态
        setIsRegeneratingCharacterId(null)
        setWorkflowLoading(false)
      }

      // 更新主角数据
      const updatedCharacters = characterData.map(char =>
        char.id === dataToSave.id ? finalCharacterData : char
      )
      setCharacterData(updatedCharacters)

      // 同步更新 scriptData.characters（如果存在），保证所有地方读取到最新主角数据
      if (scriptData && Array.isArray(scriptData.characters)) {
        setScriptData({
          ...scriptData,
          characters: updatedCharacters
        })
      }

      // 提示保存成功
      if (imageChanged) {
        toast({
          title: t("imageUpdated"),
          description: t("characterImageUpdated"),
        })
      } else if (promptChanged) {
        toast({
          title: t("promptUpdated"),
          description: t("characterImageRegenerated"),
        })
      }

      // 如果修改了图片或 prompt，分析哪些分镜图需要重新生成（包含修改主角的场景）
      if (imageChanged || promptChanged) {
        const scenesToRegenerate = (scriptData?.scenes ?? []).map((scene: StoryScene,  index: number) => {
          const plotText = scene.plot || ''
          const narrationText = scene.narration || ''
          const fullText = `${plotText} ${narrationText}`.toLowerCase()
          const characterName = String(finalCharacterData.name).toLowerCase()

          // 检查场景文本是否包含主角名称
          const containsCharacter = fullText.includes(characterName)

          return {
            index,
            scene,
            containsCharacter,
            existingStoryboard: storyboardImages[index]
          }
        })

        // 保留不需要重新生成的分镜图
        const updatedStoryboardImages = [...storyboardImages]

        // 只重新生成包含修改主角的场景的分镜图
        const scenesNeedingRegeneration = scenesToRegenerate.filter((s: any) => s.containsCharacter)

        if (scenesNeedingRegeneration.length > 0) {
          // 清空对应的剧情视频和完整视频
          setSceneVideos([])
          setVideoData(null)

          // ========== 清空需要重新生成分镜图的 URL，进入「生成中」视觉状态 ==========
          scenesNeedingRegeneration.forEach(({ index }: any) => {
            updatedStoryboardImages[index] = null as unknown as StoryboardItem
          })
          setStoryboardImages(updatedStoryboardImages)

          // 清空对应剧情视频的 URL
          const updatedSceneVideosForGenerate = [...sceneVideos]
          scenesNeedingRegeneration.forEach(({ index }: any) => {
            updatedSceneVideosForGenerate[index] = { ...updatedSceneVideosForGenerate[index], videoUrl: null }
          })
          setSceneVideos(updatedSceneVideosForGenerate)

          toast({
            title: t("imageUpdated"),
            description: t("regeneratingStoryboardsWithCharacter", { name: String(finalCharacterData.name), count: scenesNeedingRegeneration.length }),
          })

          try {
            // 只重新生成包含该主角的场景的分镜图
            setWorkflowStep('storyboard')
            setWorkflowLoading(true)
            // 设置「重新生成中」状态（设为第一个需要重新生成的场景索引）
            setIsRegeneratingStoryboard(scenesNeedingRegeneration[0]?.index)

            const regenerationPromises = scenesNeedingRegeneration.map(async ({ index, scene }: any) => {
              // 根据场景的 characterIds 筛选角色
              const sceneCharacterIds = scene.characterIds || []
              const relevantCharacters = updatedCharacters.filter((char: any) =>
                sceneCharacterIds.includes(char.id)
              )

              // 构建角色图片数组
              const characterImages = relevantCharacters.length > 0
                ? relevantCharacters.map((char: any) => ({
                    characterId: char.id,
                    imageUrl: char.imageUrl,
                    imagePrompt: char.generationPrompt || char.prompt || char.description || ''
                  }))
                : []

              // 使用通用函数生成单个分镜图
              const storyboardItem = await generateStoryboardForScene({
                scene,
                sceneIndex: index,
                aspectRatio,
                characterImages,
                consolePrefix: '[edit-character]',
                versionId: currentEditVersionId.current || undefined,
                versionGroupId: vgId,
                itemId: scene.id,
              })

              updatedStoryboardImages[index] = storyboardItem
            })

            await Promise.all(regenerationPromises)
            setStoryboardImages(updatedStoryboardImages)

            // 清除分镜图「重新生成中」状态
            setIsRegeneratingStoryboard(null)
            setWorkflowLoading(false)

            // 检查是否暂停
            await waitForWorkflowResume()

            // 重新生成相关的剧情视频
            setWorkflowStep('scenes')
            setWorkflowLoading(true)
            // 设置剧情视频「重新生成中」状态
            setIsRegeneratingSceneVideo(scenesNeedingRegeneration[0]?.index)

            const sceneVideosPromises = scenesNeedingRegeneration.map(
              async ({ index, scene }: any) => {
                const storyboardImage = updatedStoryboardImages[index]

                return await generateSceneVideoForScene({
                  scene,
                  sceneIndex: index,
                  storyboardImage,
                  aspectRatio,
                  consolePrefix: '[edit-character]',
                  versionId: currentEditVersionId.current || undefined,
                  versionGroupId: vgId,
                })
              }
            )

            const sceneVideosResults = await Promise.all(sceneVideosPromises)
            console.log('[edit-character] 剧情视频重新生成完成:', sceneVideosResults.map(sv => ({ url: sv?.videoUrl, sceneIndex: sv?.sceneIndex })))

            // 保存剧情视频到数据库
            // 保留其他不需要重新生成的剧情视频
            const allSceneVideos = [...sceneVideos]
            sceneVideosResults.forEach((video: any) => {
              if (video) {
                allSceneVideos[video.sceneIndex] = video
              }
            })
            setSceneVideos(allSceneVideos)

            // 清除剧情视频「重新生成中」状态
            setIsRegeneratingSceneVideo(null)
            setWorkflowLoading(false)

            // 检查是否暂停
            await waitForWorkflowResume()

            // 重新生成完整视频
            setWorkflowStep('video')
            setWorkflowLoading(true)
            setVideoData(null) // 清空旧的总视频，显示"生成中"状态

            // 使用通用函数生成完整视频
            const videoDataResult = await composeSceneVideosWithFAL(
              allSceneVideos,
              scriptData,
              undefined,
              currentProjectId || undefined,
              currentEditVersionId.current || undefined,
              vgId
            )

            if (videoDataResult) {
              setVideoData(videoDataResult)
              setWorkflowLoading(false)

              toast({
                title: t("regenerateCompleted"),
                description: t("characterUpdatedAll", { name: String(finalCharacterData.name ?? '') }),
              })
            } else {
              setWorkflowLoading(false)
              toast({
                title: t("videoComposeSkipped"),
                description: t("noValidSceneVideosSkipFinal"),
              })
            }

          } catch (error) {
            console.error('重新生成分镜图/剧情视频/总视频失败:', error)
            setWorkflowLoading(false)
            toast({
              title: t("autoRegenerateFailedTitle"),
              description: t("manuallyRegenerateNextSteps"),
              variant: "destructive",
            })
          }
        }
      }
    }
  }

  // 取消编辑主角
  const handleCancelEditCharacter = () => {
    setIsEditingCharacter(false)
    setEditedCharacterData(null)
    setCharacterImageFile(null)
    setCharacterEditMode('none')
  }


  // 处理主角图片上传
  const handleCharacterImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
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

    setCharacterImageFile(file)
    setIsUploadingCharacterImage(true)

    // 直接上传，不显示本地预览
    ;(async () => {
      // 读取文件为 base64
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
        setIsUploadingCharacterImage(false)
        return
      }

      try {
        // 上传到服务器
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
        setEditedCharacterData({
          ...editedCharacterData,
          imageUrl: uploadResult.url,
          thumbnailUrl: uploadResult.url
        })
        setCharacterEditMode('image') // 设置为图片编辑模式
        setIsUploadingCharacterImage(false)
      } catch (error) {
        setIsUploadingCharacterImage(false)
        toast({
          title: t("uploadFailed"),
          description: error instanceof Error ? error.message : t("pleaseRetry"),
          variant: "destructive",
        })
      }
    })()
  }

  // 处理主角图片URL输入
  const handleCharacterImageUrl = (url: string) => {
    if (!url.trim()) return

    setEditedCharacterData({
      ...editedCharacterData,
      imageUrl: url,
      thumbnailUrl: url
    })
  }

  // 处理粘贴图片
  const handleCharacterImagePaste = async (e: React.ClipboardEvent) => {
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

          setCharacterImageFile(file)
          setIsUploadingCharacterImage(true)

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
              setIsUploadingCharacterImage(false)
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

              setEditedCharacterData({
                ...editedCharacterData,
                imageUrl: uploadResult.url,
                thumbnailUrl: uploadResult.url
              })
              setIsUploadingCharacterImage(false)
            } catch (error) {
              setIsUploadingCharacterImage(false)
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

  return {
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
  }
}
