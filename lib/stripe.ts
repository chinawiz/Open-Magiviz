import Stripe from 'stripe'

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

// 订阅价格配置（starter 为 2026-08-30 定价新增的入门档，见 docs/pricing-redesign-2026-08.md）
export const SUBSCRIPTION_PRICE_IDS = {
  trial: getPriceId(process.env.STRIPE_TRIAL_PRICE_ID, ''),
  starter: getPriceId(process.env.STRIPE_STARTER_PRICE_ID, ''),
  pro: getPriceId(process.env.STRIPE_PRO_PRICE_ID, ''),
  annual: getPriceId(process.env.STRIPE_ANNUAL_PRICE_ID, ''),
} as const

// 积分购买价格配置（仅供 POINTS_PRODUCTS 引用，客户端金额一律以服务端为准）
const POINTS_PRICE_IDS = {
  starter: getPriceId(process.env.STRIPE_POINTS_STARTER_PRICE_ID, ''), // 200积分 - $20
  popular: getPriceId(process.env.STRIPE_POINTS_POPULAR_PRICE_ID, ''), // 500积分 - $50
  premium: getPriceId(process.env.STRIPE_POINTS_PREMIUM_PRICE_ID, ''), // 1,000积分 - $85
} as const

// 获取实际的价格ID（服务端使用）。注意：points* 前缀是积分包，避免与订阅 starter 混淆
export function getActualPriceIds() {
  return {
    trial: process.env.STRIPE_TRIAL_PRICE_ID || '',
    starter: process.env.STRIPE_STARTER_PRICE_ID || '',
    pro: process.env.STRIPE_PRO_PRICE_ID || '',
    annual: process.env.STRIPE_ANNUAL_PRICE_ID || '',
    pointsStarter: process.env.STRIPE_POINTS_STARTER_PRICE_ID || '',
    pointsPopular: process.env.STRIPE_POINTS_POPULAR_PRICE_ID || '',
    pointsPremium: process.env.STRIPE_POINTS_PREMIUM_PRICE_ID || '',
  }
}

// 订阅产品配置
export const SUBSCRIPTION_PRODUCTS = {
  // trial 为 2026-08 定价重构前的遗留档：仅用于老订阅续费的 webhook 映射，checkout UI 已下架
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
  // 2026-08-30 定价重构三档（docs/pricing-redesign-2026-08.md）：
  // Starter $9.9/110 点、Pro $24.9/290 点、Annual $249/3000 点。
  // 价格只能由 Stripe 新 Price 承载（环境变量 STRIPE_*_PRICE_ID），勿在代码里改老 Price。
  starter: {
    name: 'Starter Plan',
    priceId: SUBSCRIPTION_PRICE_IDS.starter,
    price: 9.9,
    interval: 'month',
    giftedPoints: 110, // 订阅赠送的积分（≈2 部 24s 成片 + 修改余量）
    features: [
      '30-day subscription',
      '110 credits included',
      '≈2 full short films / month',
      '50GB storage space',
      'Max upload: 50MB',
      'Templates free',
      'Commercial license',
    ],
  },
  pro: {
    name: 'Professional Plan',
    priceId: SUBSCRIPTION_PRICE_IDS.pro,
    price: 24.9,
    interval: 'month',
    giftedPoints: 290, // 订阅赠送的积分（≈6 部 24s 成片）
    features: [
      '30-day subscription',
      '290 credits included',
      '≈6 full short films / month',
      '100GB storage space',
      'Max upload: 100MB',
      'Templates free',
      'Commercial license',
    ],
  },
  annual: {
    name: 'Annual Plan',
    priceId: SUBSCRIPTION_PRICE_IDS.annual,
    price: 249,
    originalPrice: 299, // Pro 月付 ×12 的原价锚，badge「立省 $50」
    interval: 'year',
    intervalCount: 1,
    giftedPoints: 3000, // 订阅赠送的积分（≈62 部 24s 成片/年）
    features: [
      '365-day subscription',
      '3,000 credits included',
      '≈62 full short films / year',
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
    price: 85,
    priceId: POINTS_PRICE_IDS.premium,
    description: '适合重度用户',
  },
} as const

export type SubscriptionPlanType = keyof typeof SUBSCRIPTION_PRODUCTS