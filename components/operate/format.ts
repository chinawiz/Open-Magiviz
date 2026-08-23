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

/**
 * 按订阅计划计算上传文件大小限制（字节）。
 * 从 components/operate.tsx 的 getFileSizeLimit 提取为纯函数，行为一致。
 */
export function computeFileSizeLimit(plan: string | null): number {
  // 未登录或加载中：默认限制 10MB
  if (!plan) {
    return 10 * 1024 * 1024 // 10MB
  }
  // Annual 无限制，返回一个很大的值
  if (plan === 'annual') {
    return 500 * 1024 * 1024 // 500MB 作为无限制的合理上限
  }
  // Pro: 100MB
  if (plan === 'pro') {
    return 100 * 1024 * 1024
  }
  // Trial: 50MB
  if (plan === 'trial') {
    return 50 * 1024 * 1024
  }
  // Free 或其他：10MB
  return 10 * 1024 * 1024
}
