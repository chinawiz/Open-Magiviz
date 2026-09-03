"use client"

import { useTranslations } from "next-intl"
import { Clock, Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { ScriptData, StoryScene } from "@/lib/types"

/**
 * 剧情详情预览弹窗（自 operate.tsx 抽出，拆分 T6）。
 * 编辑功能已禁用（原有注释块随 JSX 逐字保留），仅预览 + 关闭。
 */
export function ScriptDetailDialog({
  open,
  onOpenChange,
  onClose,
  scriptData,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onClose: () => void
  scriptData: ScriptData | null
}) {
  const t = useTranslations("operate")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              {t("scriptDetails")}
            </DialogTitle>
          </DialogHeader>
          {scriptData && (
            <div className="space-y-4">
              {/* 标题和基本信息 */}
              <div>
                <h3 className="text-lg font-bold mb-2">{scriptData.title}</h3>
                <div className="flex gap-4 text-sm text-muted-foreground items-center whitespace-nowrap">
                  <span>{t("durationLabel")} {scriptData.totalDuration}{t("seconds")}</span>
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    {t("aspectRatioLabel")}
                    <span>{scriptData.aspectRatio}</span>
                  </span>
                  <span>{t("sceneCount")} {scriptData.scenes?.length || 0}</span>
                </div>
              </div>

              {/* 剧情场景列表 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold">{t("sceneList")}</h4>
                  {/* 编辑功能已禁用：添加场景按钮 */}
                  {/* {isEditingScript && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleAddScene}
                      disabled={isGeneratingScenePlot}
                    >
                      {isGeneratingScenePlot ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <Plus className="w-3 h-3 mr-1" />
                      )}
                      {isGeneratingScenePlot ? t("generating") : t("addScene")}
                    </Button>
                  )} */}
                </div>

                {scriptData.scenes?.map((scene: StoryScene) => (
                  <div key={scene.id} className={`p-4 rounded-lg border space-y-2 ${scene.isGenerating ? 'bg-muted/30 border-dashed animate-pulse' : 'bg-muted/50 border-border'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 rounded bg-primary/10 text-primary text-xs font-mono">
                          {scene.isGenerating ? (
                            <span className="flex items-center gap-1">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              {t("generating")}
                            </span>
                          ) : (
                            t("sceneNumber", { number: scene.id as string })
                          )}
                        </span>
                        {/* 编辑功能已禁用：场景时长编辑 */}
                        {/* {isEditingScript && !scene.isGenerating ? (
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              value={scene.duration}
                              onChange={(e) => handleUpdateScene(scene.id, 'duration', parseInt(e.target.value) || 5)}
                              className="w-16 h-7 text-xs text-center"
                              min="5"
                              max="8"
                            />
                            <span className="text-xs text-muted-foreground flex items-center h-7">{t("seconds")}</span>
                          </div>
                        ) : ( */}
                          <span className="text-xs text-muted-foreground">
                            <Clock className="w-3 h-3 inline mr-1" />
                            {scene.duration}{t("seconds")}
                          </span>
                        {/* )} */}
                      </div>
                      {/* 编辑功能已禁用：删除场景按钮 */}
                      {/* {isEditingScript && !scene.isGenerating && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteScene(scene.id)}
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )} */}
                    </div>

                    {/* 剧情描述 */}
                    {scene.plot && (
                      <div>
                        <p className="text-sm font-medium mb-1">{t("sceneDescription")}</p>
                        {/* 编辑功能已禁用：场景描述编辑 */}
                        {/* {isEditingScript ? (
                          <Textarea
                            value={scene.plot}
                            onChange={(e) => handleUpdateScene(scene.id, 'plot', e.target.value)}
                            className="text-sm min-h-[60px]"
                            placeholder={t("sceneDescriptionPlaceholder")}
                          />
                        ) : ( */}
                          <div className="p-3 rounded-lg bg-blue-50/50 border border-blue-200/50">
                            <p className="text-sm text-blue-900 leading-relaxed">{scene.plot}</p>
                          </div>
                        {/* )} */}
                      </div>
                    )}

                  </div>
                ))}
              </div>

              {/* 操作按钮 */}
              <div className="flex gap-2 pt-4 border-t border-border">
                {/* 编辑功能已禁用：保存/取消按钮 */}
                {/* {isEditingScript ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={handleCancelEditScript}
                      className="flex-1"
                    >
                      {t("cancel")}
                    </Button>
                    <Button
                      onClick={handleSaveEditedScript}
                      className="flex-1"
                    >
                      {t("saveChanges")}
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={() => onClose()}
                    className="flex-1"
                  >
                    {t("close")}
                  </Button>
                )} */}
                <Button
                  onClick={() => onClose()}
                  className="flex-1"
                >
                  {t("close")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
  )
}
