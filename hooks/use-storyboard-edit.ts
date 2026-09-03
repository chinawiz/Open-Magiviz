"use client"

/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any -- 函数体逐字搬移自 operate.tsx 的存量弱类型(拆分 T15);逐处改类型将淹没「只移动不改行为」的 diff 证明,随后续清理票收敛 */

import { useState } from "react"
import type { ChangeEvent, ClipboardEvent, Dispatch, SetStateAction } from "react"
import { useTranslations } from "next-intl"
import { useToast } from "@/hooks/use-toast"
import type { CharacterItem, StoryboardItem } from "@/lib/types"
import type {
  WorkflowGenerationDeps,
} from "@/hooks/use-workflow-generation-deps"
import { computeFileSizeLimit } from "@/components/operate/format"

/**
 * 分镜编辑族 hook 的 deps(拆分 T15):共享接缝复用 WorkflowGenerationDeps,
 * 另补编辑态专属依赖;isRegeneratingStoryboard 状态与 T6/T7 hook 共享,留调用方。
 */
export interface StoryboardEditDeps extends WorkflowGenerationDeps {
  // 当次渲染值
  generationMode: string
  subscriptionPlan: string | null
  // 上传/存储外围(use-file-storage hook 注入)
  checkStorageAvailable: (totalFileSize: number) => Promise<{ available: boolean; storageInfo?: { usedStorage: number; storageLimit: number; availableStorage: number } }>
  handleStorageLimitExceeded: (storageInfo: { usedStorage: number; storageLimit: number; availableStorage: number }) => void
  handleFileSizeExceeded: () => void
  // 上游 hook 实现
  generateStoryboardForScene: (params: {
    scene: any
    sceneIndex: number
    aspectRatio: string
    characterImages: any[]
    consolePrefix: string
    versionId?: string
    versionGroupId?: string
    itemId?: string
    regenerateFrameType?: 'first' | 'last'
  }) => Promise<StoryboardItem>
  // T14 再生族接缝
  regenerateCorrespondingSceneVideo: (sceneIndex: number, updatedStoryboardImage: any, updatedStoryboardImages?: any[], versionGroupId?: string) => Promise<void>
  // 专属 setter
  setShowSaveEditStoryboardDialog: (v: boolean) => void
  setShowStoryboardPreview: (v: boolean) => void
  setIsRegeneratingStoryboard: Dispatch<SetStateAction<number | null>>
}

/**
 * 分镜编辑族(自 operate.tsx 拆分 T15):分镜图编辑生命周期、换图上传/粘贴两入口。
 * 编辑态 state 由本 hook 自持并原样返回(解构沿用原名,调用点/弹窗 props 零改动);
 * 函数体逐字搬移,行为不变;i18n 与 toast hook 内自持。
 */
export function useStoryboardEdit(deps: StoryboardEditDeps) {
  const {
    abortControllerRef,
    currentProjectIdRef,
    currentEditVersionId,
    workflowPausedRef,
    workflowInterruptedRef,
    aspectRatio,
    characterData,
    scriptData,
    storyboardImages,
    setStoryboardImages,
    sceneVideos,
    currentProjectId,
    setWorkflowError,
    setVideoData,
    setSceneVideos,
    setWorkflowLoading,
    setWorkflowStep,
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
  } = deps
  const t = useTranslations("operate")
  const { toast } = useToast()

  // ===== 编辑态(自 operate.tsx 迁入,hook 自持) =====
  const [isEditingStoryboard, setIsEditingStoryboard] = useState(false)
  const [editingStoryboardIndex, setEditingStoryboardIndex] = useState<number | null>(null)
  const [editedStoryboardData, setEditedStoryboardData] = useState<StoryboardItem | null>(null)
  const [storyboardImageFile, setStoryboardImageFile] = useState<File | null>(null)
  const [storyboardEditMode, setStoryboardEditMode] = useState<'none' | 'image' | 'prompt'>('none')
  const [isUploadingStoryboardImage, setIsUploadingStoryboardImage] = useState(false)

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

  // 处理分镜图图片上传
  const handleStoryboardImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
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
  const handleStoryboardImagePaste = async (e: ClipboardEvent) => {
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

  return {
    // 编辑态(原样返回,调用点零改动)
    isEditingStoryboard,
    setIsEditingStoryboard,
    editingStoryboardIndex,
    setEditingStoryboardIndex,
    editedStoryboardData,
    setEditedStoryboardData,
    storyboardImageFile,
    setStoryboardImageFile,
    storyboardEditMode,
    setStoryboardEditMode,
    isUploadingStoryboardImage,
    setIsUploadingStoryboardImage,
    // 处理器
    handleStartEditStoryboard,
    handleShowSaveEditStoryboardDialog,
    handleConfirmSaveEditedStoryboard,
    handleCancelEditStoryboard,
    handleStoryboardImageUpload,
    handleStoryboardImagePaste,
  }
}
