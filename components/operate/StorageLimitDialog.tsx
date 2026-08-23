"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { HardDrive, Sparkles } from "lucide-react"
import { useTranslations } from "next-intl"
import { formatBytes } from "./format"

export interface StorageLimitInfo {
  usedStorage: number
  storageLimit: number
  availableStorage: number
}

interface StorageLimitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 存储用量信息；为 null 时显示占位 "..." 与 0 进度 */
  info: StorageLimitInfo | null
  /** 点击"升级"时触发；由父组件负责关闭弹窗并打开订阅入口 */
  onUpgrade: () => void
}

/**
 * 存储空间超限提示弹窗。
 * 从 components/operate.tsx 拆出（S1），props 驱动、无内部状态，行为与原来一致。
 */
export function StorageLimitDialog({ open, onOpenChange, info, onUpgrade }: StorageLimitDialogProps) {
  const t = useTranslations("operate")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <div className="p-2">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 flex items-center justify-center bg-muted rounded-full">
                <HardDrive className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <DialogTitle className="text-lg font-semibold">
                  {t("storageLimitReached") || "存储空间已满"}
                </DialogTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("storageLimitDesc") || "您的存储空间已用完，请升级套餐或清理文件"}
                </p>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="px-6 py-4">
          <div className="bg-muted/50 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("storageUsed") || "已使用"}</span>
              <span className="font-medium">
                {info ? `${formatBytes(info.usedStorage)} / ${formatBytes(info.storageLimit)}` : '...'}
              </span>
            </div>
            <Progress
              value={info && info.storageLimit > 0 ? (info.usedStorage / info.storageLimit) * 100 : 0}
              className="h-2"
            />
          </div>
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
