/**
 * 共享展示工具函数（从 components/operate.tsx 拆出，行为不变）。
 */

/** 格式化字节大小为可读文本；负数视为"无限制" */
export function formatBytes(bytes: number): string {
  if (bytes < 0) return "无限制"
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`
}
