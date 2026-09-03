"use client"

import { useTranslations } from "next-intl"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { SceneVideoItem, ScriptData } from "@/lib/types"

/**
 * 剧情视频详情预览/编辑弹窗（自 operate.tsx 内联 JSX 抽出，拆分 T9，
 * 与 Character/StoryboardDetailDialog 同构）。
 * JSX 逐字搬移;编辑态与取消/保存/关闭动作由调用方注入,
 * 关闭时的编辑态重置副作用留在调用方（与其余详情弹窗一致）。
 */
export function SceneVideoDetailDialog({
  open,
  onOpenChange,
  onClose,
  isEditing,
  editingIndex,
  editedData,
  sceneVideos,
  aspectRatio,
  scriptData,
  onEditedDataChange,
  onCancelEdit,
  onShowSaveEditDialog,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onClose: () => void
  isEditing: boolean
  editingIndex: number | null
  editedData: SceneVideoItem | null
  sceneVideos: SceneVideoItem[]
  aspectRatio: string
  scriptData: ScriptData | null
  onEditedDataChange: (data: SceneVideoItem | null) => void
  onCancelEdit: () => void
  onShowSaveEditDialog: () => void
}) {
  const t = useTranslations("operate")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-full max-w-4xl max-h-[80vh] overflow-y-auto p-4">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              {isEditing ? t("editSceneVideo") : t("sceneVideoDetails")}
            </DialogTitle>
          </DialogHeader>
          {(isEditing ? editedData : (editingIndex !== null ? sceneVideos[editingIndex] : null)) && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-4">
                {/* 场景视频 */}
                <div className="flex-1">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">{t("sceneVideo")}</div>
                    {(() => {
                      const originalVideo = sceneVideos[editingIndex!]
                      const editedVideo = editedData
                      const videoUrl = isEditing ? (originalVideo?.videoUrl || editedVideo?.videoUrl) : originalVideo?.videoUrl
                      const thumbnailUrl = isEditing ? (originalVideo?.thumbnailUrl || editedVideo?.thumbnailUrl) : originalVideo?.thumbnailUrl

                      return videoUrl ? (
                        <video
                          src={videoUrl}
                          controls
                          className="w-full rounded-lg"
                          poster={thumbnailUrl}
                        />
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
                  </div>
                </div>

                {/* 场景信息 */}
                <div className="w-full sm:w-80 space-y-4">
                  {(() => {
                    const originalData = sceneVideos[editingIndex!]
                    const sceneIndex = originalData?.sceneIndex ?? editingIndex
                    return (
                      <div>
                        <div>
                          <div className="text-sm font-medium mb-2">{t("sceneInfo")}</div>
                          <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">{t("sceneNumberLabel")}</span>
                              <span className="text-sm font-medium">
                                {t("sceneNumber", { number: (sceneIndex ?? 0) + 1 })}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">{t("durationLabel2")}</span>
                              <span className="text-sm font-medium">
                                {originalData?.duration}{t("seconds")}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">{t("aspectRatioLabel3")}</span>
                              <span className="text-sm font-medium">
                                {String(originalData?.aspectRatio ?? aspectRatio ?? '')}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* 剧情描述 */}
                        {Boolean(scriptData?.scenes?.[sceneIndex ?? 0]) && (
                          <div>
                            <div className="text-sm font-medium mb-2">{t("sceneDescriptionLabel")}</div>
                            <div className="p-3 rounded-lg bg-muted/50">
                              <p className="text-sm text-muted-foreground">
                                {String(scriptData?.scenes?.[sceneIndex ?? 0]?.plot ?? '')}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* 场景旁白 */}
                        {Boolean(scriptData?.scenes?.[sceneIndex ?? 0]?.narration) && (
                          <div>
                            <div className="text-sm font-medium mb-2">{t("sceneNarration")}</div>
                            <div className="p-3 rounded-lg bg-muted/50">
                              <p className="text-sm text-muted-foreground italic">
                                &quot;{String(scriptData?.scenes?.[sceneIndex ?? 0]?.narration ?? '')}&quot;
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              </div>

              {/* 编辑区域 */}
              {isEditing && (
                <div className="pt-4 border-t border-border">
                  {/* 提示词输入 */}
                  <div>
                    <div className="text-sm font-medium mb-2">{t("prompt")}</div>
                    <Textarea
                      value={editedData?.prompt || ''}
                      onChange={(e) => onEditedDataChange({
                        ...editedData,
                        prompt: e.target.value
                      })}
                      placeholder={t("promptPlaceholder")}
                      className="min-h-[80px] resize-none"
                    />
                  </div>
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex gap-2 pt-4 border-t border-border">
                {isEditing ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={onCancelEdit}
                      className="flex-1"
                    >
                      {t("cancel")}
                    </Button>
                    <Button
                      onClick={onShowSaveEditDialog}
                      className="flex-1"
                    >
                      {t("saveChanges")}
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={onClose}
                    className="flex-1"
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
