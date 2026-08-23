"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertTriangle } from "lucide-react"
import { useTranslations } from "next-intl"

interface MediaValidationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 具体校验失败信息（父组件负责在关闭时清空） */
  message: string
}

/**
 * 媒体文件不符合 Seedance 模型约束时的提示弹窗。
 * 从 components/operate.tsx 拆出（S1），props 驱动、无内部状态，行为与原来一致。
 */
export function MediaValidationDialog({ open, onOpenChange, message }: MediaValidationDialogProps) {
  const t = useTranslations("operate")

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="sm:max-w-md">
        <div className="p-2">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 flex items-center justify-center bg-amber-500/10 rounded-full">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <DialogTitle className="text-lg font-semibold">
                  {t("mediaValidationDialogTitle") || "媒体文件不符合要求"}
                </DialogTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("mediaValidationDialogDesc") ||
                    "上传的视频/音频文件不满足 Seedance 2.0 模型约束，请调整后重新发送。"}
                </p>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="px-6 py-4">
          <div className="bg-muted/50 rounded-lg p-3 text-sm leading-relaxed break-words whitespace-pre-wrap max-h-60 overflow-auto">
            {message}
          </div>
          <div className="mt-3 text-xs text-muted-foreground space-y-1">
            <p>{t("mediaValidationDialogVideoRulesTitle") || "视频要求："}</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>{t("mediaValidationDialogVideoRuleFormat") || "格式：mp4 / mov，单个不超过 50 MB"}</li>
              <li>{t("mediaValidationDialogVideoRuleCount") || "最多 3 个，总时长 ≤ 15 s"}</li>
              <li>{t("mediaValidationDialogVideoRuleDuration") || "单个时长 2 – 15 s"}</li>
              <li>{t("mediaValidationDialogVideoRuleRatio") || "宽高比 (W/H)：0.4 – 2.5"}</li>
              <li>{t("mediaValidationDialogVideoRulePixels") || "宽高 300 – 6000 px，总像素 409600 – 927408"}</li>
              <li>{t("mediaValidationDialogVideoRuleFps") || "帧率 24 – 60 FPS"}</li>
            </ul>
            <p className="mt-2">{t("mediaValidationDialogAudioRulesTitle") || "音频要求："}</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>{t("mediaValidationDialogAudioRuleFormat") || "格式：wav / mp3，单个不超过 15 MB"}</li>
              <li>{t("mediaValidationDialogAudioRuleCount") || "最多 3 段，总时长 ≤ 15 s"}</li>
              <li>{t("mediaValidationDialogAudioRuleDuration") || "单个时长 2 – 15 s"}</li>
            </ul>
          </div>
        </div>

        <div className="px-6 pb-6">
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              autoFocus
              onClick={() => onOpenChange(false)}
              className="px-6"
            >
              {t("gotIt") || t("ok") || "我知道了"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
