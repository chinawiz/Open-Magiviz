"use client"

/* eslint-disable @typescript-eslint/no-unused-vars -- 逐字搬移的原 dep 数组保真(拆分 T17),exhaustive-deps 已就地留痕 */

import { useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { useToast } from "@/hooks/use-toast"
import { parseStoryboardRestoreData } from "@/components/operate/storyboard-restore"
import type {
  CharacterItem,
  ComposedVideoResult,
  SceneVideoItem,
  ScriptData,
  StoryboardItem,
  StoryScene,
} from "@/lib/types"

/**
 * 项目恢复 hook 的 deps(拆分 T17):恢复挂载与恢复后步骤判定。
 * restoredVersionHasVideo/restoredProjectCompleted 状态与 WorkflowHeader(T13)
 * 及续跑族共享,留调用方经 deps 注入。
 */
export interface ProjectRestoreDeps {
  resumeProjectId?: string | null
  resumeVersionId?: string | null
  isGenerating: boolean
  aspectRatio: string
  workflowStep: 'idle' | 'script' | 'character' | 'storyboard' | 'scenes' | 'video'
  scriptData: ScriptData | null
  characterData: CharacterItem[]
  storyboardImages: StoryboardItem[]
  sceneVideos: SceneVideoItem[]
  videoData: ComposedVideoResult | null
  setMessage: (v: string) => void
  setAspectRatio: (v: string) => void
  setDuration: (v: string) => void
  setVideoStyle: (v: string) => void
  setVideoModel: (v: string) => void
  setGenerationMode: (v: string) => void
  setScriptData: (v: ScriptData | null) => void
  setCharacterData: (v: CharacterItem[]) => void
  setStoryboardImages: (v: StoryboardItem[]) => void
  setSceneVideos: (v: SceneVideoItem[]) => void
  setVideoData: (v: ComposedVideoResult | null) => void
  setRestoredVersionHasVideo: (v: boolean) => void
  setRestoredProjectCompleted: (v: boolean) => void
  setCurrentProjectId: (v: string | null) => void
  setWorkflowStep: (v: 'idle' | 'script' | 'character' | 'storyboard' | 'scenes' | 'video') => void
  setShowInputBox: (v: boolean) => void
  setIsGenerating: (v: boolean) => void
  // ref 写入收敛为注入回调(hook 参数不可变,react-compiler 惯用法)
  setVersionGroupIdRefValue: (v: string | null) => void
  setCurrentEditVersionIdRefValue: (v: string | null) => void
  // 续跑族接缝(use-workflow-resume 注入)
  handleResumeContinueGeneration: () => Promise<void> | void
}

/**
 * 项目恢复(自 operate.tsx 拆分 T17):恢复项目数据、继续生成入口、
 * resumeProjectId 监听与恢复后步骤判定两 effect。
 * 函数体逐字搬移,行为不变;toast hook 内自持。
 */
export function useProjectRestore(deps: ProjectRestoreDeps) {
  const {
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
    setVersionGroupIdRefValue,
    setCurrentEditVersionIdRefValue,
    handleResumeContinueGeneration,
  } = deps
  const t = useTranslations("operate")
  const { toast } = useToast()

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
        setVersionGroupIdRefValue(projectData.versionGroupId)
        console.log('[恢复] 使用 projectData 版本组ID:', projectData.versionGroupId)
      } else if (projectInfo?.versionGroupId) {
        setVersionGroupIdRefValue(projectInfo.versionGroupId)
        console.log('[恢复] 使用 projectInfo 版本组ID:', projectInfo.versionGroupId)
      } else {
        // 原项目没有 versionGroupId，继续生成时也不需要生成新的
        setVersionGroupIdRefValue(null)
        console.log('[恢复] 原项目无版本组ID，继续生成不需要新版本组')
      }

      // 恢复版本 ID（用于继续生成时不创建新版本）
      // 重要：必须使用 projectData.id，而不是 resumeVersionId
      // resumeVersionId 可能是版本号（如 "2"），但后续操作需要的是 projectData.id（如 "abc123"）
      // API 返回的 projectData 已经包含了正确的 id
      if (projectData?.id) {
        setCurrentEditVersionIdRefValue(String(projectData.id))
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 自 operate.tsx 逐字搬移的原 dep 数组(T17),收紧将改变触发时机
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 自 operate.tsx 逐字搬移的原 dep 数组(T17),收紧将改变触发时机
  }, [scriptData, characterData, storyboardImages, sceneVideos, videoData])

  return {
    handleResumeContinue,
  }
}
