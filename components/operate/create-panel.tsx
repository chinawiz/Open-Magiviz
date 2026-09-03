"use client"

import { useTranslations } from "next-intl"
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  KeyboardEvent,
  SetStateAction,
} from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Plus, Sparkles, X, Link, Upload, Loader2, HardDrive, FolderOpen, Music, Video } from "lucide-react"
import { formatBytes, computeFileSizeLimit } from "@/components/operate/format"
import { CreateSettingsPanel } from "@/components/operate/create-settings"
import type { UploadingItem } from "@/hooks/use-upload-items"
import type { StorageUsageInfo } from "@/hooks/use-file-storage"

/** 输入框字符上限(自 operate.tsx 模块常量迁入,拆分 T12) */
export const MAX_CHARACTERS = 10000

/** 视频风格映射(自 operate.tsx 组件级定义迁入,拆分 T12) */
const videoStyleMap: Record<string, string> = {
  auto: "auto",
  anime: "videoStyleAnime",
  hollywood: "videoStyleHollywood",
  ads: "videoStyleAdsEducation"
}

/**
 * 创作输入区（自 operate.tsx JSX 拆出,拆分 T12）。
 * 上传缩略图、输入框、冷启动示例、上传按钮、存储用量、参数设置面板、生成按钮。
 * JSX 逐字搬移;全部状态与事件处理器由调用方注入(props 与原绑定同名),零自身业务逻辑。
 * 字符计数/近限判断为纯派生,随 message 在组件内计算(原 derive 逻辑一并迁入)。
 */
export function CreatePanel({
  message,
  setMessage,
  isGenerating,
  status,
  handleSend,
  handleKeyDown,
  handlePaste,
  placeholderText,
  uploadingItems,
  setUploadingItems,
  imageUrls,
  setImageUrls,
  videoUrls,
  setVideoUrls,
  audioUrls,
  setAudioUrls,
  selectedImages,
  hasMedia,
  showUploadPopover,
  setShowUploadPopover,
  showSettingsPopover,
  setShowSettingsPopover,
  setShowLinkInput,
  fileInputRef,
  textareaRef,
  handleFileSelect,
  openLibrary,
  fetchStorageInfo,
  openPreview,
  openPreviewAt,
  removeImageUrl,
  setPreviewImage,
  setStorageLimitInfo,
  storageLimitInfo,
  setIsSignInDialogOpen,
  subscriptionPlan,
  videoModel,
  setVideoModel,
  videoResolution,
  setVideoResolution,
  generationMode,
  setGenerationMode,
  aspectRatio,
  setAspectRatio,
  duration,
  setDuration,
  videoStyle,
  setVideoStyle,
  pointsCost,
}: {
  message: string
  setMessage: Dispatch<SetStateAction<string>>
  isGenerating: boolean
  status: string
  handleSend: () => void
  handleKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  handlePaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void
  placeholderText: string
  uploadingItems: UploadingItem[]
  setUploadingItems: Dispatch<SetStateAction<UploadingItem[]>>
  imageUrls: string[]
  setImageUrls: Dispatch<SetStateAction<string[]>>
  videoUrls: string[]
  setVideoUrls: Dispatch<SetStateAction<string[]>>
  audioUrls: string[]
  setAudioUrls: Dispatch<SetStateAction<string[]>>
  selectedImages: File[]
  hasMedia: boolean
  showUploadPopover: boolean
  setShowUploadPopover: Dispatch<SetStateAction<boolean>>
  showSettingsPopover: boolean
  setShowSettingsPopover: Dispatch<SetStateAction<boolean>>
  setShowLinkInput: Dispatch<SetStateAction<boolean>>
  fileInputRef: { current: HTMLInputElement | null }
  textareaRef: { current: HTMLTextAreaElement | null }
  handleFileSelect: (e: ChangeEvent<HTMLInputElement>) => void
  openLibrary: () => void
  fetchStorageInfo: () => Promise<StorageUsageInfo | null>
  openPreview: (url: string) => void
  openPreviewAt: (index: number) => void
  removeImageUrl: (index: number) => void
  setPreviewImage: Dispatch<SetStateAction<string | null>>
  setStorageLimitInfo: Dispatch<SetStateAction<StorageUsageInfo | null>>
  storageLimitInfo: StorageUsageInfo | null
  setIsSignInDialogOpen: Dispatch<SetStateAction<boolean>>
  subscriptionPlan: string | null
  videoModel: string
  setVideoModel: Dispatch<SetStateAction<string>>
  videoResolution: string
  setVideoResolution: Dispatch<SetStateAction<string>>
  generationMode: string
  setGenerationMode: Dispatch<SetStateAction<string>>
  aspectRatio: string
  setAspectRatio: Dispatch<SetStateAction<string>>
  duration: string
  setDuration: Dispatch<SetStateAction<string>>
  videoStyle: string
  setVideoStyle: Dispatch<SetStateAction<string>>
  pointsCost: number
}) {
  // 类型化别名:动态键(videoModelMap/videoStyleMap)直传,免去逐处强转(编译期收窄,运行期同一函数)
  const t = useTranslations("operate") as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string
  const characterCount = message.length
  const isNearLimit = characterCount > MAX_CHARACTERS * 0.9

  return (
    <div
              className={cn(
                "rounded-[28px]",
                "max-w-2xl mx-auto",
                "bg-background/95 backdrop-blur-md border border-border",
                "px-6 py-8",
                "focus-within:ring-2 focus-within:ring-primary/20",
                "transition-all duration-300",
                "shadow-2xl shadow-primary/5",
              )}
            >
              {(uploadingItems.length > 0 || imageUrls.length > 0) && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {/* 上传中的缩略图 */}
                  {uploadingItems.filter((it) => it.status !== "done").map((it) => (
                    <div key={`upload-${it.id}`} className="relative w-20 h-20 rounded-lg border bg-muted overflow-hidden group cursor-pointer" onClick={() => it.url ? openPreview(it.url) : setPreviewImage(it.localUrl)}>
                      {it.type === "audio" ? (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-purple-500/20 to-pink-500/20 text-foreground">
                          <Music className="w-7 h-7" />
                          <span className="text-[10px] mt-1 px-1 truncate max-w-full">{it.filename}</span>
                        </div>
                      ) : it.type === "video" ? (
                        <video
                          src={it.url || it.localUrl}
                          muted
                          playsInline
                          className="w-full h-full object-cover transition-transform group-hover:scale-105 opacity-90"
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- 自 operate.tsx 逐字搬移的存量债务（T12）
                        <img
                          src={it.url || it.localUrl || "/placeholder.svg"}
                          alt={t("preview", { index: 1 })}
                          className="w-full h-full object-cover transition-transform group-hover:scale-105 opacity-90"
                        />
                      )}
                      {it.status === "uploading" && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <Loader2 className="w-5 h-5 animate-spin text-white" />
                        </div>
                      )}
                      {it.status === "error" && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-xs">
                          {t("uploadError") ?? "Upload failed"}
                        </div>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          // remove from uploading items; if already has remote url, also remove from imageUrls
                          setUploadingItems((prev) => prev.filter((x) => x.id !== it.id))
                          if (it.url) {
                            if (it.type === "image") {
                              setImageUrls((prev) => prev.filter((u) => u !== it.url))
                            } else if (it.type === "video") {
                              setVideoUrls((prev) => prev.filter((u) => u !== it.url))
                            } else if (it.type === "audio") {
                              setAudioUrls((prev) => prev.filter((u) => u !== it.url))
                            }
                          }
                        }}
                        className="absolute top-1 right-1 w-5 h-5 bg-background/80 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}

                  {/* 远端已上传缩略图 */}
                  {imageUrls.map((url, index) => (
                    <div key={`url-thumb-${index}`} className="relative w-20 h-20 rounded-lg border bg-muted overflow-hidden group cursor-pointer" onClick={() => openPreviewAt(index)}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- 自 operate.tsx 逐字搬移的存量债务（T12） */}
                      <img
                        src={url || "/placeholder.svg"}
                        alt={t("preview", { index: index + 1 })}
                        className="w-full h-full object-cover transition-transform group-hover:scale-105"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          removeImageUrl(index)
                        }}
                        className="absolute top-1 right-1 w-5 h-5 bg-background/80 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}

                  {/* 已上传的视频缩略图 */}
                  {videoUrls.map((url, index) => (
                    <div key={`video-thumb-${index}`} className="relative w-20 h-20 rounded-lg border bg-muted overflow-hidden group">
                      <video
                        src={url}
                        muted
                        playsInline
                        className="w-full h-full object-cover transition-transform group-hover:scale-105"
                      />
                      <div className="absolute top-1 left-1 px-1.5 py-0.5 text-[10px] rounded bg-primary text-primary-foreground flex items-center gap-0.5">
                        <Video className="w-2.5 h-2.5" />
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setVideoUrls((prev) => prev.filter((_, i) => i !== index))
                        }}
                        className="absolute top-1 right-1 w-5 h-5 bg-background/80 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}

                  {/* 已上传的音频缩略图 */}
                  {audioUrls.map((url, index) => (
                    <div key={`audio-thumb-${index}`} className="relative w-20 h-20 rounded-lg border bg-muted overflow-hidden group">
                      <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-purple-500/20 to-pink-500/20 text-foreground">
                        <Music className="w-7 h-7" />
                      </div>
                      <div className="absolute top-1 left-1 px-1.5 py-0.5 text-[10px] rounded bg-primary text-primary-foreground flex items-center gap-0.5">
                        <Music className="w-2.5 h-2.5" />
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setAudioUrls((prev) => prev.filter((_, i) => i !== index))
                        }}
                        className="absolute top-1 right-1 w-5 h-5 bg-background/80 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 输入框 */}
              <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => {
              if (e.target.value.length <= MAX_CHARACTERS) {
                setMessage(e.target.value)
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholderText}
            rows={1}
            className={cn(
              "w-full bg-transparent",
              "text-foreground placeholder:text-muted-foreground placeholder:text-sm",
              "resize-none outline-none",
              "text-base leading-7",
              "max-h-32 overflow-y-auto",
              "mb-4",
              "placeholder:whitespace-normal placeholder:break-words",
            )}
            style={{
              minHeight: "48px",
              height: "auto",
            }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement
              target.style.height = "auto"
              target.style.height = target.scrollHeight + "px"
            }}
            onPaste={handlePaste}
              />

              {/* 冷启动示例：输入为空时展示可一键填充的创作示例 */}
              {!message && !isGenerating && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {(['a', 'b', 'c'] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setMessage(t(`examplePrompts.${key}`))
                        textareaRef.current?.focus()
                      }}
                      className="px-3 py-1.5 rounded-full border border-border bg-card text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer"
                    >
                      {t(`examplePrompts.${key}`)}
                    </button>
                  ))}
                </div>
              )}

              {characterCount > 0 && (
                <div className="mb-3 flex justify-end">
                  <span
                    className={cn("text-xs transition-colors", isNearLimit ? "text-destructive" : "text-muted-foreground")}
                  >
                    {characterCount} / {MAX_CHARACTERS}
                  </span>
                </div>
              )}

              <div className="flex flex-row items-center gap-3 overflow-x-auto whitespace-nowrap">
              {/* 上传按钮 */}
                <Popover open={showUploadPopover} onOpenChange={setShowUploadPopover}>
                  <PopoverTrigger asChild>
                    <button
                      className={cn(
                        "w-10 h-10 rounded-full flex-shrink-0",
                        "hover:bg-primary hover:shadow-lg hover:shadow-primary/20",
                        "transition-all duration-200",
                        "flex items-center justify-center"
                      )}
                      aria-label={t("addImage")}
                      onClick={async () => {
                        if (status !== "authenticated") {
                          setIsSignInDialogOpen(true)
                          return
                        }
                        // 打开时刷新存储空间信息
                        const info = await fetchStorageInfo()
                        if (info) {
                          setStorageLimitInfo({
                            usedStorage: info.usedStorage,
                            storageLimit: info.storageLimit,
                            availableStorage: info.availableStorage,
                          })
                        }
                        setShowUploadPopover(true)
                      }}
                    >
                      <Plus className="w-5 h-5 text-muted-foreground hover:text-white transition-colors" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="top" sideOffset={12} avoidCollisions={true} className="w-full md:w-64 p-3" align="start">
                    <div className="space-y-3">
                      {/* 存储空间使用情况 */}
                      <div className="bg-muted/50 rounded-lg p-2 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <HardDrive className="w-3.5 h-3.5" />
                            <span>{t("storageUsed")}</span>
                          </div>
                          <span className="font-medium">
                            {storageLimitInfo ? `${formatBytes(storageLimitInfo.usedStorage)} / ${formatBytes(storageLimitInfo.storageLimit)}` : '...'}
                          </span>
                        </div>
                        <Progress value={storageLimitInfo && storageLimitInfo.storageLimit > 0 ? (storageLimitInfo.usedStorage / storageLimitInfo.storageLimit) * 100 : 0} className="h-1.5" />
                      </div>

                      <p className="text-xs text-muted-foreground px-1 text-center">
                        {t("uploadFileTypeTip", { limit: Math.round(computeFileSizeLimit(subscriptionPlan) / (1024 * 1024)) })}
                      </p>
                      <button
                        onClick={() => {
                          setShowUploadPopover(false)
                          fileInputRef.current?.click()
                        }}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-primary hover:text-primary-foreground border border-border hover:border-primary transition-all duration-200"
                      >
                        <Upload className="w-4 h-4" />
                        {t("upload")}
                      </button>
                      <button
                        onClick={() => {
                          setShowUploadPopover(false)
                          openLibrary()
                        }}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-primary hover:text-primary-foreground border border-border hover:border-primary transition-all duration-200"
                      >
                        <FolderOpen className="w-4 h-4" />
                        {t("selectFromLibrary")}
                      </button>
                      <button
                        onClick={() => {
                          setShowUploadPopover(false)
                          setShowLinkInput(true)
                        }}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-primary hover:text-primary-foreground border border-border hover:border-primary transition-all duration-200"
                      >
                        <Link className="w-4 h-4" />
                        {t("inputLink")}
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,audio/*,video/*"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />

                <CreateSettingsPanel
                  showSettingsPopover={showSettingsPopover}
                  setShowSettingsPopover={setShowSettingsPopover}
                  hasMedia={hasMedia}
                  videoModel={videoModel}
                  setVideoModel={setVideoModel}
                  videoResolution={videoResolution}
                  setVideoResolution={setVideoResolution}
                  generationMode={generationMode}
                  setGenerationMode={setGenerationMode}
                  aspectRatio={aspectRatio}
                  setAspectRatio={setAspectRatio}
                  duration={duration}
                  setDuration={setDuration}
                  videoStyle={videoStyle}
                  setVideoStyle={setVideoStyle}
                />

                {/* 右侧按钮组 */}
                <div className="flex flex-row items-center gap-2 md:ml-auto w-full md:w-auto overflow-x-auto whitespace-nowrap">

                  {/* TODO: 测试阶段暂时注释积分显示，正式上线时取消注释 */}
                  {/* 移动端积分提示 */}
                  {/* <div className="md:hidden flex items-center gap-1 px-3 py-2 bg-primary/10 border border-primary/20 rounded-full text-sm text-primary h-10">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                    </svg>
                    <span>{t("pointsShort", { points: pointsCost })}</span>
                  </div> */}

                  {/* 桌面端积分提示 */}
                  {/* <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/20 rounded-full text-sm text-primary h-9">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                    </svg>
                    <span>{t("pointsLabel", { points: pointsCost })}</span>
                  </div> */}

                  {/* 生成按钮 */}
                  <Button
                    onClick={handleSend}
                    disabled={(!message.trim() && selectedImages.length === 0 && imageUrls.length === 0) || isGenerating}
                    className={cn(
                      "inline-flex w-10 h-10 md:w-auto md:px-6 md:py-2 rounded-full flex-shrink-0 ml-auto md:ml-0",
                      "bg-primary hover:bg-primary/90",
                      "disabled:opacity-50 disabled:cursor-not-allowed",
                      "transition-all",
                      "shadow-lg shadow-primary/20",
                      "flex items-center justify-center gap-2"
                    )}
                    aria-label={t("sendMessage")}
                  >
                    {isGenerating ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    <span className="hidden md:inline text-sm font-medium">
                      {isGenerating ? t("generating") : t("applyEdit")}
                      {!isGenerating && (
                        <span className="opacity-80 font-normal ml-1">· {t("estimatedPoints", { points: pointsCost })}</span>
                      )}
                    </span>
                  </Button>
                </div>

              </div>
            </div>
  )
}
