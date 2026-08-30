"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { Stars, CheckCircle2, Lock, CreditCard, Loader2 } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { Button } from "@/components/ui/button"
import { StripeCheckoutButton } from "./stripe-checkout-button"
import { SUBSCRIPTION_PRICE_IDS } from "@/lib/stripe"
import { useTranslations, useLocale } from "next-intl"
import { toast } from "sonner"

/**
 * 定价区（2026-08-30 重构，docs/pricing-redesign-2026-08.md）：
 * 顶部 Free 横条（注册送 6 点三步体验 + 验卡解锁一部成片）+ Starter/Annual/Pro 三卡。
 * 旧 Trial 档已从 checkout 下架（老订阅续费由 webhook legacy 映射继续支持）。
 */

const CARD_VERIFICATION_GIFT_POINTS = 48

export function PricingSection() {
  const { data: session } = useSession()
  const t = useTranslations("pricing")
  const locale = useLocale()
  const reduceMotion = useReducedMotion()
  const reveal = (delay = 0) =>
    reduceMotion
      ? {}
      : { initial: { opacity: 0, y: 20 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true }, transition: { delay } }

  const [hasActiveStarterSubscription, setHasActiveStarterSubscription] = useState(false)
  const [hasActiveProSubscription, setHasActiveProSubscription] = useState(false)
  const [hasActiveAnnualSubscription, setHasActiveAnnualSubscription] = useState(false)
  const [currentSubscriptionPlan, setCurrentSubscriptionPlan] = useState<string | null>(null)
  const [cardVerified, setCardVerified] = useState(false)
  const [isVerifyingCard, setIsVerifyingCard] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchSubscriptionStatus = async () => {
      if (!session?.user) {
        setLoading(false)
        return
      }

      try {
        const response = await fetch("/api/user/subscription")
        if (response.ok) {
          const data = await response.json()
          setCurrentSubscriptionPlan(data.subscriptionPlan || null)
          setCardVerified(!!data.cardVerified)

          const now = new Date()
          const isActive = (plan: string) =>
            data.subscriptionStatus === "active" &&
            data.subscriptionPlan === plan &&
            data.subscriptionCurrentPeriodEnd &&
            new Date(data.subscriptionCurrentPeriodEnd) > now

          setHasActiveStarterSubscription(isActive("starter"))
          setHasActiveProSubscription(isActive("pro"))
          setHasActiveAnnualSubscription(isActive("annual"))
        }
      } catch (error) {
        console.error("获取订阅状态失败:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchSubscriptionStatus()
  }, [session])

  const handleVerifyCard = async () => {
    setIsVerifyingCard(true)
    try {
      const res = await fetch("/api/stripe/verify-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      })
      const data = await res.json()
      if (res.ok && data.url) {
        window.location.href = data.url
        return
      }
      if (data.alreadyVerified) {
        setCardVerified(true)
      } else {
        toast.error(data.error || t("freeBanner.verifyFailed"))
      }
    } catch {
      toast.error(t("freeBanner.verifyFailed"))
    } finally {
      setIsVerifyingCard(false)
    }
  }

  const plans = [
    {
      name: t("starter.name"),
      price: t("starter.price"),
      period: t("starter.period"),
      description: t("starter.description"),
      features: [
        t("starter.features.period"),
        t("starter.features.points"),
        t("starter.features.shorts"),
        t("starter.features.upload_size"),
        t("starter.features.storage"),
        t("starter.features.license"),
      ],
      cta: t("starter.cta"),
      offer: t("starter.offer"),
      featured: false,
      priceId: SUBSCRIPTION_PRICE_IDS.starter,
      planType: "starter",
    },
    {
      name: t("annual.name"),
      price: t("annual.price"),
      period: t("annual.period"),
      originalPrice: t("annual.originalPrice"),
      savings: t("annual.savings"),
      description: t("annual.description"),
      features: [
        t("annual.features.period"),
        t("annual.features.points"),
        t("annual.features.shorts"),
        t("annual.features.upload_size"),
        t("annual.features.storage"),
        t("annual.features.license"),
      ],
      cta: t("annual.cta"),
      offer: t("annual.offer"),
      featured: true,
      badge: t("annual.badge"),
      priceId: SUBSCRIPTION_PRICE_IDS.annual,
      planType: "annual",
    },
    {
      name: t("pro.name"),
      price: t("pro.price"),
      period: t("pro.period"),
      description: t("pro.description"),
      features: [
        t("pro.features.period"),
        t("pro.features.points"),
        t("pro.features.shorts"),
        t("pro.features.upload_size"),
        t("pro.features.storage"),
        t("pro.features.license"),
      ],
      cta: t("pro.cta"),
      offer: t("pro.offer"),
      featured: false,
      priceId: SUBSCRIPTION_PRICE_IDS.pro,
      planType: "pro",
    },
  ]

  const renderPlanButton = (plan: (typeof plans)[number]) => {
    if (plan.planType === "starter") {
      if (hasActiveStarterSubscription) {
        return (
          <Button className="w-full" variant="outline" disabled>
            {t("starter.currentPlan")}
          </Button>
        )
      }
      return (
        <StripeCheckoutButton
          priceId={plan.priceId}
          planType={plan.planType}
          className="w-full py-3 rounded-lg font-headline font-bold transition-all border border-primary text-peach-800 hover:bg-primary hover:text-primary-foreground"
          variant="outline"
        >
          {plan.cta}
        </StripeCheckoutButton>
      )
    }

    if (plan.planType === "pro") {
      if (hasActiveProSubscription) {
        return (
          <StripeCheckoutButton
            priceId={plan.priceId}
            planType={plan.planType}
            className="w-full py-3 rounded-lg font-headline font-bold transition-all border border-primary text-peach-800 hover:bg-primary hover:text-primary-foreground"
            variant="outline"
          >
            {t("pro.renew")}
          </StripeCheckoutButton>
        )
      }
      if (hasActiveAnnualSubscription) {
        return (
          <Button className="w-full" variant="outline" disabled>
            {t("annual.cannot_downgrade")}
          </Button>
        )
      }
    }

    if (plan.planType === "annual" && hasActiveAnnualSubscription) {
      return (
        <StripeCheckoutButton
          priceId={plan.priceId}
          planType={plan.planType}
          className="w-full py-3 rounded-lg font-headline font-bold transition-all bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:scale-[1.02]"
          variant="default"
        >
          {t("annual.renew")}
        </StripeCheckoutButton>
      )
    }

    // 常规购买（Pro 无订阅 / Annual 无年订； starter 已在上面处理）
    const ctaLabel =
      plan.planType === "annual" && (currentSubscriptionPlan === "starter" || currentSubscriptionPlan === "trial" || currentSubscriptionPlan === "pro")
        ? t("annual.upgrade")
        : plan.cta
    return (
      <StripeCheckoutButton
        priceId={plan.priceId}
        planType={plan.planType}
        className={`w-full py-3 rounded-lg font-headline font-bold transition-all ${
          plan.featured
            ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:scale-[1.02]"
            : "border border-primary text-peach-800 hover:bg-primary hover:text-primary-foreground"
        }`}
        variant={plan.featured ? "default" : "outline"}
      >
        {ctaLabel}
      </StripeCheckoutButton>
    )
  }

  return (
    <section className="py-24 bg-background" id="pricing">
      <div className="max-w-7xl mx-auto px-8">
        <div className="text-center mb-12 space-y-4">
          <motion.h2 {...reveal()} className="font-headline text-4xl font-black tracking-tight text-foreground">
            {t("heading")}
          </motion.h2>
          <motion.p {...reveal(0.1)} className="text-muted-foreground">
            {t("subheading")}
          </motion.p>
        </div>

        {/* Free 横条：注册送 6 点三步体验 + 验卡解锁一部成片 */}
        <motion.div
          {...reveal(0.15)}
          className="mb-12 rounded-xl border border-primary/30 bg-primary/5 p-6 md:p-8"
        >
          <div className="flex flex-col lg:flex-row lg:items-center gap-6">
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold">
                  <Stars className="w-3.5 h-3.5" />
                  {t("freeBanner.badge")}
                </span>
                <h3 className="font-headline text-lg font-bold text-foreground">{t("freeBanner.title")}</h3>
              </div>
              <p className="text-sm text-muted-foreground">{t("freeBanner.description")}</p>
              <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-success shrink-0" aria-hidden="true" />
                  {t("freeBanner.stepScript")}
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-success shrink-0" aria-hidden="true" />
                  {t("freeBanner.stepCharacter")}
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-success shrink-0" aria-hidden="true" />
                  {t("freeBanner.stepStoryboard")}
                </li>
                <li className="flex items-center gap-1.5 text-muted-foreground">
                  <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {t("freeBanner.lockedSteps")}
                </li>
              </ul>
            </div>

            <div className="flex flex-col sm:flex-row lg:flex-col gap-3 lg:w-64 shrink-0">
              {!session ? (
                <Button asChild className="flex-1">
                  <a href={`/${locale}/auth/signup`}>{t("freeBanner.signupCta")}</a>
                </Button>
              ) : cardVerified ? (
                <Button variant="outline" disabled className="flex-1">
                  <CheckCircle2 className="w-4 h-4 mr-2" aria-hidden="true" />
                  {t("freeBanner.verifiedNote")}
                </Button>
              ) : (
                <Button onClick={handleVerifyCard} disabled={isVerifyingCard} className="flex-1">
                  {isVerifyingCard ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                  ) : (
                    <CreditCard className="w-4 h-4 mr-2" aria-hidden="true" />
                  )}
                  {t("freeBanner.verifyCta")}
                </Button>
              )}
              <p className="text-xs text-muted-foreground lg:text-center">
                {session && !cardVerified ? t("freeBanner.verifyNote") : t("freeBanner.note")}
              </p>
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-center">
          {plans.map((plan, i) => (
            <motion.div
              key={plan.name}
              {...(reduceMotion ? {} : { initial: { opacity: 0, y: 30 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true }, transition: { delay: i * 0.1 } })}
              className={`bg-card rounded-xl p-8 flex flex-col border shadow-sm transition-all duration-300 relative ${
                plan.featured
                  ? "border-primary shadow-2xl scale-105 z-10"
                  : "border-border hover:shadow-md"
              }`}
            >
              {plan.badge && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-primary text-primary-foreground px-4 py-1 rounded-full text-xs font-black tracking-widest uppercase font-headline whitespace-nowrap">
                  {plan.badge}
                </div>
              )}
              <div className="mb-8">
                <h3 className="font-headline text-xl font-bold mb-2">{plan.name}</h3>
                <div className="space-y-1">
                  {plan.originalPrice && plan.originalPrice !== "" && (
                    <div className="flex items-center gap-2">
                      <span className="inline-block px-2 py-0.5 bg-destructive/10 text-destructive text-xs font-bold rounded">
                        {plan.savings}
                      </span>
                      <span className="text-muted-foreground text-sm line-through">
                        {plan.originalPrice}{plan.period}
                      </span>
                    </div>
                  )}
                  <div className="flex items-baseline gap-1">
                    <span
                      className={`font-black text-foreground ${
                        plan.featured ? "text-5xl" : "text-4xl"
                      }`}
                    >
                      {plan.price}
                    </span>
                    <span className="text-muted-foreground text-sm font-bold">
                      {plan.period}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-4 leading-relaxed">
                  {plan.description}
                </p>
              </div>

              <ul className="space-y-4 mb-8 flex-grow">
                <li
                  className={`flex items-center gap-3 text-xs font-bold px-3 py-2 rounded-lg ${
                    plan.featured
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-primary/10 text-peach-800"
                  }`}
                >
                  <Stars className="w-4 h-4 shrink-0" />
                  <span>{plan.offer}</span>
                </li>
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-sm">
                    <CheckCircle2 className="text-primary w-5 h-5 shrink-0" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              {renderPlanButton(plan)}
            </motion.div>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-8">
          {t("freeBanner.pointsNote", { points: CARD_VERIFICATION_GIFT_POINTS })}
        </p>
      </div>
    </section>
  )
}
