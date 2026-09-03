"use client"

import { useTranslations } from "next-intl"
import { Loader2, Upload } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { ChangeEvent, ClipboardEvent, MutableRefObject } from "react"
import type { ScriptData, StoryboardItem } from "@/lib/types"

/**
 * 分镜图详情预览/编辑弹窗（自 operate.tsx 抽出，拆分 T6）。
 * JSX 逐字搬移;编辑状态(编辑中/帧模式/上传中)与保存/取消动作由调用方注入。
 */
export function StoryboardDetailDialog({
  open,
  onOpenChange,
  onClose,
  isEditing,
  editingIndex,
  editedData,
  onEditedDataChange,
  editMode,
  onEditModeChange,
  isUploadingImage,
  imageInputRef,
  onImageUpload,
  onImagePaste,
  onCancelEdit,
  onShowSaveEditDialog,
  storyboardImages,
  scriptData,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onClose: () => void
  isEditing: boolean
  editingIndex: number | null
  editedData: StoryboardItem | null
  onEditedDataChange: (data: StoryboardItem | null) => void
  editMode: 'none' | 'image' | 'prompt'
  onEditModeChange: (mode: 'none' | 'image' | 'prompt') => void
  isUploadingImage: boolean
  imageInputRef: MutableRefObject<HTMLInputElement | null>
  onImageUpload: (e: ChangeEvent<HTMLInputElement>) => void
  onImagePaste: (e: ClipboardEvent) => void
  onCancelEdit: () => void
  onShowSaveEditDialog: () => void
  storyboardImages: StoryboardItem[]
  scriptData: ScriptData | null
}) {
  const t = useTranslations("operate")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-full max-w-4xl max-h-[80vh] overflow-y-auto p-4">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              {isEditing ? t("editStoryboard") : t("storyboardDetails")}
            </DialogTitle>
          </DialogHeader>
          {(isEditing ? editedData : (editingIndex !== null ? storyboardImages[editingIndex] : null)) && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-4">
                {/* 分镜图显示 */}
                <div className="flex-shrink-0 w-full sm:w-80">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">{t("storyboard")}</div>
                    <div className="relative group">
                      {(() => {
                        const data = isEditing ? editedData : storyboardImages[editingIndex!]
                        // 如果是编辑单个帧模式，只显示该帧
                        if (data?.isEditingFirstFrame) {
                          return (
                            <div className="relative">
                              <img
                                src={data.firstFrameUrl || data.url}
                                alt={t("storyboardNumber", { number: (data.sceneIndex ?? 0) + 1 }) + " - " + t("firstFrame")}
                                className="w-full rounded-lg"
                                onPaste={(e) => {
                                  if (isEditing && !isUploadingImage) {
                                    onImagePaste(e)
                                  }
                                }}
                              />
                              <span className="absolute top-1 left-1 px-1.5 py-0.5 text-[10px] bg-blue-600 text-white rounded">
                                {t("firstFrame")} ({t("editing")})
                              </span>
                            </div>
                          )
                        }
                        if (data?.isEditingLastFrame) {
                          return (
                            <div className="relative">
                              <img
                                src={data.lastFrameUrl}
                                alt={t("storyboardNumber", { number: (data.sceneIndex ?? 0) + 1 }) + " - " + t("lastFrame")}
                                className="w-full rounded-lg"
                              />
                              <span className="absolute top-1 left-1 px-1.5 py-0.5 text-[10px] bg-purple-600 text-white rounded">
                                {t("lastFrame")} ({t("editing")})
                              </span>
                            </div>
                          )
                        }
                        return data?.url || data?.firstFrameUrl ? (
                          <div className="relative">
                            {/* 直接显示首帧和尾帧（并排） */}
                            <div className="flex gap-1 rounded-lg overflow-hidden">
                              {/* 首帧 */}
                              <div className="flex-1 relative">
                                <img
                                  src={data.firstFrameUrl || data.url}
                                  alt={t("storyboardNumber", { number: (data.sceneIndex ?? 0) + 1 })}
                                  className="w-full rounded-lg"
                                  onPaste={(e) => {
                                    if (isEditing && !isUploadingImage) {
                                      onImagePaste(e)
                                    }
                                  }}
                                />
                                <span className="absolute top-1 left-1 px-1.5 py-0.5 text-[10px] bg-blue-600 text-white rounded">
                                  {t("firstFrame")}
                                </span>
                              </div>
                              
                              {/* 尾帧（如果有） */}
                              {data.lastFrameUrl && data.lastFrameUrl !== data.firstFrameUrl && data.lastFrameUrl !== data.url && (
                                <div className="flex-1 relative">
                                  <img
                                    src={data.lastFrameUrl}
                                    alt={t("storyboardNumber", { number: (data.sceneIndex ?? 0) + 1 }) + " " + t("lastFrame")}
                                    className="w-full rounded-lg"
                                  />
                                  <span className="absolute top-1 left-1 px-1.5 py-0.5 text-[10px] bg-purple-600 text-white rounded">
                                    {t("lastFrame")}
                                  </span>
                                </div>
                              )}
                            </div>
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
                        )
                      })()}
                      {isEditing && !isUploadingImage && (
                        <>
                          {/* 更换图片按钮 */}
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => imageInputRef.current?.click()}
                            >
                              <Upload className="w-3 h-3 mr-1" />
                              {t("changeImage")}
                            </Button>
                          </div>

                          {/* 粘贴提示 */}
                          <div className="absolute bottom-2 left-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="bg-black/60 backdrop-blur-sm rounded px-2 py-1">
                              <p className="text-xs text-white/80 text-center">
                                {t("pasteImageHint")}
                              </p>
                            </div>
                          </div>
                        </>
                      )}
                      {isUploadingImage && (
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center rounded-lg">
                          <div className="flex flex-col items-center gap-1 text-white">
                            <Loader2 className="w-6 h-6 animate-spin" />
                            <span className="text-xs">{t("uploading")}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 隐藏的文件输入 */}
                  {isEditing && (
                    <Input
                      type="file"
                      ref={imageInputRef}
                      onChange={onImageUpload}
                      accept="image/*"
                      className="hidden"
                    />
                  )}
                </div>

                {/* 场景信息 */}
                <div className="flex-1 space-y-4">
                  <div>
                    <div className="text-sm font-medium mb-2">{t("sceneInfoLabel")}</div>
                    <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{t("sceneNumberLabel")}</span>
                        <span className="text-sm font-medium">
                          {t("sceneNumber", { number: (((isEditing ? editedData : storyboardImages[editingIndex!]) ?? ({} as StoryboardItem)).sceneIndex ?? 0) + 1 })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{t("aspectRatioLabel2")}</span>
                        <span className="text-sm font-medium">
                          {((isEditing ? editedData : storyboardImages[editingIndex!]) ?? ({} as StoryboardItem)).aspectRatio}
                        </span>
                      </div>

                    </div>
                  </div>

                  {/* 剧情描述 */}
                  {scriptData?.scenes?.[(((isEditing ? editedData : storyboardImages[editingIndex!]) ?? ({} as StoryboardItem)).sceneIndex ?? 0)] && (
                    <div>
                      <div className="text-sm font-medium mb-2">{t("sceneDescriptionLabel")}</div>
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-sm text-muted-foreground">
                          {scriptData?.scenes?.[(((isEditing ? editedData : storyboardImages[editingIndex!]) ?? ({} as StoryboardItem)).sceneIndex ?? 0)]?.plot}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Prompt 输入框（编辑模式） */}
                  {isEditing && (
                    <div>
                      <div className="text-sm font-medium mb-1">
                        {t("prompt")}
                        {editMode === 'image' && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            ({t("imageSelected")})
                          </span>
                        )}
                      </div>
                      <Textarea
                        value={editedData?.prompt || ""}
                        onChange={(e) => {
                          onEditedDataChange({
                            ...editedData,
                            prompt: e.target.value
                          })
                          // 用户开始编辑 Prompt 时设置为 prompt 模式
                          if (editMode !== 'image') {
                            onEditModeChange('prompt')
                          }
                        }}
                        disabled={editMode === 'image'}
                        className={`min-h-[100px] ${editMode === 'image' ? 'bg-muted/30 cursor-not-allowed' : ''}`}
                        placeholder={editMode === 'image' ? t("clearImageToEditPrompt") : (t("enterPrompt"))}
                      />
                    </div>
                  )}

                </div>
              </div>

              {/* 操作按钮（移动端每行一个） */}
              <div className="flex flex-col sm:flex-row gap-2 pt-4 border-t border-border min-w-0">
                {isEditing ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={onCancelEdit}
                      className="w-full sm:flex-1"
                    >
                      {t("cancel")}
                    </Button>
                    <Button
                      onClick={onShowSaveEditDialog}
                      className="w-full sm:flex-1"
                    >
                      {t("saveChanges")}
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={() => onClose()}
                    className="w-full sm:flex-1"
                  >
                    {t("close")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
  )
}
