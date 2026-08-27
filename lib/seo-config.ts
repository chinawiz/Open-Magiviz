export const seoConfig = {
  baseUrl: process.env.NEXT_PUBLIC_BASE_URL || '',
  siteName: 'MeiHao',
  defaultLocale: 'zh',
  locales: ['zh', 'en'],

  // 社交媒体设置
  social: {
    twitter: '@zyailive',
    email: 'app@itusi.cn',
    wechat: 'zyailive01',
  },

  // 验证码设置
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION,
    bing: process.env.BING_SITE_VERIFICATION,
    yandex: process.env.YANDEX_VERIFICATION,
    baidu: process.env.BAIDU_SITE_VERIFICATION,
  },

  // 分析工具设置
  analytics: {
    googleAnalytics: process.env.NEXT_PUBLIC_GA_ID,
    baiduAnalytics: process.env.NEXT_PUBLIC_BAIDU_ANALYTICS_ID,
    // Umami 统计（可选）
    // 在环境变量中设置：
    // NEXT_PUBLIC_UMAMI_WEBSITE_ID=你的站点ID
    // NEXT_PUBLIC_UMAMI_SCRIPT_URL=https://cloud.umami.is/script.js 或自建脚本地址
    umamiWebsiteId: process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID,
    umamiScriptUrl: process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL || 'https://cloud.umami.is/script.js',
  },

  // 图片设置
  images: {
    logo: '/logo.png',
    ogImage: '/logo.png',
    favicon: '/favicon.ico',
  },

  // 结构化数据设置
  organization: {
    name: 'MeiHao',
    foundingDate: '2025',
    industry: 'Video Production & AI Technology',
    numberOfEmployees: '1-10',
    contactEmail: 'app@itusi.cn',
    url: 'https://meihao.com',
    description: 'AI-powered intelligent video creation platform. From concept to finished product in one click. Support Hollywood films, anime, story plots, advertisements, and educational videos.',
    keywords: ['AI Video Creation', 'Video Generation', 'Film Production', 'Anime Production', 'Advertising Video', 'Educational Video', 'Story Plot', 'Intelligent Creation'],
    sameAs: [
      'https://github.com/ItusiAI',
      'https://twitter.com/zyailive'
    ]
  }
}

// 生成完整URL的辅助函数
export function getFullUrl(path: string, locale?: string) {
  const localePrefix = locale ? `/${locale}` : ''
  return `${seoConfig.baseUrl}${localePrefix}${path}`
}

// 生成多语言链接的辅助函数
export function getAlternateLinks(path: string) {
  return seoConfig.locales.reduce((acc, locale) => {
    acc[locale] = getFullUrl(path, locale)
    return acc
  }, {} as Record<string, string>)
}
