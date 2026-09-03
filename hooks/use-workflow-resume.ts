"use client"

/* eslint-disable @typescript-eslint/no-explicit-any -- 函数体逐字搬移自 operate.tsx 的存量弱类型(拆分 T17);逐处改类型将淹没「只移动不改行为」的 diff 证明,随后续清理票收敛 */

import { useTranslations } from "next-intl"
import { useToast } from "@/hooks/use-toast"
import type {
  WorkflowGenerationDeps,
} from "@/hooks/use-workflow-generation-deps"
import type { CharacterItem, StoryScene, StoryboardItem } from "@/lib/types"

/**
 * 恢复/续跑族 hook 的 deps(拆分 T17):共享接缝复用 WorkflowGenerationDeps。
 * waitForWorkflowResume/resumeCheckTimersRef/generateVersionGroupId 是被多个 hook
 * 共享的等待与 ID 原语,按职责留调用方(见票面「发现」)。
 */
export interface WorkflowResumeDeps extends WorkflowGenerationDeps {
  // 当次渲染值
  message: string
  duration: string
  videoModel: string
  videoStyle: string
  generationMode: string
  workflowStep: 'idle' | 'script' | 'character' | 'storyboard' | 'scenes' | 'video'
  videoData: any
  // ref 写入收敛为注入回调(hook 参数不可变,react-compiler 惯用法)
  setCurrentProjectIdRefValue: (v: string | null) => void
  // 上游 hook 实现/共享原语(T6/T7/T8 经 operate 注入)
  handleSend: () => Promise<void>
  generateCharacterForSingle: (params: any) => Promise<any>
  mergeCharactersFromResults: (allChars: any[], results: any[], consolePrefix: string) => any[]
  resumeStoryboardGeneration: (v: any) => Promise<any>
  generateStoryboardForScene: (params: any) => Promise<StoryboardItem>
  pendingTasksRef: { current: Map<string, { resolve: (data: any) => void }> }
  // 专属 setter
  setCurrentProjectId: (v: string | null) => void
  setIsGenerating: (v: boolean) => void
  setScriptData: (v: any) => void
  setCharacterData: (v: any[]) => void
  setShowInputBox: (v: boolean) => void
}

/**
 * 恢复/续跑族(自 operate.tsx 拆分 T17):createProject、resume 三函数、
 * 暂停/恢复、保存后自动再生、从恢复续跑生成。
 * 函数体逐字搬移,行为不变;i18n 与 toast hook 内自持,其余依赖注入。
 */
export function useWorkflowResume(deps: WorkflowResumeDeps) {
  const {
    abortControllerRef,
    versionGroupIdRef,
    currentEditVersionId,
    workflowPausedRef,
    workflowInterruptedRef,
    aspectRatio,
    characterData,
    scriptData,
    sceneVideos,
    storyboardImages,
    currentProjectId,
    setWorkflowPaused,
    setStoryboardImages,
    setSceneVideos,
    setVideoData,
    setWorkflowError,
    setWorkflowLoading,
    setWorkflowStep,
    waitForWorkflowResume,
    generateVersionGroupId,
    generateSceneVideoForScene,
    composeSceneVideosWithFAL,
    message,
    duration,
    videoModel,
    videoStyle,
    workflowStep,
    videoData,
    generationMode,
    handleSend,
    generateCharacterForSingle,
    mergeCharactersFromResults,
    resumeStoryboardGeneration,
    generateStoryboardForScene,
    pendingTasksRef,
    setCurrentProjectIdRefValue,
    setCurrentProjectId,
    setIsGenerating,
    setCharacterData,
  } = deps
  const t = useTranslations("operate")
  const { toast } = useToast()

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
        setCurrentProjectIdRefValue(newProjectId)
        console.log('[createProject] 项目创建成功:', newProjectId)
        return newProjectId
      }
    } catch (error) {
      console.error('创建项目失败:', error)
    }
    return null
  }

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
          const _mergedChars = mergeCharactersFromResults(allChars, resumeCharResults, '[resumeWorkflow]') // 存量未用(步骤3 改用 mergedChars 闭包外的局部),前缀避免告警

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

  return {
    createProject,
    resumeWorkflow,
    resumeSceneVideosGeneration,
    resumeVideoSynthesis,
    handlePauseResumeWorkflow,
    handleResumeContinueGeneration,
  }
}
