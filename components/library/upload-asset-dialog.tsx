"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useLocale } from "next-intl"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { PricingDialog } from "@/components/pricing-dialog"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  useToast,
} from "@/components/ui/use-toast"
import {
  Upload,
  X,
  Image as ImageIcon,
  Film,
  Music,
  File,
  Loader2,
  HardDrive,
} from "lucide-react"

interface UploadAssetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUploadSuccess?: () => void
}

// 存储空间限制定义（字节）
const STORAGE_LIMITS: Record<string, number> = {
  free: 1 * 1024 * 1024 * 1024,
  trial: 50 * 1024 * 1024 * 1024,
  pro: 100 * 1024 * 1024 * 1024,
  annual: -1,
}

// 文件大小限制（字节）
const FILE_SIZE_LIMITS: Record<string, number> = {
  free: 10 * 1024 * 1024,
  trial: 50 * 1024 * 1024,
  pro: 100 * 1024 * 1024,
  annual: 500 * 1024 * 1024,
}

// 格式化字节大小
function formatBytes(bytes: number): string {
  if (bytes < 0) return "无限制"
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`
}

// 格式化百分比
function formatPercent(used: number, limit: number): string {
  if (limit < 0) return "0%"
  return `${Math.min(100, Math.round((used / limit) * 100))}%`
}

export function UploadAssetDialog({
  open,
  onOpenChange,
  onUploadSuccess,
}: UploadAssetDialogProps) {
  const t = useTranslations("library")
  const locale = useLocale()
  const { data: session } = useSession()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [assetName, setAssetName] = useState("")
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  // 订阅计划状态
  const [subscriptionPlan, setSubscriptionPlan] = useState<string | null>(null)
  const [showFileSizeLimitDialog, setShowFileSizeLimitDialog] = useState(false)
  const [showStorageLimitDialog, setShowStorageLimitDialog] = useState(false)

  // 存储空间状态
  const [usedStorage, setUsedStorage] = useState(0)
  const [storageLimit, setStorageLimit] = useState(0)

  // 获取订阅计划
  useEffect(() => {
    const fetchSubscription = async () => {
      try {
        const res = await fetch("/api/user/subscription")
        if (res.ok) {
          const data = await res.json()
          setSubscriptionPlan(data.plan)
        }
      } catch (err) {
        console.error("获取订阅计划失败:", err)
      }
    }

    if (session?.user) {
      fetchSubscription()
    }
  }, [session])

  // 获取存储空间信息
  useEffect(() => {
    const fetchStorage = async () => {
      try {
        const res = await fetch("/api/library/storage")
        if (res.ok) {
          const data = await res.json()
          console.log("Fetched storage on open:", data)
          setUsedStorage(data.usedStorage)
          setStorageLimit(data.storageLimit)
        }
      } catch (err) {
        console.error("获取存储空间失败:", err)
      }
    }

    if (session?.user) {
      fetchStorage()
    }
  }, [session])

  // 获取上传文件大小限制 (字节)
  const getFileSizeLimit = useCallback((): number => {
    const plan = subscriptionPlan || "free"
    return FILE_SIZE_LIMITS[plan] ?? FILE_SIZE_LIMITS.free
  }, [subscriptionPlan])

  // 获取存储空间限制 (字节)
  const getStorageLimitBytes = useCallback((): number => {
    const plan = subscriptionPlan || "free"
    return STORAGE_LIMITS[plan] ?? STORAGE_LIMITS.free
  }, [subscriptionPlan])

  // 获取文件大小限制文本
  const getFileSizeLimitText = useCallback((): string => {
    const limitMB = Math.round(getFileSizeLimit() / (1024 * 1024))
    if (subscriptionPlan === 'annual') {
      return t("upload.noLimit") || "无限制"
    }
    return t("upload.maxFileSize", { limit: limitMB.toString() }) || `你可上传 ${limitMB}MB`
  }, [getFileSizeLimit, subscriptionPlan, t])

  // 获取存储空间使用情况文本
  const getStorageUsageText = useCallback((): string => {
    const limit = getStorageLimitBytes()
    if (limit < 0) {
      return t("upload.storageUnlimited") || "存储空间无限制"
    }
    return `${formatBytes(usedStorage)} / ${formatBytes(limit)}`
  }, [usedStorage, getStorageLimitBytes, t])

  // 获取存储空间使用百分比
  const getStorageUsagePercent = useCallback((): number => {
    const limit = getStorageLimitBytes()
    if (limit < 0) return 0
    return Math.min(100, (usedStorage / limit) * 100)
  }, [usedStorage, getStorageLimitBytes])

  // Determine file type icon
  const getFileTypeIcon = (file: File | null) => {
    if (!file) return <Upload className="w-12 h-12 text-muted-foreground" />
    if (file.type.startsWith("image/")) return <ImageIcon className="w-12 h-12 text-green-500" />
    if (file.type.startsWith("video/")) return <Film className="w-12 h-12 text-purple-500" />
    if (file.type.startsWith("audio/")) return <Music className="w-12 h-12 text-orange-500" />
    return <File className="w-12 h-12 text-muted-foreground" />
  }

  // Reset state on close
  const handleClose = useCallback(() => {
    setSelectedFile(null)
    setPreviewUrl(null)
    setAssetName("")
    setError(null)
    setDragOver(false)
    onOpenChange(false)
  }, [onOpenChange])

  // Handle file selection
  const handleFileSelect = useCallback((file: File) => {
    // Check file size limit
    const limit = getFileSizeLimit()
    if (file.size > limit) {
      setShowFileSizeLimitDialog(true)
      return
    }

    // Check storage limit
    const storageLim = getStorageLimitBytes()
    if (storageLim > 0 && usedStorage + file.size > storageLim) {
      setShowStorageLimitDialog(true)
      return
    }

    setSelectedFile(file)
    setError(null)

    // Generate preview for images
    if (file.type.startsWith("image/")) {
      const reader = new FileReader()
      reader.onload = (e) => {
        setPreviewUrl(e.target?.result as string)
      }
      reader.readAsDataURL(file)
    } else {
      setPreviewUrl(null)
    }

    // Set default name from filename
    if (!assetName) {
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "")
      setAssetName(nameWithoutExt)
    }
  }, [getFileSizeLimit, getStorageLimitBytes, usedStorage, assetName])

  // Handle drop zone click
  const handleDropZoneClick = () => {
    fileInputRef.current?.click()
  }

  // Handle file input change
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFileSelect(file)
    }
  }

  // Handle drag events
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)

    const file = e.dataTransfer.files[0]
    if (file) {
      handleFileSelect(file)
    }
  }

  // Handle upload
  const handleUpload = async () => {
    if (!selectedFile) return

    setUploading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append("file", selectedFile)
      formData.append("name", assetName.trim() || selectedFile.name)

      const res = await fetch("/api/library/upload", {
        method: "POST",
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        if (data.error === "STORAGE_LIMIT_EXCEEDED") {
          if (data.code === "FILE_SIZE_EXCEEDS_LIMIT") {
            setShowFileSizeLimitDialog(true)
          } else {
            setShowStorageLimitDialog(true)
          }
          return
        }
        throw new Error(data.error || "上传失败")
      }

      toast({
        title: t("upload.success"),
        description: data.data.name,
      })

      // Update storage info
      if (data.storage && data.storage.usedStorage !== null) {
          setUsedStorage(data.storage.usedStorage)
      } else {
        // 如果 API 没有返回存储信息，重新获取
        try {
          const storageRes = await fetch("/api/library/storage")
          if (storageRes.ok) {
            const storageData = await storageRes.json()
            setUsedStorage(storageData.usedStorage)
            setStorageLimit(storageData.storageLimit)
          }
        } catch (err) {
          console.error("Failed to refresh storage info:", err)
        }
      }

      handleClose()
      onUploadSuccess?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message || t("uploadFailed"))
    } finally {
      setUploading(false)
    }
  }

  // Validate file type
  const validTypes = [
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "video/mp4", "video/webm", "video/quicktime",
    "audio/mpeg", "audio/wav", "audio/ogg", "audio/mp3"
  ]

  const handleFileInputChangeWithTypeCheck = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!validTypes.some(type => file.type.startsWith(type.split("/")[0]))) {
      setError(t("invalidFileType") || "不支持的文件类型")
      return
    }

    handleFileSelect(file)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("upload.title") || "上传素材"}</DialogTitle>
          <DialogDescription>
            {t("upload.description")} · {getFileSizeLimitText()}
          </DialogDescription>
        </DialogHeader>

        {/* 存储空间使用情况 */}
        <div className="bg-muted/50 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <HardDrive className="w-4 h-4" />
              <span>{t("upload.storageUsed") || "存储空间"}</span>
            </div>
            <span className="font-medium">{getStorageUsageText()}</span>
          </div>
          <Progress value={getStorageUsagePercent()} className="h-2" />
        </div>

        <div className="space-y-4 py-4 overflow-hidden">
          {/* Drop zone */}
          {!selectedFile ? (
            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer",
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
              )}
              onClick={handleDropZoneClick}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              aria-label={t("upload.dropzone.title")}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleDropZoneClick()
                }
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,audio/*,video/*"
                className="hidden"
                onChange={handleFileInputChangeWithTypeCheck}
              />
              <div className="flex flex-col items-center gap-3">
                <div className={cn(
                  "p-4 rounded-full bg-muted",
                  dragOver && "bg-primary/10"
                )}>
                  <Upload className="w-8 h-8 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium">{t("upload.dropzone.title")}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("upload.dropzone.hint")}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* Selected file preview */
            <div className="relative rounded-lg border bg-muted/50 p-4 overflow-hidden">
              <button
                className="absolute top-2 right-2 p-1 rounded-full bg-background/80 hover:bg-background"
                aria-label={t("upload.removeFile")}
                onClick={() => {
                  setSelectedFile(null)
                  setPreviewUrl(null)
                }}
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>

              <div className="flex items-center gap-4 overflow-hidden">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={assetName}
                    className="w-20 h-20 object-cover rounded-lg flex-shrink-0"
                  />
                ) : (
                  <div className="w-20 h-20 flex items-center justify-center bg-muted rounded-lg flex-shrink-0">
                    {getFileTypeIcon(selectedFile)}
                  </div>
                )}
                <div className="flex-1 min-w-0 overflow-hidden">
                  <p className="font-medium truncate" title={assetName || selectedFile.name}>
                    {assetName || selectedFile.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selectedFile.type.split("/")[0]} · {formatBytes(selectedFile.size)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleClose} disabled={uploading}>
            {t("upload.cancel")}
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!selectedFile || uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t("upload.uploading")}
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                {t("upload.upload")}
              </>
            )}
          </Button>
        </div>
      </DialogContent>

      {/* 文件大小超限弹窗 */}
      <AlertDialog open={showFileSizeLimitDialog} onOpenChange={setShowFileSizeLimitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("upload.fileTooLarge") || "文件过大"}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("upload.fileSizeLimitDesc", { limit: Math.round(getFileSizeLimit() / (1024 * 1024)).toString() }) || `当前版本最多可上传 ${Math.round(getFileSizeLimit() / (1024 * 1024))}MB 的文件，请升级订阅以获得更大上传限制`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("upload.cancel")}</AlertDialogCancel>
            <AlertDialogAction asChild>
              <PricingDialog>
                <Button variant="default" size="sm" className="w-full">
                  {t("upload.upgradeTitle") || "升级订阅"}
                </Button>
              </PricingDialog>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 存储空间超限弹窗 */}
      <AlertDialog open={showStorageLimitDialog} onOpenChange={setShowStorageLimitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("upload.storageFull") || "存储空间不足"}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("upload.storageFullDesc", {
                used: formatBytes(usedStorage),
                limit: formatBytes(getStorageLimitBytes()),
              }) || `您已使用 ${formatBytes(usedStorage)}，存储空间已满。请升级订阅以获得更大存储空间。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("upload.cancel")}</AlertDialogCancel>
            <AlertDialogAction asChild>
              <PricingDialog>
                <Button variant="default" size="sm" className="w-full">
                  {t("upload.upgradeTitle") || "升级订阅"}
                </Button>
              </PricingDialog>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
