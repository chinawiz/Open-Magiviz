import { FolderOpen } from "lucide-react"
import { useTranslations } from "next-intl"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { LibrarySelectorContent } from "@/components/library-selector"

/**
 * 素材库选择弹窗（自 operate.tsx 抽出，拆分 T3）。
 * 纯展示壳：选择结果通过 onSelect 交回父级处理（父级负责消费 URL 并关闭弹窗）。
 */
export function LibraryDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (url: string) => void
}) {
  const t = useTranslations("operate")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <FolderOpen className="w-5 h-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold">{t("selectFromLibrary")}</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">{t("selectFromLibraryDesc")}</p>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 pb-6 flex-1 overflow-y-auto min-h-0">
          <LibrarySelectorContent onSelect={onSelect} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
