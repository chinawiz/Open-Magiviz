"use client"

import { useTranslations } from "next-intl"
import type { Dispatch, SetStateAction } from "react"
import { useToast } from "@/hooks/use-toast"
import { computeFileSizeLimit } from "@/components/operate/format"

export type StorageUsageInfo = {
  usedStorage: number
  storageLimit: number
  availableStorage: number
}

/**
 * 下载与存储用量外围 hook（自 operate.tsx 拆分 T10）。
 * 函数体逐字搬移,行为不变;订阅计划与弹窗/下载态 setter 由调用方注入,
 * i18n(operate 命名空间)与 toast 由 hook 内自持。
 * 文件类型分类的纯函数见 components/operate/format.ts 的 getFileType。
 */
export function useFileStorage(deps: {
  subscriptionPlan: string | null
  setFileSizeLimitMB: Dispatch<SetStateAction<number>>
  setShowFileSizeLimitDialog: Dispatch<SetStateAction<boolean>>
  setStorageLimitInfo: Dispatch<SetStateAction<StorageUsageInfo | null>>
  setShowStorageLimitDialog: Dispatch<SetStateAction<boolean>>
  setDownloadingKey: Dispatch<SetStateAction<string | null>>
}) {
  const {
    subscriptionPlan,
    setFileSizeLimitMB,
    setShowFileSizeLimitDialog,
    setStorageLimitInfo,
    setShowStorageLimitDialog,
    setDownloadingKey,
  } = deps
  const t = useTranslations("operate")
  const { toast } = useToast()

  const handleDownloadFile = async (url?: string, filename?: string, key?: string) => {
    if (!url) {
      toast({
        title: t("downloadFailed"),
        description: t("noFileToDownload"),
        variant: "destructive",
      })
      return
    }

    const downloadKey = key || filename || url.split('/').pop() || Date.now().toString()
    setDownloadingKey(downloadKey)

    try {
      // 检查是否是 Kie.ai 的 URL（需要先转换）
      let finalUrl = url
      if (url.includes('kie.ai') || url.includes('tempfile.')) {
        try {
          const downloadResp = await fetch('/api/ai/kie/download-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
          })
          const downloadData = await downloadResp.json()
          if (downloadData.success && downloadData.downloadUrl) {
            finalUrl = downloadData.downloadUrl
          }
        } catch (e) {
          console.error('获取下载 URL 失败:', e)
        }
      }

      // 尝试使用 fetch 流式下载以显示进度（若被 CORS 限制则回退到直接打开链接下载）
      const resp = await fetch(finalUrl)
      if (!resp.ok) throw new Error(t('downloadFailed'))

      const contentLength = resp.headers.get('content-length')
      if (!resp.body || !contentLength) {
        // 回退：使用 a 标签直接下载（不可获取进度）
        const a = document.createElement('a')
        a.href = url
        a.download = filename || url.split('/').pop() || 'file'
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        document.body.appendChild(a)
        a.click()
        a.remove()
        toast({
          title: t("downloadStarted"),
          description: filename || t("fileDownloading"),
        })
        setDownloadingKey(null)
        return
      }

      const _total = parseInt(contentLength, 10) // 进度展示未接线:存量债务,前缀避免未用告警
      const reader = resp.body.getReader()
      const chunks: Uint8Array[] = []
      let _received = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          chunks.push(value)
          _received += value.length
        }
      }

      const blob = new Blob(chunks)
      const downloadUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = filename || url.split('/').pop() || 'file'
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(downloadUrl)

      toast({
        title: t("downloadCompleted"),
        description: filename || t("fileDownloaded"),
      })
    } catch (error) {
      // 如果 fetch 出错，降级到 a 标签下载尝试
      try {
        const a = document.createElement('a')
        a.href = url
        a.download = filename || url.split('/').pop() || 'file'
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        document.body.appendChild(a)
        a.click()
        a.remove()
        toast({
          title: t("downloadStarted"),
          description: filename || t("fileDownloading"),
        })
      } catch {
        toast({
          title: t("downloadFailed"),
          description: error instanceof Error ? error.message : t("retryLater"),
          variant: "destructive",
        })
      }
    } finally {
      setDownloadingKey(null)
    }
  }

  // 处理文件大小超限 - 打开弹窗
  const handleFileSizeExceeded = () => {
    const limitMB = Math.round(computeFileSizeLimit(subscriptionPlan) / (1024 * 1024))
    if (subscriptionPlan === 'annual') {
      // Annual 不应该超限，这只是保底处理
      toast({
        title: t("fileTooLarge"),
        description: t("uploadFailed"),
        variant: "destructive",
      })
      return
    }
    setFileSizeLimitMB(limitMB)
    setShowFileSizeLimitDialog(true)
  }

  // 获取存储空间信息
  const fetchStorageInfo = async () => {
    try {
      const res = await fetch("/api/library/storage")
      if (res.ok) {
        const data = await res.json()
        return {
          usedStorage: data.usedStorage,
          storageLimit: data.storageLimit,
          availableStorage: data.storageLimit - data.usedStorage,
        }
      }
    } catch {
      console.error("获取存储空间失败")
    }
    return null
  }

  // 检查存储空间是否足够
  const checkStorageAvailable = async (totalFileSize: number): Promise<{ available: boolean; storageInfo?: StorageUsageInfo }> => {
    // Annual 无限制
    if (subscriptionPlan === 'annual') {
      return { available: true }
    }

    const storageInfo = await fetchStorageInfo()
    if (!storageInfo) {
      return { available: true } // 获取失败时允许上传
    }

    if (totalFileSize > storageInfo.availableStorage) {
      return { available: false, storageInfo }
    }

    return { available: true, storageInfo }
  }

  // 处理存储空间不足 - 打开弹窗
  const handleStorageLimitExceeded = (storageInfo: StorageUsageInfo) => {
    setStorageLimitInfo(storageInfo)
    setShowStorageLimitDialog(true)
  }

  return {
    handleDownloadFile,
    handleFileSizeExceeded,
    fetchStorageInfo,
    checkStorageAvailable,
    handleStorageLimitExceeded,
  }
}
