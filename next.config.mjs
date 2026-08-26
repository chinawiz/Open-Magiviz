import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.js')

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // ffmpeg 二进制（~78MB）只随 Trigger.dev 任务部署，不打进 Vercel 函数包
  serverExternalPackages: ['ffmpeg-static'],
}

export default withNextIntl(nextConfig)

