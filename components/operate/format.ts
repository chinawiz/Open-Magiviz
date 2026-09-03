/**
 * 共享展示工具函数（从 components/operate.tsx 拆出，行为不变）。
 */

import { getFileSizeLimit } from '@/lib/plan-limits'

/** 格式化字节大小为可读文本；负数视为"无限制" */
export function formatBytes(bytes: number): string {
  if (bytes < 0) return "无限制"
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`
}

/**
 * 按订阅计划计算上传文件大小限制（字节）。
 * 配额唯一事实源在 lib/plan-limits.ts，此处仅保留兼容导出。
 */
export function computeFileSizeLimit(plan: string | null): number {
  return getFileSizeLimit(plan)
}

/**
 * 文件类型分类：按 MIME 前缀归类，未命中时默认当作图片
 * （自 operate.tsx 拆出，拆分 T10，行为不变）。
 */
export function getFileType(file: File): "image" | "audio" | "video" {
  if (file.type.startsWith("image/")) return "image"
  if (file.type.startsWith("audio/")) return "audio"
  if (file.type.startsWith("video/")) return "video"
  return "image" // 默认当作图片
}
