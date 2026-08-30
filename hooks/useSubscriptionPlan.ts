"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"

/**
 * 订阅计划状态 hook。
 * 从 components/operate.tsx 拆出（S1），行为与原来一致：
 * 登录后拉取 /api/user/subscription，未登录时置空。
 */
export function useSubscriptionPlan() {
  const { data: session, status } = useSession()
  const [subscriptionPlan, setSubscriptionPlan] = useState<string | null>(null)
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null)
  const [cardVerified, setCardVerified] = useState(false)
  const [isLoadingSubscription, setIsLoadingSubscription] = useState(false)

  // 获取订阅信息
  useEffect(() => {
    const fetchSubscription = async () => {
      if (status !== "authenticated" || !session?.user?.id) {
        setSubscriptionPlan(null)
        setSubscriptionStatus(null)
        setCardVerified(false)
        return
      }
      try {
        setIsLoadingSubscription(true)
        const response = await fetch('/api/user/subscription')
        if (response.ok) {
          const data = await response.json()
          setSubscriptionPlan(data.subscriptionPlan || null)
          setSubscriptionStatus(data.subscriptionStatus || null)
          setCardVerified(!!data.cardVerified)
        }
      } catch (error) {
        console.error('Failed to fetch subscription:', error)
      } finally {
        setIsLoadingSubscription(false)
      }
    }
    fetchSubscription()
  }, [status, session?.user?.id])

  return { subscriptionPlan, subscriptionStatus, cardVerified, isLoadingSubscription }
}
