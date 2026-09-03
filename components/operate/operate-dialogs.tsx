"use client"

import { useTranslations } from "next-intl"
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  SetStateAction,
  TouchEvent as ReactTouchEvent,
} from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { LibraryDialog } from "@/components/operate/LibraryDialog"
import { LinkInputDialog } from "@/components/operate/LinkInputDialog"
import { PurchaseDialog } from "@/components/operate/PurchaseDialog"
import { FileSizeLimitDialog } from "@/components/operate/FileSizeLimitDialog"
import { StorageLimitDialog } from "@/components/operate/StorageLimitDialog"
import { MediaValidationDialog } from "@/components/operate/MediaValidationDialog"
import { PricingDialog } from "@/components/pricing-dialog"
import { SignInDialog } from "@/components/auth/signin-dialog"
import { CharacterDetailDialog } from "@/components/operate/CharacterDetailDialog"
import { StoryboardDetailDialog } from "@/components/operate/StoryboardDetailDialog"
import { SceneVideoDetailDialog } from "@/components/operate/SceneVideoDetailDialog"
import {
  RegenerateCharacterConfirmDialog,
  SaveEditCharacterConfirmDialog,
  RegenerateStoryboardConfirmDialog,
  SaveEditStoryboardConfirmDialog,
  RegenerateScriptConfirmDialog,
  RegenerateSceneVideoConfirmDialog,
  SaveEditSceneVideoConfirmDialog,
} from "@/components/operate/confirm-dialogs"
import type { CharacterItem, SceneVideoItem, ScriptData, StoryboardItem } from "@/lib/types"

type BoolSetter = Dispatch<SetStateAction<boolean>>

/**
 * operate 页弹窗挂载区（自 operate.tsx 拆分 T9）。零自身逻辑,props 全透传。
 * 因原 JSX 分居两个层级（内容层 div 内 / 根层）,拆为两个组件保持 DOM 结构不变:
 * - MediaDialogMounts:素材库/链接输入/图片预览（位于内容层 div 内）
 * - OverlayDialogMounts:购买/限额/校验/详情编辑/确认/登录（位于根层）
 */

export function MediaDialogMounts({
  libraryOpen,
  setLibraryOpen,
  handleLibrarySelect,
  showLinkInput,
  setShowLinkInput,
  linkInput,
  setLinkInput,
  handleAddLink,
  previewImage,
  closePreview,
  onTouchStart,
  onTouchEnd,
  showPrev,
  showNext,
  selectedImages,
}: {
  libraryOpen: boolean
  setLibraryOpen: BoolSetter
  handleLibrarySelect: (url: string) => void
  showLinkInput: boolean
  setShowLinkInput: BoolSetter
  linkInput: string
  setLinkInput: Dispatch<SetStateAction<string>>
  handleAddLink: () => void
  previewImage: string | null
  closePreview: () => void
  onTouchStart: (e: ReactTouchEvent) => void
  onTouchEnd: (e: ReactTouchEvent) => void
  showPrev: (e?: ReactMouseEvent | TouchEvent) => void
  showNext: (e?: ReactMouseEvent | TouchEvent) => void
  selectedImages: File[]
}) {
  const t = useTranslations("operate")

  return (
    <>
      {/* 素材库选择弹窗 */}
      <LibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        onSelect={handleLibrarySelect}
      />

      {/* 链接输入模态框 */}
      <LinkInputDialog
        open={showLinkInput}
        onOpenChange={setShowLinkInput}
        value={linkInput}
        onValueChange={setLinkInput}
        onAdd={handleAddLink}
        onCancel={() => {
          setShowLinkInput(false)
          setLinkInput("")
        }}
      />

      {/* 图片预览模态框 */}
      {previewImage && (
        <>
          {/* 全屏黑色背景遮罩 */}
          <div
            className="fixed inset-0 bg-black z-50"
            onClick={closePreview}
          />
          {/* 图片显示层 */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="relative max-w-5xl max-h-full flex items-center justify-center"
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 自 operate.tsx 逐字搬移的存量债务（T9） */}
              <img
                src={previewImage}
                alt={t("previewImageAlt")}
                className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              />
              {selectedImages.length > 1 && (
                <>
                  <button
                    onClick={(e) => showPrev(e)}
                    className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-background/80 hover:bg-background shadow-md flex items-center justify-center"
                  >
                    <ChevronLeft className="w-5 h-5 text-foreground" />
                  </button>
                  <button
                    onClick={(e) => showNext(e)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-background/80 hover:bg-background shadow-md flex items-center justify-center"
                  >
                    <ChevronRight className="w-5 h-5 text-foreground" />
                  </button>
                </>
              )}
              <button
                onClick={closePreview}
                className="absolute top-4 right-4 w-12 h-12 bg-background/90 hover:bg-background rounded-full flex items-center justify-center text-foreground hover:text-primary transition-colors shadow-lg"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

export function OverlayDialogMounts({
  showPurchaseDialog,
  setShowPurchaseDialog,
  purchaseDialogType,
  currentPoints,
  showFileSizeLimitDialog,
  setShowFileSizeLimitDialog,
  fileSizeLimitMB,
  showStorageLimitDialog,
  setShowStorageLimitDialog,
  storageLimitInfo,
  showMediaValidationDialog,
  setShowMediaValidationDialog,
  mediaValidationMessage,
  setMediaValidationMessage,
  pricingDialogTriggerRef,
  showCharacterPreview,
  setShowCharacterPreview,
  isEditingCharacter,
  setIsEditingCharacter,
  editedCharacterData,
  setEditedCharacterData,
  characterImageFile,
  setCharacterImageFile,
  characterEditMode,
  setCharacterEditMode,
  isUploadingCharacterImage,
  characterImageInputRef,
  handleCharacterImageUpload,
  handleCharacterImagePaste,
  handleCancelEditCharacter,
  handleShowSaveEditCharacterDialog,
  showStoryboardPreview,
  setShowStoryboardPreview,
  isEditingStoryboard,
  setIsEditingStoryboard,
  editingStoryboardIndex,
  setEditingStoryboardIndex,
  editedStoryboardData,
  setEditedStoryboardData,
  storyboardEditMode,
  setStoryboardEditMode,
  isUploadingStoryboardImage,
  storyboardImageInputRef,
  storyboardImageFile,
  handleStoryboardImageUpload,
  handleStoryboardImagePaste,
  handleCancelEditStoryboard,
  handleShowSaveEditStoryboardDialog,
  storyboardImages,
  scriptData,
  showSceneVideoPreview,
  setShowSceneVideoPreview,
  isEditingSceneVideo,
  setIsEditingSceneVideo,
  editingSceneVideoIndex,
  setEditingSceneVideoIndex,
  editedSceneVideoData,
  setEditedSceneVideoData,
  sceneVideos,
  aspectRatio,
  handleCancelEditSceneVideo,
  handleShowSaveEditSceneVideoDialog,
  showRegenerateCharacterDialog,
  setShowRegenerateCharacterDialog,
  characterToRegenerate,
  handleConfirmRegenerateCharacter,
  showSaveEditCharacterDialog,
  setShowSaveEditCharacterDialog,
  characterData,
  handleConfirmSaveEditedCharacter,
  showRegenerateStoryboardDialog,
  setShowRegenerateStoryboardDialog,
  storyboardToRegenerate,
  handleConfirmRegenerateStoryboard,
  showSaveEditStoryboardDialog,
  setShowSaveEditStoryboardDialog,
  handleConfirmSaveEditedStoryboard,
  showRegenerateScriptDialog,
  setShowRegenerateScriptDialog,
  handleConfirmRegenerateScript,
  showRegenerateSceneVideoDialog,
  setShowRegenerateSceneVideoDialog,
  sceneVideoToRegenerate,
  estimateSceneVideoPoints,
  handleConfirmRegenerateSceneVideo,
  showSaveEditSceneVideoDialog,
  setShowSaveEditSceneVideoDialog,
  handleConfirmSaveEditedSceneVideo,
  isSignInDialogOpen,
  setIsSignInDialogOpen,
}: {
  showPurchaseDialog: boolean
  setShowPurchaseDialog: BoolSetter
  purchaseDialogType: 'points' | 'subscription' | 'card_verify'
  currentPoints: number | null
  showFileSizeLimitDialog: boolean
  setShowFileSizeLimitDialog: BoolSetter
  fileSizeLimitMB: number
  showStorageLimitDialog: boolean
  setShowStorageLimitDialog: BoolSetter
  storageLimitInfo: { usedStorage: number; storageLimit: number; availableStorage: number } | null
  showMediaValidationDialog: boolean
  setShowMediaValidationDialog: BoolSetter
  mediaValidationMessage: string
  setMediaValidationMessage: Dispatch<SetStateAction<string>>
  pricingDialogTriggerRef: MutableRefObject<HTMLButtonElement | null>
  showCharacterPreview: boolean
  setShowCharacterPreview: BoolSetter
  isEditingCharacter: boolean
  setIsEditingCharacter: BoolSetter
  editedCharacterData: CharacterItem | null
  setEditedCharacterData: Dispatch<SetStateAction<CharacterItem | null>>
  characterImageFile: File | null
  setCharacterImageFile: Dispatch<SetStateAction<File | null>>
  characterEditMode: 'none' | 'image' | 'prompt'
  setCharacterEditMode: Dispatch<SetStateAction<'none' | 'image' | 'prompt'>>
  isUploadingCharacterImage: boolean
  characterImageInputRef: MutableRefObject<HTMLInputElement | null>
  handleCharacterImageUpload: (e: ChangeEvent<HTMLInputElement>) => void
  handleCharacterImagePaste: (e: ClipboardEvent) => void
  handleCancelEditCharacter: () => void
  handleShowSaveEditCharacterDialog: () => void
  showStoryboardPreview: boolean
  setShowStoryboardPreview: BoolSetter
  isEditingStoryboard: boolean
  setIsEditingStoryboard: BoolSetter
  editingStoryboardIndex: number | null
  setEditingStoryboardIndex: Dispatch<SetStateAction<number | null>>
  editedStoryboardData: StoryboardItem | null
  setEditedStoryboardData: Dispatch<SetStateAction<StoryboardItem | null>>
  storyboardEditMode: 'none' | 'image' | 'prompt'
  setStoryboardEditMode: Dispatch<SetStateAction<'none' | 'image' | 'prompt'>>
  isUploadingStoryboardImage: boolean
  storyboardImageInputRef: MutableRefObject<HTMLInputElement | null>
  storyboardImageFile: File | null
  handleStoryboardImageUpload: (e: ChangeEvent<HTMLInputElement>) => void
  handleStoryboardImagePaste: (e: ClipboardEvent) => void
  handleCancelEditStoryboard: () => void
  handleShowSaveEditStoryboardDialog: () => void
  storyboardImages: StoryboardItem[]
  scriptData: ScriptData | null
  showSceneVideoPreview: boolean
  setShowSceneVideoPreview: BoolSetter
  isEditingSceneVideo: boolean
  setIsEditingSceneVideo: BoolSetter
  editingSceneVideoIndex: number | null
  setEditingSceneVideoIndex: Dispatch<SetStateAction<number | null>>
  editedSceneVideoData: SceneVideoItem | null
  setEditedSceneVideoData: Dispatch<SetStateAction<SceneVideoItem | null>>
  sceneVideos: SceneVideoItem[]
  aspectRatio: string
  handleCancelEditSceneVideo: () => void
  handleShowSaveEditSceneVideoDialog: () => void
  showRegenerateCharacterDialog: boolean
  setShowRegenerateCharacterDialog: BoolSetter
  characterToRegenerate: { name?: string } | null
  handleConfirmRegenerateCharacter: () => void
  showSaveEditCharacterDialog: boolean
  setShowSaveEditCharacterDialog: BoolSetter
  characterData: CharacterItem[]
  handleConfirmSaveEditedCharacter: () => void
  showRegenerateStoryboardDialog: boolean
  setShowRegenerateStoryboardDialog: BoolSetter
  storyboardToRegenerate: number | null
  handleConfirmRegenerateStoryboard: () => void
  showSaveEditStoryboardDialog: boolean
  setShowSaveEditStoryboardDialog: BoolSetter
  handleConfirmSaveEditedStoryboard: () => void
  showRegenerateScriptDialog: boolean
  setShowRegenerateScriptDialog: BoolSetter
  handleConfirmRegenerateScript: () => void
  showRegenerateSceneVideoDialog: boolean
  setShowRegenerateSceneVideoDialog: BoolSetter
  sceneVideoToRegenerate: number | null
  estimateSceneVideoPoints: (sceneIndex?: number | null) => number
  handleConfirmRegenerateSceneVideo: () => void
  showSaveEditSceneVideoDialog: boolean
  setShowSaveEditSceneVideoDialog: BoolSetter
  handleConfirmSaveEditedSceneVideo: () => void
  isSignInDialogOpen: boolean
  setIsSignInDialogOpen: BoolSetter
}) {
  const t = useTranslations("operate")

  return (
    <>
      {/* 积分不足购买弹窗 */}
      <PurchaseDialog
        open={showPurchaseDialog}
        onOpenChange={setShowPurchaseDialog}
        dialogType={purchaseDialogType}
        currentPoints={currentPoints || 0}
        onUpgrade={() => {
          // 关闭当前提示弹窗，触发订阅弹窗
          setShowPurchaseDialog(false)
          // 延迟一下再触发，避免冲突
          setTimeout(() => {
            pricingDialogTriggerRef.current?.click()
          }, 100)
        }}
      />

      {/* 文件大小超限弹窗 */}
      <FileSizeLimitDialog
        open={showFileSizeLimitDialog}
        onOpenChange={setShowFileSizeLimitDialog}
        limitMB={fileSizeLimitMB}
        onUpgrade={() => {
          setShowFileSizeLimitDialog(false)
          setTimeout(() => {
            pricingDialogTriggerRef.current?.click()
          }, 100)
        }}
      />

      {/* 存储空间超限弹窗 */}
      <StorageLimitDialog
        open={showStorageLimitDialog}
        onOpenChange={setShowStorageLimitDialog}
        info={storageLimitInfo}
        onUpgrade={() => {
          setShowStorageLimitDialog(false)
          setTimeout(() => {
            pricingDialogTriggerRef.current?.click()
          }, 100)
        }}
      />

      {/* 媒体文件不符合 Seedance 约束弹窗 */}
      <MediaValidationDialog
        open={showMediaValidationDialog}
        onOpenChange={(v) => {
          setShowMediaValidationDialog(v)
          if (!v) setMediaValidationMessage("")
        }}
        message={mediaValidationMessage}
      />

      {/* 订阅弹窗（使用PricingDialog组件） */}
      <PricingDialog>
        <button
          ref={pricingDialogTriggerRef}
          className="hidden"
          aria-hidden="true"
        >
          {t("upgrade")}
        </button>
      </PricingDialog>

      {/* 主角详情预览/编辑对话框（components/operate/CharacterDetailDialog.tsx，拆分 T7，行为与原来一致） */}
      <CharacterDetailDialog
        open={showCharacterPreview}
        onOpenChange={(open) => {
          setShowCharacterPreview(open)
          if (!open) {
            setIsEditingCharacter(false)
            setEditedCharacterData(null)
            setCharacterImageFile(null)
            setCharacterEditMode('none')
          }
        }}
        onClose={() => setShowCharacterPreview(false)}
        isEditing={isEditingCharacter}
        editedData={editedCharacterData}
        onEditedDataChange={setEditedCharacterData}
        editMode={characterEditMode}
        onEditModeChange={setCharacterEditMode}
        isUploadingImage={isUploadingCharacterImage}
        imageInputRef={characterImageInputRef}
        onImageUpload={handleCharacterImageUpload}
        onImagePaste={handleCharacterImagePaste}
        onCancelEdit={handleCancelEditCharacter}
        onShowSaveEditDialog={handleShowSaveEditCharacterDialog}
      />

      {/* 分镜图详情预览/编辑对话框（components/operate/StoryboardDetailDialog.tsx，拆分 T6，行为与原来一致） */}
      <StoryboardDetailDialog
        open={showStoryboardPreview}
        onOpenChange={(open) => {
          setShowStoryboardPreview(open)
          if (!open) {
            setIsEditingStoryboard(false)
            setEditingStoryboardIndex(null)
            setEditedStoryboardData(null)
          }
        }}
        onClose={() => setShowStoryboardPreview(false)}
        isEditing={isEditingStoryboard}
        editingIndex={editingStoryboardIndex}
        editedData={editedStoryboardData}
        onEditedDataChange={setEditedStoryboardData}
        editMode={storyboardEditMode}
        onEditModeChange={setStoryboardEditMode}
        isUploadingImage={isUploadingStoryboardImage}
        imageInputRef={storyboardImageInputRef}
        onImageUpload={handleStoryboardImageUpload}
        onImagePaste={handleStoryboardImagePaste}
        onCancelEdit={handleCancelEditStoryboard}
        onShowSaveEditDialog={handleShowSaveEditStoryboardDialog}
        storyboardImages={storyboardImages}
        scriptData={scriptData}
      />

      {/* 剧情视频详情预览/编辑对话框（components/operate/SceneVideoDetailDialog.tsx，拆分 T9，行为与原来一致） */}
      <SceneVideoDetailDialog
        open={showSceneVideoPreview}
        onOpenChange={(open) => {
          setShowSceneVideoPreview(open)
          if (!open) {
            setIsEditingSceneVideo(false)
            setEditingSceneVideoIndex(null)
            setEditedSceneVideoData(null)
          }
        }}
        onClose={() => setShowSceneVideoPreview(false)}
        isEditing={isEditingSceneVideo}
        editingIndex={editingSceneVideoIndex}
        editedData={editedSceneVideoData}
        sceneVideos={sceneVideos}
        aspectRatio={aspectRatio}
        scriptData={scriptData}
        onEditedDataChange={setEditedSceneVideoData}
        onCancelEdit={handleCancelEditSceneVideo}
        onShowSaveEditDialog={handleShowSaveEditSceneVideoDialog}
      />

      {/* 单个主角重新生成确认弹窗 */}
      <RegenerateCharacterConfirmDialog
        open={showRegenerateCharacterDialog}
        onOpenChange={setShowRegenerateCharacterDialog}
        characterName={characterToRegenerate?.name}
        onConfirm={handleConfirmRegenerateCharacter}
      />

      {/* 编辑主角保存确认弹窗 */}
      <SaveEditCharacterConfirmDialog
        open={showSaveEditCharacterDialog}
        onOpenChange={setShowSaveEditCharacterDialog}
        editedCharacterData={editedCharacterData}
        characterData={characterData}
        hasNewImageFile={Boolean(characterImageFile)}
        onConfirm={handleConfirmSaveEditedCharacter}
      />

      {/* 分镜图重新生成确认弹窗 */}
      <RegenerateStoryboardConfirmDialog
        open={showRegenerateStoryboardDialog}
        onOpenChange={setShowRegenerateStoryboardDialog}
        sceneIndex={storyboardToRegenerate}
        sceneExists={storyboardToRegenerate !== null && Boolean(scriptData?.scenes?.[storyboardToRegenerate])}
        onConfirm={handleConfirmRegenerateStoryboard}
      />

      {/* 编辑分镜图保存确认弹窗 */}
      <SaveEditStoryboardConfirmDialog
        open={showSaveEditStoryboardDialog}
        onOpenChange={setShowSaveEditStoryboardDialog}
        editedStoryboardData={editedStoryboardData}
        sceneIndex={editingStoryboardIndex}
        originalStoryboard={editingStoryboardIndex !== null ? storyboardImages[editingStoryboardIndex] : null}
        hasNewImageFile={Boolean(storyboardImageFile)}
        onConfirm={handleConfirmSaveEditedStoryboard}
      />

      {/* 重新生成全部剧情确认弹窗 */}
      <RegenerateScriptConfirmDialog
        open={showRegenerateScriptDialog}
        onOpenChange={setShowRegenerateScriptDialog}
        onConfirm={handleConfirmRegenerateScript}
      />

      {/* 剧情视频重新生成确认弹窗 */}
      <RegenerateSceneVideoConfirmDialog
        open={showRegenerateSceneVideoDialog}
        onOpenChange={setShowRegenerateSceneVideoDialog}
        sceneIndex={sceneVideoToRegenerate}
        sceneExists={sceneVideoToRegenerate !== null && Boolean(scriptData?.scenes?.[sceneVideoToRegenerate])}
        estimatedPoints={estimateSceneVideoPoints(sceneVideoToRegenerate ?? undefined)}
        onConfirm={handleConfirmRegenerateSceneVideo}
      />

      {/* 编辑剧情视频保存确认弹窗 */}
      <SaveEditSceneVideoConfirmDialog
        open={showSaveEditSceneVideoDialog}
        onOpenChange={setShowSaveEditSceneVideoDialog}
        editedSceneVideoData={editedSceneVideoData}
        sceneIndex={editingSceneVideoIndex}
        originalSceneVideo={editingSceneVideoIndex !== null ? sceneVideos[editingSceneVideoIndex] : null}
        onConfirm={handleConfirmSaveEditedSceneVideo}
      />

      <SignInDialog open={isSignInDialogOpen} onOpenChange={setIsSignInDialogOpen} />
    </>
  )
}
