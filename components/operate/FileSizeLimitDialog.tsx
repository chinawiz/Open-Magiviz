"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sparkles } from "lucide-react"
import { useTranslations } from "next-intl"

interface FileSizeLimitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 文件大小限制（MB），用于展示提示文案 */
  limitMB: number
  /** 点击"升级"时触发；由父组件负责关闭弹窗并打开订阅入口 */
  onUpgrade: () => void
}

/**
 * 文件大小超限提示弹窗。
 * 从 components/operate.tsx 拆出（S1），props 驱动、无内部状态，行为与原来一致。
 */
export function FileSizeLimitDialog({ open, onOpenChange, limitMB, onUpgrade }: FileSizeLimitDialogProps) {
  const t = useTranslations("operate")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <div className="p-2">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-lg font-semibold">
                  {t("fileTooLarge")}
                </DialogTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("fileSizeLimitDesc", { limit: limitMB })}
                </p>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="px-6 pb-6">
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              autoFocus
              onClick={onUpgrade}
              className="px-6 flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              {t("upgrade")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="px-4"
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
