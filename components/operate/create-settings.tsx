"use client"

import { useTranslations } from "next-intl"
import type { Dispatch, SetStateAction } from "react"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SlidersHorizontal } from "lucide-react"
import {
  VIDEO_MODEL_I18N_KEYS as videoModelMap,
  VIDEO_MODEL_OPTION_ORDER,
  VIDEO_MODEL_RESOLUTIONS,
  MEDIA_COMPATIBLE_VIDEO_MODELS,
  FIRST_LAST_FRAME_UNSUPPORTED_MODELS,
} from "@/lib/providers/video-models"

/** 视频风格映射（自 operate.tsx 组件级定义迁入，拆分 T12） */
const videoStyleMap: Record<string, string> = {
  auto: "auto",
  anime: "videoStyleAnime",
  hollywood: "videoStyleHollywood",
  ads: "videoStyleAdsEducation"
}

/**
 * 参数设置面板（自 operate.tsx JSX 拆出，拆分 T12；自 create-panel 再拆以守 ~500 行压力线）。
 * 视频模型/分辨率/生成模式/画面比例/时长/风格选择与当前选择摘要。
 * JSX 逐字搬移;状态由调用方注入(props 与原绑定同名),零自身业务逻辑。
 */
export function CreateSettingsPanel({
  showSettingsPopover,
  setShowSettingsPopover,
  hasMedia,
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
}: {
  showSettingsPopover: boolean
  setShowSettingsPopover: Dispatch<SetStateAction<boolean>>
  hasMedia: boolean
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
}) {
  // 类型化别名:动态键(videoModelMap/videoStyleMap)直传,免去逐处强转(编译期收窄,运行期同一函数)
  const t = useTranslations("operate") as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string

  return (
    <>
                {/* 参数设置面板 */}
                <Popover open={showSettingsPopover} onOpenChange={setShowSettingsPopover}>
                  <PopoverTrigger asChild>
                    <button className="w-auto min-w-[100px] h-9 px-3 rounded-full border border-border bg-background hover:bg-background/80 hover:border-primary/40 hover:shadow-md transition-all duration-200 flex items-center gap-1 flex-shrink-0 justify-center" aria-label={t("params")}>
                      <SlidersHorizontal className="w-4 h-4 text-primary flex-shrink-0" />
                      <span className="hidden md:inline text-sm font-medium flex-1 text-center whitespace-nowrap">
                        {videoModel !== "auto"
                          ? t(videoModelMap[videoModel])
                          : videoStyle !== "auto"
                          ? t(videoStyleMap[videoStyle])
                          : t("params")}
                        {videoStyle !== "auto" && videoModel !== "auto" && ` · ${t(videoStyleMap[videoStyle])}`}
                        {aspectRatio && ` · ${aspectRatio}`}
                        {duration !== "auto" && ` · ${duration}s`}
                      </span>
                      <span className="md:hidden text-sm font-medium text-primary">{t("params")}</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="bottom" sideOffset={12} avoidCollisions={true} className="w-80 p-4 max-h-[50vh] overflow-y-auto" align="start">
                    <div className="space-y-4">

                      {/* 视频模型 */}
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">{t("videoModel")}</label>
                        {hasMedia && (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            {t("videoModelMediaLockedHint")}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1">
                          {(() => {
                            const allowed = (k: string) => !hasMedia || MEDIA_COMPATIBLE_VIDEO_MODELS.includes(k)
                            return VIDEO_MODEL_OPTION_ORDER.map((key) => ({
                              key,
                              label: key === "auto" ? t("videoModelAuto") : t(videoModelMap[key]),
                            })).map((item) => {
                              const disabled = !allowed(item.key)
                              return (
                                <button
                                  key={item.key}
                                  onClick={() => {
                                    if (disabled) return
                                    setVideoModel(item.key)
                                    // 切换模型后分辨率回落默认档（新模型可能不支持原档位）
                                    if (!VIDEO_MODEL_RESOLUTIONS[item.key]?.includes(videoResolution)) {
                                      setVideoResolution("720p")
                                    }
                                  }}
                                  disabled={disabled}
                                  title={disabled ? t("videoModelMediaLockedTooltip") : undefined}
                                  className={cn(
                                    "px-2.5 py-1 text-xs rounded-full border transition-all duration-200",
                                    videoModel === item.key
                                      ? "bg-primary text-primary-foreground border-primary"
                                      : "border-border bg-background hover:border-primary",
                                    disabled && "opacity-40 cursor-not-allowed hover:border-border"
                                  )}
                                >
                                  {item.label}
                                </button>
                              )
                            })
                          })()}
                        </div>
                      </div>

                      {/* 分辨率（仅支持多档的模型显示；单价随档位变化，480p≈6折/1080p≈1.5×起） */}
                      {VIDEO_MODEL_RESOLUTIONS[videoModel] && (
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">{t("videoResolution")}</label>
                          <div className="flex flex-wrap gap-1">
                            {VIDEO_MODEL_RESOLUTIONS[videoModel].map((res) => (
                              <button
                                key={res}
                                onClick={() => setVideoResolution(res)}
                                className={cn(
                                  "px-2.5 py-1 text-xs rounded-full border transition-all duration-200",
                                  videoResolution === res
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "border-border bg-background hover:border-primary"
                                )}
                              >
                                {res.toUpperCase()}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 生成模式 */}
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">{t("generationMode")}</label>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => setGenerationMode("auto")}
                            className={cn(
                              "px-3 py-1 text-xs rounded-full border transition-all duration-200",
                              generationMode === "auto"
                                ? "bg-primary text-primary-foreground border-primary"
                                : "border-border bg-background hover:border-primary"
                            )}
                          >
                            {t("generationModeAuto")}
                          </button>
                          <button
                            onClick={() => !FIRST_LAST_FRAME_UNSUPPORTED_MODELS.includes(videoModel) && setGenerationMode("first-last-frame")}
                            disabled={FIRST_LAST_FRAME_UNSUPPORTED_MODELS.includes(videoModel)}
                            className={cn(
                              "px-3 py-1 text-xs rounded-full border transition-all duration-200",
                              FIRST_LAST_FRAME_UNSUPPORTED_MODELS.includes(videoModel)
                                ? "bg-muted text-muted-foreground border-muted cursor-not-allowed opacity-50"
                                : generationMode === "first-last-frame"
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "border-border bg-background hover:border-primary"
                            )}
                          >
                            {t("generationModeFirstLast")}
                          </button>
                        </div>
                      </div>

                      {/* 画面比例 */}
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">{t("aspectRatio")}</label>
                        <div className="flex gap-1">
                          {["16:9", "9:16"].map((r) => (
                            <button
                              key={r}
                              onClick={() => setAspectRatio(r)}
                              className={cn(
                                "px-2.5 py-1 text-xs rounded-full border transition-all duration-200",
                                aspectRatio === r
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "border-border bg-background hover:border-primary"
                              )}
                            >
                              {r === "auto" ? t("auto") : r}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 时长 */}
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">{t("duration")}</label>
                        <div className="flex gap-1">
                          {["auto", "15", "30", "60"].map((r) => (
                            <button
                              key={r}
                              onClick={() => setDuration(r)}
                              className={cn(
                                "px-2.5 py-1 text-xs rounded-full border transition-all duration-200",
                                duration === r
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "border-border bg-background hover:border-primary"
                              )}
                            >
                              {r === "auto" ? t("auto") : `${r}${t("seconds")}`}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 视频风格 */}
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">{t("videoStyle")}</label>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(videoStyleMap).map(([key, translationKey]) => (
                            <button
                              key={key}
                              onClick={() => setVideoStyle(key)}
                              className={cn(
                                "px-2.5 py-1 text-xs rounded-full border transition-all duration-200",
                                videoStyle === key
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "border-border bg-background hover:border-primary"
                              )}
                            >
                              {t(translationKey)}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 当前选择 */}
                      <div className="pt-2 border-t border-border">
                        <div className="text-xs text-muted-foreground mb-1.5">{t("currentSelection")}</div>
                        <div className="flex flex-wrap gap-1.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary border border-primary/20">
                            {t("videoModel")}: {videoModel === "auto" ? t("videoModelAuto") : t(videoModelMap[videoModel])}
                          </span>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary border border-primary/20">
                            {t("generationMode")}: {generationMode === "auto" ? t("generationModeAuto") : t("generationModeFirstLast")}
                          </span>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary border border-primary/20">
                            {t("aspectRatio")}: {aspectRatio}
                          </span>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary border border-primary/20">
                            {t("duration")}: {duration === "auto" ? t("auto") : `${duration}${t("seconds")}`}
                          </span>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary border border-primary/20">
                            {t("videoStyle")}: {t(videoStyleMap[videoStyle])}
                          </span>
                        </div>
                      </div>

                    </div>
                  </PopoverContent>
                </Popover>
    </>
  )
}
