"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Link } from "lucide-react"
import { useTranslations } from "next-intl"
import type { KeyboardEvent } from "react"

interface LinkInputDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 受控输入值 */
  value: string
  onValueChange: (value: string) => void
  /** 确认添加链接；由父组件负责校验、入库并关闭弹窗 */
  onAdd: () => void
  /** 取消；由父组件负责关闭弹窗并清空输入 */
  onCancel: () => void
}

/**
 * 链接输入弹窗（把 URL 加入输入区图片列表）。
 * 从 components/operate.tsx 拆出（S1），props 驱动、无内部状态，行为与原来一致（Enter 确认）。
 */
export function LinkInputDialog({ open, onOpenChange, value, onValueChange, onAdd, onCancel }: LinkInputDialogProps) {
  const t = useTranslations("operate")

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      onAdd()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
        <div className="p-6 pb-4">
          <DialogHeader className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Link className="w-5 h-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-lg font-semibold">{t("addLinkTitle")}</DialogTitle>
                <p className="text-sm text-muted-foreground mt-1">{t("addLinkDesc")}</p>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="px-6 pb-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("linkLabel")}</label>
              <Input
                placeholder={t("linkPlaceholder")}
                value={value}
                onChange={(e) => onValueChange(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-11"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={onCancel}
                className="px-4"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={onAdd}
                disabled={!value.trim()}
                className="px-6"
              >
                <Link className="w-4 h-4 mr-2" />
                {t("addLink")}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
