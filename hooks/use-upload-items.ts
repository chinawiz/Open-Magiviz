"use client"

import { useState } from "react"
import type { ChangeEvent, Dispatch, SetStateAction } from "react"
import { useTranslations } from "next-intl"
import { useToast } from "@/hooks/use-toast"
import { getFileType, computeFileSizeLimit } from "@/components/operate/format"
import type { StorageUsageInfo } from "@/hooks/use-file-storage"

/** 上传中条目（自 operate.tsx 拆出，拆分 T11，字段与原 UploadingItem 一致） */
export type UploadingItem = {
  id: string
  filename: string
  localUrl: string
  status: "uploading" | "done" | "error"
  url?: string
  type: "image" | "audio" | "video"
}

/**
 * 上传清单管理 hook（自 operate.tsx 拆分 T11）。
 * 自持 uploadingItems 状态;上传 URL 三族(image/video/audio)与链接输入状态仍归调用方,
 * 存储检查/超限弹窗处理器来自 use-file-storage hook,经 deps 注入。
 * handleFileSelect/addImageUrl/removeImageUrl/handleAddLink 函数体逐字搬移,行为不变。
 */
export function useUploadItems(deps: {
  subscriptionPlan: string | null
  checkStorageAvailable: (totalFileSize: number) => Promise<{ available: boolean; storageInfo?: StorageUsageInfo }>
  handleStorageLimitExceeded: (storageInfo: StorageUsageInfo) => void
  handleFileSizeExceeded: () => void
  onImageUpload?: (file: File) => void
  setSelectedImages: Dispatch<SetStateAction<File[]>>
  imageUrls: string[]
  setImageUrls: Dispatch<SetStateAction<string[]>>
  setVideoUrls: Dispatch<SetStateAction<string[]>>
  setAudioUrls: Dispatch<SetStateAction<string[]>>
  fileInputRef: { current: HTMLInputElement | null }
  setShowUploadPopover: Dispatch<SetStateAction<boolean>>
  linkInput: string
  setLinkInput: Dispatch<SetStateAction<string>>
  setShowLinkInput: Dispatch<SetStateAction<boolean>>
}) {
  const {
    subscriptionPlan,
    checkStorageAvailable,
    handleStorageLimitExceeded,
    handleFileSizeExceeded,
    onImageUpload,
    setSelectedImages,
    imageUrls,
    setImageUrls,
    setVideoUrls,
    setAudioUrls,
    fileInputRef,
    setShowUploadPopover,
    linkInput,
    setLinkInput,
    setShowLinkInput,
  } = deps
  const [uploadingItems, setUploadingItems] = useState<UploadingItem[]>([])
  const t = useTranslations("operate")
  const { toast } = useToast()

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    // 支持图片、音频、视频
    const validFiles = files.filter((f) => {
      const type = getFileType(f)
      return type === "image" || type === "audio" || type === "video"
    })
    const invalidCount = files.length - validFiles.length
    if (invalidCount > 0) {
      toast({
        title: t("fileTypeError"),
        description: t("invalidFileType"),
        variant: "destructive",
      })
    }
    if (validFiles.length === 0) return

    // 分类文件：图片添加到 selectedImages，音频/视频单独处理
    const imageFiles = validFiles.filter((f) => getFileType(f) === "image")
    const _mediaFiles = validFiles.filter((f) => getFileType(f) !== "image") // 存量未用:分类结果无人消费,前缀避免告警

    if (imageFiles.length > 0) {
      setSelectedImages((prev) => [...prev, ...imageFiles])
    }

    // 计算所有文件的总大小
    const totalSize = validFiles.reduce((sum, file) => sum + file.size, 0)

    // 检查存储空间是否足够
    ;(async () => {
      const { available, storageInfo } = await checkStorageAvailable(totalSize)
      if (!available && storageInfo) {
        handleStorageLimitExceeded(storageInfo)
        return
      }

      // 处理所有文件的上传
      validFiles.forEach((file) => {
        const fileType = getFileType(file)
        const sizeLimit = computeFileSizeLimit(subscriptionPlan)

        // 检查文件大小
        if (file.size > sizeLimit) {
          handleFileSizeExceeded()
          return
        }

        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const localUrl = URL.createObjectURL(file)

      // 图片文件触发 onImageUpload
      if (fileType === "image") {
        onImageUpload?.(file)
      }

      setUploadingItems((prev) => [...prev, { id, filename: file.name, localUrl, status: "uploading", type: fileType }])

      ;(async () => {
        try {
          const reader = new FileReader()
          const dataUrl: string = await new Promise((resolve, reject) => {
            reader.onerror = () => reject(new Error("File read error"))
            reader.onload = () => resolve(String(reader.result))
            reader.readAsDataURL(file)
          })
          const match = dataUrl.match(/^data:(.+);base64,(.+)$/)
          if (!match) throw new Error("Invalid file data")
          const contentType = match[1]
          const base64 = match[2]

          const res = await fetch("/api/upload", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              filename: file.name,
              contentType,
              data: base64,
              assetType: fileType,
            }),
          })
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            console.error("Upload failed", data.message || t('uploadFailed'))
            setUploadingItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "error" } : it)))
          } else {
            const json = await res.json()
            if (json?.url) {
              setUploadingItems((prev) =>
                prev.map((it) => (it.id === id ? { ...it, status: "done", url: json.url } : it))
              )
              // 只将图片 URL 添加到 imageUrls
              if (fileType === "image") {
                setImageUrls((prev) => [...prev, json.url])
              } else if (fileType === "video") {
                setVideoUrls((prev) => [...prev, json.url])
              } else if (fileType === "audio") {
                setAudioUrls((prev) => [...prev, json.url])
              }
              try {
                URL.revokeObjectURL(localUrl)
              } catch {}
            } else {
              setUploadingItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "error" } : it)))
            }
          }
        } catch (err) {
          console.error("Upload error:", err)
          setUploadingItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "error" } : it)))
        }
      })()
      })
    })()

    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
    // close upload popover after selecting files
    setShowUploadPopover(false)
  }

  const addImageUrl = (url: string) => {
    if (url.trim() && !imageUrls.includes(url.trim())) {
      setImageUrls([...imageUrls, url.trim()])
    }
  }

  const removeImageUrl = (index: number) => {
    setImageUrls(imageUrls.filter((_, i) => i !== index))
  }

  const handleAddLink = () => {
    if (linkInput.trim()) {
      addImageUrl(linkInput.trim())
      setLinkInput("")
      setShowLinkInput(false)
    }
  }

  return {
    uploadingItems,
    setUploadingItems,
    handleFileSelect,
    addImageUrl,
    removeImageUrl,
    handleAddLink,
  }
}
