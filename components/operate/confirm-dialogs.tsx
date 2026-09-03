"use client"

import { useTranslations } from "next-intl"
import type { CharacterItem, SceneVideoItem, StoryboardItem } from "@/lib/types"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

/**
 * 六个「重新生成 / 保存编辑」确认弹窗（自 operate.tsx 抽出，拆分 T3）。
 * 纯展示组件：变更判定所需的原始数据由父级以 props 传入，判定逻辑与原 IIFE 逐行等价；
 * 确认动作通过 onConfirm 交回父级，关闭一律走 onOpenChange(false)。
 */

function ConfirmButtons({
  onCancel,
  onConfirm,
  confirmLabel,
  mobileStacked = false,
}: {
  onCancel: () => void
  onConfirm?: () => void
  confirmLabel: string
  mobileStacked?: boolean
}) {
  const t = useTranslations("operate")
  const gap = mobileStacked ? "flex flex-col sm:flex-row gap-3 pt-2" : "flex gap-3 pt-2"
  const btn = mobileStacked ? "w-full sm:flex-1" : "flex-1"
  return (
    <div className={gap}>
      <Button variant="outline" onClick={onCancel} className={btn}>
        {t("cancel")}
      </Button>
      {onConfirm ? (
        <Button onClick={onConfirm} className={btn}>
          {confirmLabel}
        </Button>
      ) : (
        <Button variant="outline" disabled className={btn}>
          {t("noChanges")}
        </Button>
      )}
    </div>
  )
}

/** 单个主角重新生成确认弹窗 */
export function RegenerateCharacterConfirmDialog({
  open,
  onOpenChange,
  characterName,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  characterName: string | undefined
  onConfirm: () => void
}) {
  const t = useTranslations("operate")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {t("regenerateCharacter")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <div className="w-12 h-12 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center">
              <span className="text-lg">👤</span>
            </div>
            <div className="flex-1">
              <p className="font-medium">{characterName || t("characterTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("regenerateCharacterDesc")}</p>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-medium text-sm">{t("regenerateWarning")}</h4>
            <ul className="text-sm text-muted-foreground space-y-1 ml-4">
              <li>{t("clearCharacterImage")}</li>
              <li>{t("regenerateCharacterImage")}</li>
              <li>{t("regenerateStoryboardWithCharacter")}</li>
              <li>{t("regenerateSceneVideoWithCharacter")}</li>
              <li>{t("updateFinalVideo")}</li>
            </ul>
          </div>

          <ConfirmButtons
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
            confirmLabel={t("confirmRegenerate")}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 编辑主角保存确认弹窗（图片/Prompt 变更判定逻辑与原实现逐行等价） */
export function SaveEditCharacterConfirmDialog({
  open,
  onOpenChange,
  editedCharacterData,
  characterData,
  hasNewImageFile,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editedCharacterData: CharacterItem | null
  characterData: CharacterItem[]
  hasNewImageFile: boolean
  onConfirm: () => void
}) {
  const t = useTranslations("operate")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {t("saveCharacterEdit")}
          </DialogTitle>
        </DialogHeader>

        {editedCharacterData && characterData && (() => {
          const originalCharacter = characterData.find(char => char.id === editedCharacterData.id)
          const originalImageUrl = originalCharacter ? (originalCharacter.imageUrl ?? originalCharacter.thumbnailUrl ?? '') : ''
          // 检查 URL 是否变化，或者用户是否上传了新图片
          const imageUrlChanged = Boolean(editedCharacterData.imageUrl && editedCharacterData.imageUrl !== originalImageUrl)
          const imageChanged = imageUrlChanged || Boolean(hasNewImageFile)

          // 检查 prompt 是否被修改 - 更宽松的比较
          const originalPrompt = originalCharacter
            ? String(originalCharacter.generationPrompt ?? originalCharacter.prompt ?? originalCharacter.generation_prompt ?? '')
            : ''
          const currentPrompt = String(editedCharacterData.generationPrompt ?? editedCharacterData.prompt ?? '')
          const promptChanged = currentPrompt.trim() !== originalPrompt.trim()

          const hasChanges = imageChanged || promptChanged

          return (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                <div className="w-12 h-12 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center">
                  <span className="text-lg">👤</span>
                </div>
                <div className="flex-1">
                  <p className="font-medium">{editedCharacterData.name}</p>
                  <p className="text-sm text-muted-foreground">{hasChanges ? t("saveCharacterEditDesc") : t("noChanges")}</p>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-medium text-sm">{t("saveCharacterEditWarning")}</h4>
                <ul className="text-sm text-muted-foreground space-y-1 ml-4">
                  {imageChanged && !promptChanged && (
                    <>
                      <li>{t("replaceCharacterImage")}</li>
                      <li>{t("regenerateStoryboardWithCharacter")}</li>
                      <li>{t("regenerateSceneVideoWithCharacter")}</li>
                      <li>{t("updateFinalVideo")}</li>
                    </>
                  )}
                  {promptChanged && !imageChanged && (
                    <>
                      <li>{t("regenerateCharacterWithNewPrompt")}</li>
                      <li>{t("regenerateStoryboardWithCharacter")}</li>
                      <li>{t("regenerateSceneVideoWithCharacter")}</li>
                      <li>{t("updateFinalVideo")}</li>
                    </>
                  )}
                  {imageChanged && promptChanged && (
                    <>
                      <li>{t("replaceCharacterImage")}</li>
                      <li>{t("regenerateStoryboardWithCharacter")}</li>
                      <li>{t("regenerateSceneVideoWithCharacter")}</li>
                      <li>{t("updateFinalVideo")}</li>
                    </>
                  )}
                  {!hasChanges && <li>{t("noChanges")}</li>}
                </ul>
              </div>

              <ConfirmButtons
                onCancel={() => onOpenChange(false)}
                onConfirm={hasChanges ? onConfirm : undefined}
                confirmLabel={t("saveCharacter")}
              />
            </div>
          )
        })()}
      </DialogContent>
    </Dialog>
  )
}

/** 分镜图重新生成确认弹窗 */
export function RegenerateStoryboardConfirmDialog({
  open,
  onOpenChange,
  sceneIndex,
  sceneExists,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sceneIndex: number | null
  sceneExists: boolean
  onConfirm: () => void
}) {
  const t = useTranslations("operate")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {t("regenerateStoryboard")}
          </DialogTitle>
        </DialogHeader>

        {sceneIndex !== null && sceneExists && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <div className="w-12 h-12 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center">
                <span className="text-lg">🎬</span>
              </div>
              <div className="flex-1">
                <p className="font-medium">{t("sceneNumber", { number: sceneIndex + 1 })}</p>
                <p className="text-sm text-muted-foreground">{t("regenerateStoryboardDesc")}</p>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="font-medium text-sm">{t("regenerateWarning")}</h4>
              <ul className="text-sm text-muted-foreground space-y-1 ml-4">
                <li>{t("clearStoryboard")}</li>
                <li>{t("regenerateStoryboardImage")}</li>
                <li>{t("regenerateSceneVideo")}</li>
                <li>{t("updateFinalVideo")}</li>
              </ul>
            </div>

            <ConfirmButtons
              onCancel={() => onOpenChange(false)}
              onConfirm={onConfirm}
              confirmLabel={t("confirmRegenerate")}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** 编辑分镜图保存确认弹窗（图片/Prompt 变更判定逻辑与原实现逐行等价） */
export function SaveEditStoryboardConfirmDialog({
  open,
  onOpenChange,
  editedStoryboardData,
  sceneIndex,
  originalStoryboard,
  hasNewImageFile,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editedStoryboardData: StoryboardItem | null
  sceneIndex: number | null
  originalStoryboard: StoryboardItem | null | undefined
  hasNewImageFile: boolean
  onConfirm: () => void
}) {
  const t = useTranslations("operate")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {t("saveStoryboardEdit")}
          </DialogTitle>
        </DialogHeader>

        {editedStoryboardData && sceneIndex !== null && (() => {
          const originalUrl = originalStoryboard?.url || ''
          // 检查 URL 是否变化，或者用户是否上传了新图片
          const imageUrlChanged = Boolean(editedStoryboardData.url && editedStoryboardData.url !== originalUrl)
          const imageChanged = imageUrlChanged || Boolean(hasNewImageFile)

          // 检查 prompt 是否被修改
          const currentPrompt = editedStoryboardData.prompt || ''
          const originalPrompt = originalStoryboard?.prompt || ''
          const promptChanged = currentPrompt.trim() !== originalPrompt.trim()

          const hasChanges = imageChanged || promptChanged

          return (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                <div className="w-12 h-12 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center">
                  <span className="text-lg">🎬</span>
                </div>
                <div className="flex-1">
                  <p className="font-medium">{t("sceneNumber", { number: sceneIndex + 1 })}</p>
                  <p className="text-sm text-muted-foreground">{hasChanges ? t("saveStoryboardEditDesc") : t("noChanges")}</p>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-medium text-sm">{t("saveStoryboardEditWarning")}</h4>
                <ul className="text-sm text-muted-foreground space-y-1 ml-4">
                  {imageChanged && !promptChanged && (
                    <>
                      <li>{t("replaceStoryboardImage")}</li>
                      <li>{t("regenerateSceneVideo")}</li>
                      <li>{t("updateFinalVideo")}</li>
                    </>
                  )}
                  {promptChanged && !imageChanged && (
                    <>
                      <li>{t("regenerateStoryboardWithNewPrompt")}</li>
                      <li>{t("regenerateSceneVideo")}</li>
                      <li>{t("updateFinalVideo")}</li>
                    </>
                  )}
                  {imageChanged && promptChanged && <li>{t("chooseImageOrPrompt")}</li>}
                  {!hasChanges && <li>{t("noChanges")}</li>}
                </ul>
              </div>

              <ConfirmButtons
                onCancel={() => onOpenChange(false)}
                onConfirm={hasChanges ? onConfirm : undefined}
                confirmLabel={t("confirmSave")}
              />
            </div>
          )
        })()}
      </DialogContent>
    </Dialog>
  )
}

/** 重新生成全部剧情确认弹窗 */
export function RegenerateScriptConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const t = useTranslations("operate")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {t("regenerateAllScript")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <div className="w-12 h-12 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center">
              <span className="text-lg">📄</span>
            </div>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">{t("regenerateAllScriptDesc")}</p>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-medium text-sm">{t("regenerateAllScriptWarning")}</h4>
            <ul className="text-sm text-muted-foreground space-y-1 ml-4">
              <li>{t("clearAllScenes")}</li>
              <li>{t("clearAllCharacters")}</li>
              <li>{t("clearAllStoryboards")}</li>
              <li>{t("clearAllSceneVideos")}</li>
              <li>{t("clearFinalVideo")}</li>
              <li>{t("regenerateWorkflow")}</li>
            </ul>
          </div>

          <ConfirmButtons
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
            confirmLabel={t("confirmRegenerate")}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 剧情视频重新生成确认弹窗（确认键带预计消耗积分，数值由父级按同源口径算好传入） */
export function RegenerateSceneVideoConfirmDialog({
  open,
  onOpenChange,
  sceneIndex,
  sceneExists,
  estimatedPoints,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sceneIndex: number | null
  sceneExists: boolean
  estimatedPoints: number
  onConfirm: () => void
}) {
  const t = useTranslations("operate")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {t("regenerateSceneVideoTitle")}
          </DialogTitle>
        </DialogHeader>

        {sceneIndex !== null && sceneExists && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <div className="w-12 h-12 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center">
                <span className="text-lg">🎥</span>
              </div>
              <div className="flex-1">
                <p className="font-medium">{t("sceneNumber", { number: sceneIndex + 1 })}</p>
                <p className="text-sm text-muted-foreground">{t("regenerateSceneVideoDesc")}</p>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="font-medium text-sm">{t("regenerateWarning")}</h4>
              <ul className="text-sm text-muted-foreground space-y-1 ml-4">
                <li>{t("clearSceneVideo")}</li>
                <li>{t("regenerateVideoSegment")}</li>
                <li>{t("updateFinalVideo")}</li>
              </ul>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={onConfirm}
                className="flex-1"
              >
                {t("confirmRegenerate")} · {t("estimatedPoints", { points: estimatedPoints })}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** 编辑剧情视频保存确认弹窗（Prompt 变更判定逻辑与原实现逐行等价） */
export function SaveEditSceneVideoConfirmDialog({
  open,
  onOpenChange,
  editedSceneVideoData,
  sceneIndex,
  originalSceneVideo,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editedSceneVideoData: SceneVideoItem | null
  sceneIndex: number | null
  originalSceneVideo: SceneVideoItem | null | undefined
  onConfirm: () => void
}) {
  const t = useTranslations("operate")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {t("saveSceneVideoEdit")}
          </DialogTitle>
        </DialogHeader>

        {editedSceneVideoData && sceneIndex !== null && (() => {
          // 更宽松的比较，处理空值和空格
          const currentPrompt = editedSceneVideoData.prompt || ''
          const originalPrompt = originalSceneVideo?.prompt || ''
          const promptChanged = currentPrompt.trim() !== originalPrompt.trim()

          return (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                <div className="w-12 h-12 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center">
                  <span className="text-lg">🎥</span>
                </div>
                <div className="flex-1">
                  <p className="font-medium">{t("sceneNumber", { number: sceneIndex + 1 })}</p>
                  <p className="text-sm text-muted-foreground">{promptChanged ? t("saveSceneVideoEditDesc") : t("noChanges")}</p>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-medium text-sm">{t("saveSceneVideoEditWarning")}</h4>
                <ul className="text-sm text-muted-foreground space-y-1 ml-4">
                  {promptChanged && (
                    <>
                      <li>{t("regenerateSceneVideoFromEdit")}</li>
                      <li>{t("updateFinalVideo")}</li>
                    </>
                  )}
                  {!promptChanged && <li>{t("noChanges")}</li>}
                </ul>
              </div>

              <ConfirmButtons
                mobileStacked
                onCancel={() => onOpenChange(false)}
                onConfirm={promptChanged ? onConfirm : undefined}
                confirmLabel={t("confirmSave")}
              />
            </div>
          )
        })()}
      </DialogContent>
    </Dialog>
  )
}
