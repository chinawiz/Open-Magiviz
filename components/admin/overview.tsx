"use client"

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Users,
  UserPlus,
  Award,
  CreditCard,
  Wallet,
  DollarSign,
  Coins,
  TrendingUp,
  ShieldAlert,
  Loader2
} from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'

interface OverviewStats {
  totalUsers: number
  subscribedUsers: number
  subscriptionRevenue: number
  pointsPurchaseRevenue: number
  totalPoints: number
  totalReferrals: number
  referralSubscribedCount: number
  referralRewardPoints: number
  affiliateCount: number
  affiliateTotalEarnings: number
  affiliateTotalWithdrawals: number
  newsletterSubscribers: number
}

interface TrendsData {
  registrationTrends: Array<{ date: string; count: number }>
  subscriptionTrends: Array<{ date: string; count: number; revenue: number }>
  revenueTrends: Array<{ date: string; revenue: number }>
}

// 防薅两指标（docs/pricing-redesign-2026-08.md §4.6 承诺）
interface AntifraudData {
  totalUsers: number
  convertedUsers: number // 有至少一次成功生成事件的去重用户数
  topSignupIps: Array<{ ip: string; count: number; cardVerified: number }>
}

export function AdminOverview() {
  const t = useTranslations('admin.dashboard')
  const locale = useLocale()
  const [stats, setStats] = useState<OverviewStats | null>(null)
  const [trends, setTrends] = useState<TrendsData | null>(null)
  const [antifraud, setAntifraud] = useState<AntifraudData | null>(null)
  const [loading, setLoading] = useState(true)
  const [trendsLoading, setTrendsLoading] = useState(true)
  const [days, setDays] = useState(30)

  useEffect(() => {
    fetchStats()
    fetchAntifraud()
  }, [])

  // days 变化时刷新趋势；首次挂载由本 effect 触发（原来两个 effect 各跑一次）
  useEffect(() => {
    fetchTrends()
  }, [days])

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/admin/statistics?type=overview')
      if (response.ok) {
        const data = await response.json()
        setStats(data)
      }
    } catch (error) {
      console.error('获取统计数据失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchTrends = async () => {
    setTrendsLoading(true)
    try {
      const response = await fetch(`/api/admin/statistics?type=trends&days=${days}`)
      if (response.ok) {
        const data = await response.json()
        setTrends(data)
      }
    } catch (error) {
      console.error('获取趋势数据失败:', error)
    } finally {
      setTrendsLoading(false)
    }
  }

  const fetchAntifraud = async () => {
    try {
      const response = await fetch('/api/admin/statistics?type=antifraud')
      if (response.ok) {
        const data = await response.json()
        setAntifraud(data)
      }
    } catch (error) {
      console.error('获取防薅指标失败:', error)
    }
  }

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const formatNumber = (num: number) => {
    return num.toLocaleString('en-US')
  }

  // 格式化日期显示（根据语言显示中文或英文日期）
  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr)
      if (locale === 'zh') {
        // 中文格式：1月1日
        return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
      } else {
        // 英文格式：Jan 1
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      }
    } catch {
      return dateStr
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const conversionRate = antifraud && antifraud.totalUsers > 0
    ? ((antifraud.convertedUsers / antifraud.totalUsers) * 100).toFixed(1)
    : null

  return (
    <div className="space-y-6">
      {/* 统计卡片 - 分类展示 */}
      <div className="space-y-6">
        {/* 用户与收入 */}
        <div>
          <h3 className="text-lg font-semibold mb-4">{t('overview.categories.users_revenue')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t('overview.stats.total_users')}</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatNumber(stats?.totalUsers || 0)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t('overview.stats.subscribed_users')}</CardTitle>
                <CreditCard className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatNumber(stats?.subscribedUsers || 0)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t('overview.stats.subscription_revenue')}</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(stats?.subscriptionRevenue || 0)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t('overview.stats.points_revenue')}</CardTitle>
                <Coins className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(stats?.pointsPurchaseRevenue || 0)}</div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* 防薅监控（pricing doc §4.6）：封号前先看这两个数 */}
        <div>
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            {t('overview.antifraud.title')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t('overview.antifraud.conversion')}</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {conversionRate !== null ? `${conversionRate}%` : '-'}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('overview.antifraud.conversion_desc', {
                    converted: formatNumber(antifraud?.convertedUsers || 0),
                    total: formatNumber(antifraud?.totalUsers || 0),
                  })}
                </p>
              </CardContent>
            </Card>

            <Card className="md:col-span-1 lg:col-span-2 xl:col-span-3">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t('overview.antifraud.top_ips')}</CardTitle>
              </CardHeader>
              <CardContent>
                {(antifraud?.topSignupIps?.length || 0) === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">{t('overview.antifraud.empty')}</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="pb-2 font-medium">{t('overview.antifraud.ip_col')}</th>
                        <th className="pb-2 font-medium text-right">{t('overview.antifraud.count_col')}</th>
                        <th className="pb-2 font-medium text-right">{t('overview.antifraud.verified_col')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(antifraud?.topSignupIps || []).map((row) => (
                        <tr key={row.ip} className="border-t">
                          <td className="py-1.5 font-mono text-xs">{row.ip}</td>
                          <td className="py-1.5 text-right font-medium">{row.count}</td>
                          <td className="py-1.5 text-right text-muted-foreground">{row.cardVerified}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* 推荐与推广 */}
        <div>
          <h3 className="text-lg font-semibold mb-4">{t('overview.categories.referral_affiliate')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t('overview.stats.total_referrals')}</CardTitle>
                <UserPlus className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatNumber(stats?.totalReferrals || 0)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t('overview.stats.referral_subscribed')}</CardTitle>
                <Award className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatNumber(stats?.referralSubscribedCount || 0)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t('overview.stats.referral_reward_points')}</CardTitle>
                <Award className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatNumber(stats?.referralRewardPoints || 0)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t('overview.stats.affiliate_count')}</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatNumber(stats?.affiliateCount || 0)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t('overview.stats.affiliate_earnings')}</CardTitle>
                <Wallet className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(stats?.affiliateTotalEarnings || 0)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t('overview.stats.affiliate_withdrawals')}</CardTitle>
                <Wallet className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(stats?.affiliateTotalWithdrawals || 0)}</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* 趋势图表 */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{t('overview.trends.title')}</h3>
          <div className="flex gap-2">
            <Button
              variant={days === 7 ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDays(7)}
            >
              {t('overview.trends.days_7')}
            </Button>
            <Button
              variant={days === 30 ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDays(30)}
            >
              {t('overview.trends.days_30')}
            </Button>
            <Button
              variant={days === 90 ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDays(90)}
            >
              {t('overview.trends.days_90')}
            </Button>
          </div>
        </div>

        {trendsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* 注册人数趋势 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">{t('overview.trends.registration')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trends?.registrationTrends || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatDate}
                    />
                    <YAxis />
                    <Tooltip labelFormatter={formatDate} />
                    <Legend />
                    <Line type="monotone" dataKey="count" stroke="#8884d8" name={t('overview.trends.registration_count')} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* 订阅数和收入趋势 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">{t('overview.trends.subscription')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={trends?.subscriptionTrends || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatDate}
                    />
                    <YAxis yAxisId="left" />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tickFormatter={(value) => `$${(value / 100).toFixed(0)}`}
                    />
                    <Tooltip
                      labelFormatter={formatDate}
                      formatter={(value: number, name: string) => {
                        if (name === 'revenue' || name === t('overview.trends.subscription_revenue')) {
                          return formatCurrency(value)
                        }
                        return value
                      }}
                    />
                    <Legend />
                    <Bar yAxisId="left" dataKey="count" fill="#8884d8" name={t('overview.trends.subscription_count')} />
                    <Bar yAxisId="right" dataKey="revenue" fill="#82ca9d" name={t('overview.trends.subscription_revenue')} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* 总收入趋势 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">{t('overview.trends.total_revenue')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trends?.revenueTrends || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={formatDate} />
                    <YAxis tickFormatter={(value) => `$${(value / 100).toFixed(0)}`} />
                    <Tooltip
                      labelFormatter={formatDate}
                      formatter={(value: number) => formatCurrency(value)}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="revenue" stroke="#82ca9d" name={t('overview.trends.revenue')} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
