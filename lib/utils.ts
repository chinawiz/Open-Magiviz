import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 设置推广码 Cookie（30天有效期）
 * 当用户访问 ?aff={affiliateCode} 时调用此函数
 */
export function setAffiliateCookie(affiliateCode: string) {
  if (typeof window === 'undefined') return

  const maxAge = 30 * 24 * 60 * 60 // 30天（秒）
  document.cookie = `aff=${encodeURIComponent(affiliateCode)}; path=/; max-age=${maxAge}; SameSite=Lax`
}
