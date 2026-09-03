"use client"

import { useTranslations } from "next-intl"
import { Loader2, Upload } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { ChangeEvent, ClipboardEvent, MutableRefObject } from "react"
import type { CharacterItem } from "@/lib/types"

/**
 * 主角详情预览/编辑弹窗（自 operate.tsx 抽出，拆分 T7）。
 * JSX 逐字搬移;编辑态(编辑中/帧模式/上传中)与取消/保存动作由调用方注入。
 */
export function CharacterDetailDialog({
  open,
  onOpenChange,
  onClose,
  isEditing,
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
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onClose: () => void
  isEditing: boolean
  editedData: CharacterItem | null
  onEditedDataChange: (data: CharacterItem | null) => void
  editMode: 'none' | 'image' | 'prompt'
  onEditModeChange: (mode: 'none' | 'image' | 'prompt') => void
  isUploadingImage: boolean
  imageInputRef: MutableRefObject<HTMLInputElement | null>
  onImageUpload: (e: ChangeEvent<HTMLInputElement>) => void
  onImagePaste: (e: ClipboardEvent) => void
  onCancelEdit: () => void
  onShowSaveEditDialog: () => void
}) {
  const t = useTranslations("operate")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="w-full max-w-2xl max-h-[80vh] overflow-y-auto p-4">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              {isEditing ? t("editCharacter") : t("characterDetails")}
            </DialogTitle>
          </DialogHeader>
          {editedData && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-4">
                {/* 主角图片 */}
                <div className="flex-shrink-0">
                  <div
                    className="relative w-40 h-40 sm:w-48 sm:h-48 rounded-lg overflow-hidden border bg-muted group"
                    onPaste={isUploadingImage ? undefined : onImagePaste}
                    tabIndex={0}
                  >
                    {editedData?.thumbnailUrl || editedData?.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- 自 operate.tsx 逐字搬移的存量债务（T7）
                      <img
                        src={(editedData.thumbnailUrl || editedData.imageUrl) ?? undefined}
                        alt={editedData?.name || 'character'}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" className="w-16 h-16 text-muted-foreground">
                          <rect x="4" y="4" width="92" height="92" rx="8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.06" />
                          <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
                            <path d="M10 10 L90 90" opacity="0.12" />
                            <path d="M10 90 L90 10" opacity="0.08" />
                          </g>
                        </svg>
                      </div>
                    )}
                    {isUploadingImage && (
                      <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                        <div className="flex flex-col items-center gap-1 text-white">
                          <Loader2 className="w-6 h-6 animate-spin" />
                          <span className="text-xs">{t("uploading")}</span>
                        </div>
                      </div>
                    )}
                    {!isUploadingImage && isEditing && (
                      <>
                        {/* 更换图片按钮 */}
                        <div className={`absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center ${editMode === 'prompt' ? '!opacity-100' : ''}`}>
                          {editMode === 'prompt' ? (
                            <div className="text-center">
                              <p className="text-xs text-white/80 mb-1">{t("promptSelected")}</p>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  onEditModeChange('image')
                                }}
                              >
                                {t("switchToImage")}
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => imageInputRef.current?.click()}
                            >
                              <Upload className="w-3 h-3 mr-1" />
                              {t("changeImage")}
                            </Button>
                          )}
                        </div>

                        {/* 粘贴提示 */}
                        {editMode !== 'prompt' && (
                          <div className="absolute bottom-2 left-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="bg-black/60 backdrop-blur-sm rounded px-2 py-1">
                              <p className="text-xs text-white/80 text-center">
                                {t("pasteImageHint")}
                              </p>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {isUploadingImage && (
                      <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                        <div className="flex flex-col items-center gap-1 text-white">
                          <Loader2 className="w-6 h-6 animate-spin" />
                          <span className="text-xs">{t("uploading")}</span>
                        </div>
                      </div>
                    )}
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

                {/* 主角信息 */}
                <div className="flex-1 space-y-3">
                  <div>
                    {isEditing ? (
                      <Input
                        value={editedData?.name || ""}
                        disabled
                        className="text-lg font-bold mb-1 bg-muted/50 cursor-not-allowed"
                        placeholder={t("characterNamePlaceholder")}
                      />
                    ) : (
                      <h3 className="text-lg font-bold mb-1">{editedData.name}</h3>
                    )}
                  </div>

                  <div>
                    <p className="text-sm font-medium mb-1">{t("description")}</p>
                    {isEditing ? (
                      <Textarea
                        value={editedData?.description || ""}
                        disabled
                        className="text-sm min-h-[60px] bg-muted/50 cursor-not-allowed"
                        placeholder={t("characterDescriptionPlaceholder")}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">{editedData.description}</p>
                    )}
                  </div>

                  {/* Prompt 输入框 - 只有编辑模式才显示 */}
                  {isEditing && (
                    <div>
                      <p className="text-sm font-medium mb-1">
                        {t("characterPrompt")}
                        {editMode === 'image' && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            ({t("imageSelected")})
                          </span>
                        )}
                      </p>
                      <Textarea
                        value={String(editedData?.generationPrompt ?? editedData?.prompt ?? "")}
                        onChange={(e) => {
                          onEditedDataChange({
                            ...editedData,
                            generationPrompt: e.target.value,
                            prompt: e.target.value
                          })
                          // 用户开始编辑 Prompt 时设置为 prompt 模式
                          if (editMode !== 'image') {
                            onEditModeChange('prompt')
                          }
                        }}
                        disabled={editMode === 'image'}
                        className={`text-sm min-h-[80px] ${editMode === 'image' ? 'bg-muted/30 cursor-not-allowed' : ''}`}
                        placeholder={editMode === 'image' ? t("clearImageToEditPrompt") : (t("characterPromptPlaceholder"))}
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
                      className="w-full sm:flex-1 min-w-0"
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
