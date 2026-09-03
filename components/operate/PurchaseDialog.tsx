"use client"

import { useState } from "react"
import { Sparkles, CreditCard } from "lucide-react"
import { useTranslations, useLocale } from "next-intl"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"

/**
 * 积分不足/订阅不足/免费用户视频能力锁 三合一购买弹窗（自 operate.tsx 抽出，拆分 T4）。
 * 验卡流程自包含（fetch + toast + locale）；升级动作通过 onUpgrade 交回父级
 * （父级负责关闭并触发页内的订阅弹窗 trigger）。
 */
export function PurchaseDialog({
  open,
  onOpenChange,
  dialogType,
  currentPoints,
  onUpgrade,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  dialogType: 'points' | 'subscription' | 'card_verify'
  currentPoints: number
  onUpgrade: () => void
}) {
  const t = useTranslations("operate")
  const locale = useLocale()
  const { toast } = useToast()
  const [isVerifyingCard, setIsVerifyingCard] = useState(false)

  const handleVerifyCard = async () => {
    setIsVerifyingCard(true)
    try {
      const res = await fetch('/api/stripe/verify-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale }),
      })
      const data = await res.json()
      if (res.ok && data.url) {
        window.location.href = data.url
        return
      }
      toast({
        title: data.alreadyVerified ? t('cardAlreadyVerified') : t('cardVerifyFailed'),
        description: data.alreadyVerified ? undefined : data.error,
      })
      if (data.alreadyVerified) onOpenChange(false)
    } catch {
      toast({ title: t('cardVerifyFailed') })
    } finally {
      setIsVerifyingCard(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
        <div className="p-6 pb-4">
          <DialogHeader className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-lg font-semibold">
                  {dialogType === 'points'
                    ? t("pointsInsufficient")
                    : dialogType === 'card_verify'
                      ? t("videoLockedTitle")
                      : t("upgradeTitle")}
                </DialogTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {dialogType === 'points'
                    ? t("pointsInsufficientDesc", { points: currentPoints })
                    : dialogType === 'card_verify'
                      ? t("videoLockedDesc")
                      : t("subscriptionDialogMessage")
                  }
                </p>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="px-6 pb-6">
          <div className="space-y-4">
            <div className="flex items-center justify-end gap-3 pt-2 flex-wrap">
              {dialogType === 'card_verify' && (
                <Button
                  variant="outline"
                  autoFocus
                  disabled={isVerifyingCard}
                  onClick={handleVerifyCard}
                  className="px-4 flex items-center gap-2"
                >
                  <CreditCard className="w-4 h-4" />
                  {t('verifyCardCta')}
                </Button>
              )}
              <Button
                autoFocus={dialogType !== 'card_verify'}
                onClick={onUpgrade}
                className="px-6 flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                {dialogType === 'card_verify' ? t('upgradeCtaShort') : t("upgrade")}
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
