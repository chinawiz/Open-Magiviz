import { loadStripe } from '@stripe/stripe-js'
import Stripe from 'stripe'

// 客户端Stripe实例
export const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

// 服务端Stripe实例 - 只在有密钥时初始化
export const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-01-28.clover',
      typescript: true,
    })
  : null

// 获取价格ID的函数 - 在服务端使用环境变量，在客户端使用预设值
function getPriceId(envVar: string | undefined, fallback: string = ''): string {
  // 如果是服务端环境，直接返回环境变量
  if (typeof window === 'undefined') {
    return envVar || fallback
  }
  // 客户端返回空字符串，让服务端处理
  return fallback
}

// 订阅价格配置
export const SUBSCRIPTION_PRICE_IDS = {
  trial: getPriceId(process.env.STRIPE_TRIAL_PRICE_ID, ''),
  pro: getPriceId(process.env.STRIPE_PRO_PRICE_ID, ''),
  annual: getPriceId(process.env.STRIPE_ANNUAL_PRICE_ID, ''),
} as const

// 积分购买价格配置
export const POINTS_PRICE_IDS = {
  starter: getPriceId(process.env.STRIPE_POINTS_STARTER_PRICE_ID, ''), // 200积分 - $20
  popular: getPriceId(process.env.STRIPE_POINTS_POPULAR_PRICE_ID, ''), // 500积分 - $50
  premium: getPriceId(process.env.STRIPE_POINTS_PREMIUM_PRICE_ID, ''), // 1,000积分 - $98
} as const

// 向后兼容的价格配置
export const PRICE_IDS = {
  trial: SUBSCRIPTION_PRICE_IDS.trial,
  pro: SUBSCRIPTION_PRICE_IDS.pro,
  ...POINTS_PRICE_IDS,
} as const

// 获取实际的价格ID（服务端使用）
export function getActualPriceIds() {
  return {
    trial: process.env.STRIPE_TRIAL_PRICE_ID || '',
    pro: process.env.STRIPE_PRO_PRICE_ID || '',
    annual: process.env.STRIPE_ANNUAL_PRICE_ID || '',
    starter: process.env.STRIPE_POINTS_STARTER_PRICE_ID || '',
    popular: process.env.STRIPE_POINTS_POPULAR_PRICE_ID || '',
    premium: process.env.STRIPE_POINTS_PREMIUM_PRICE_ID || '',
  }
}

// 订阅产品配置
export const SUBSCRIPTION_PRODUCTS = {
  trial: {
    name: 'Trial Plan',
    priceId: SUBSCRIPTION_PRICE_IDS.trial,
    price: 19.9,
    originalPrice: 19.9,
    interval: 'week',
    intervalCount: 1, // 1周 = 7天
    giftedPoints: 200, // 订阅赠送的积分
    features: [
      'Trial available once only',
      '7-day trial period',
      '200 credits included',
      '50GB storage space',
      'Max upload: 50MB',
      'Templates free trial',
      'Commercial license',
    ],
  },
  pro: {
    name: 'Professional Plan',
    priceId: SUBSCRIPTION_PRICE_IDS.pro,
    price: 49.9,
    originalPrice: 55,
    interval: 'month',
    giftedPoints: 550, // 订阅赠送的积分
    features: [
      '30-day subscription',
      '550 credits included',
      '100GB storage space',
      'Max upload: 100MB',
      'Templates free',
      'Commercial license',
    ],
  },
  annual: {
    name: 'Annual Plan',
    priceId: SUBSCRIPTION_PRICE_IDS.annual,
    price: 499,
    originalPrice: 600,
    interval: 'year',
    intervalCount: 1,
    giftedPoints: 6600, // 订阅赠送的积分
    features: [
      '365-day subscription',
      '6,600 credits included',
      'Unlimited storage space',
      'Max upload: 500MB',
      'Templates free',
      'Commercial license',
    ],
  },
  enterprise: {
    name: 'Enterprise Plan',
    priceId: null, // 企业版不使用Stripe支付
    price: 'Contact Sales',
    interval: 'custom',
    giftedPoints: 0,
    features: [
      'Custom agent development',
      'Private deployment services',
      '24/7 technical support',
      'Enterprise-grade data security',
      'Unlimited credits',
    ],
  },
} as const

// 积分购买产品配置
export const POINTS_PRODUCTS = {
  starter: {
    id: 'starter',
    name: '入门套餐',
    points: 200,
    price: 20,
    priceId: POINTS_PRICE_IDS.starter,
    description: '适合新用户试用',
  },
  popular: {
    id: 'popular',
    name: '热门套餐',
    points: 500,
    price: 50,
    priceId: POINTS_PRICE_IDS.popular,
    description: '最受欢迎的选择',
    popular: true,
  },
  premium: {
    id: 'premium',
    name: '高级套餐',
    points: 1000,
    price: 98,
    priceId: POINTS_PRICE_IDS.premium,
    description: '适合重度用户',
  },
} as const

// 向后兼容的产品配置
export const PRODUCTS = SUBSCRIPTION_PRODUCTS

export type SubscriptionPlanType = keyof typeof SUBSCRIPTION_PRODUCTS
export type PointsPackageType = keyof typeof POINTS_PRODUCTS
export type PlanType = SubscriptionPlanType // 向后兼容 