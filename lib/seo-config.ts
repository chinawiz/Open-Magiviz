export const seoConfig = {
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
}
