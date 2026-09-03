"use client"

import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import type { CharacterItem, ComposedVideoResult, SceneVideoItem, ScriptData, StoryboardItem } from "@/lib/types"

type WorkflowStep = 'idle' | 'script' | 'character' | 'storyboard' | 'scenes' | 'video'

/**
 * 工作流步骤指示器/步骤1 剧情展示/步骤5 完整视频展示
 * （自 operate.tsx JSX 拆出，拆分 T13）。JSX 逐字搬移;
 * 全部状态与事件处理器由调用方注入(props 与原绑定同名),零自身业务逻辑。
 * 步骤2-4（主角/分镜/场景视频展示）归 T18,仍在 operate.tsx。
 */

/** 步骤指示器 + 工作流控制按钮 + 继续生成按钮 + 生成中提示 */
export function WorkflowHeader({
  workflowStep,
  workflowPaused,
  workflowLoading,
  isGenerating,
  scriptData,
  characterData,
  storyboardImages,
  sceneVideos,
  videoData,
  resumeProjectId,
  restoredVersionHasVideo,
  restoredProjectCompleted,
  handlePauseResumeWorkflow,
  handleResumeContinue,
}: {
  workflowStep: WorkflowStep
  workflowPaused: boolean
  workflowLoading: boolean
  isGenerating: boolean
  scriptData: ScriptData | null
  characterData: CharacterItem[] | null
  storyboardImages: StoryboardItem[]
  sceneVideos: SceneVideoItem[]
  videoData: ComposedVideoResult | null
  resumeProjectId?: string | null
  restoredVersionHasVideo: boolean
  restoredProjectCompleted: boolean
  handlePauseResumeWorkflow: () => void
  handleResumeContinue: () => void
}) {
  const t = useTranslations("operate")
  const tWorkflow = useTranslations("operate.workflow")

  return (
    <>
              {/* 步骤指示器 */}
              <div className="flex flex-col sm:flex-row gap-2 md:gap-3 overflow-x-auto justify-center items-center">
                <div className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border transition-all",
                  workflowStep === 'script' ? "bg-primary/10 border-primary" : scriptData ? "bg-green-500/10 border-green-500" : "bg-muted border-border"
                )}>
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                    workflowStep === 'script' ? "bg-primary text-primary-foreground" : scriptData ? "bg-green-500 text-white" : "bg-muted-foreground/20 text-muted-foreground"
                  )}>
                    {scriptData ? "✓" : "1"}
                  </div>
                  <span className="text-sm font-medium">{t("generateScriptWithCount", { count: scriptData?.scenes?.length || 0 })}</span>
                  {workflowStep === 'script' && workflowLoading && <Loader2 className="w-4 h-4 animate-spin ml-auto" />}
                </div>

                <div className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border transition-all",
                  workflowStep === 'character' ? "bg-primary/10 border-primary" : (characterData && characterData.length > 0) ? "bg-green-500/10 border-green-500" : "bg-muted border-border"
                )}>
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                    workflowStep === 'character' ? "bg-primary text-primary-foreground" : (characterData && characterData.length > 0) ? "bg-green-500 text-white" : "bg-muted-foreground/20 text-muted-foreground"
                  )}>
                    {(characterData && characterData.length > 0) ? "✓" : "2"}
                  </div>
                  <span className="text-sm font-medium">{t("generateCharacterWithCount", { count: characterData?.length || 0 })}</span>
                  {workflowStep === 'character' && workflowLoading && <Loader2 className="w-4 h-4 animate-spin ml-auto" />}
                </div>

                <div className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border transition-all",
                  workflowStep === 'storyboard' ? "bg-primary/10 border-primary" : storyboardImages.length > 0 ? "bg-green-500/10 border-green-500" : "bg-muted border-border"
                )}>
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                    workflowStep === 'storyboard' ? "bg-primary text-primary-foreground" : storyboardImages.length > 0 ? "bg-green-500 text-white" : "bg-muted-foreground/20 text-muted-foreground"
                  )}>
                    {storyboardImages.length > 0 ? "✓" : "3"}
                  </div>
                  <span className="text-sm font-medium">{t("generateStoryboardWithCount", { count: storyboardImages?.length || 0 })}</span>
                  {workflowStep === 'storyboard' && workflowLoading && <Loader2 className="w-4 h-4 animate-spin ml-auto" />}
                </div>

                <div className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border transition-all",
                  workflowStep === 'scenes' ? "bg-primary/10 border-primary" : sceneVideos.length > 0 ? "bg-green-500/10 border-green-500" : "bg-muted border-border"
                )}>
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                    workflowStep === 'scenes' ? "bg-primary text-primary-foreground" : sceneVideos.length > 0 ? "bg-green-500 text-white" : "bg-muted-foreground/20 text-muted-foreground"
                  )}>
                    {sceneVideos.length > 0 ? "✓" : "4"}
                  </div>
                  <span className="text-sm font-medium">{t("generateSceneVideoWithCount", { count: sceneVideos?.length || 0 })}</span>
                  {workflowStep === 'scenes' && workflowLoading && <Loader2 className="w-4 h-4 animate-spin ml-auto" />}
                </div>

                <div className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border transition-all",
                  workflowStep === 'video' ? "bg-primary/10 border-primary" : videoData ? "bg-green-500/10 border-green-500" : "bg-muted border-border"
                )}>
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                    workflowStep === 'video' ? "bg-primary text-primary-foreground" : videoData ? "bg-green-500 text-white" : "bg-muted-foreground/20 text-muted-foreground"
                  )}>
                    {videoData ? "✓" : "5"}
                  </div>
                  <span className="text-sm font-medium">{t('workflow.step5')} ({videoData ? 1 : 0})</span>
                  {workflowStep === 'video' && workflowLoading && <Loader2 className="w-4 h-4 animate-spin ml-auto" />}
                </div>

                {/* 工作流控制按钮 */}
                {isGenerating && (
                  <div className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg border transition-all cursor-pointer",
                    workflowPaused ? "bg-primary/10 border-primary" : "bg-muted border-border hover:bg-muted/80"
                  )} onClick={() => {
                    console.log('暂停按钮被点击')
                    handlePauseResumeWorkflow()
                  }}>
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                      workflowPaused ? "bg-primary text-primary-foreground" : "bg-muted-foreground/20 text-muted-foreground"
                    )}>
                      {workflowPaused ? "▶" : "⏸"}
                    </div>
                    <span className="text-sm font-medium">
                      {workflowPaused ? t("resumeWorkflow") : t("pauseWorkflow")}
                    </span>
                  </div>
                )}

                {/* 继续生成按钮 - 仅恢复项目显示（仅当恢复的版本没有最终视频且项目未完成时显示） */}
                {resumeProjectId && !isGenerating && !workflowPaused && !restoredVersionHasVideo && !restoredProjectCompleted && (
                  <div
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-lg border transition-all cursor-pointer",
                      "bg-muted border-border hover:bg-muted/80"
                    )}
                    onClick={handleResumeContinue}
                  >
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-primary text-primary-foreground">
                      ▶
                    </div>
                    <span className="text-sm font-medium">
                      {t("resume.continueButton")}
                    </span>
                  </div>
                )}
              </div>

              {/* 生成过程中显示的提示 */}
              {workflowLoading && (
                <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800">
                  <p className="text-sm text-blue-700 dark:text-blue-300 text-center">
                    💡 {tWorkflow("generationTip")}
                  </p>
                </div>
              )}
    </>
  )
}

/** 步骤1: 剧情展示 */
export function ScriptStep({
  scriptData,
  workflowLoading,
  workflowPaused,
  handleShowRegenerateScriptDialog,
}: {
  scriptData: ScriptData | null
  workflowLoading: boolean
  workflowPaused: boolean
  handleShowRegenerateScriptDialog: () => void
}) {
  const t = useTranslations("operate")

  return (
    <>
              {/* 步骤1: 剧情展示 */}
              {scriptData && (
                <div className="p-6 rounded-lg bg-muted/50 border border-border space-y-4">
                  {/* 标题和基本信息 */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h3 className="text-lg font-bold mb-2">📝 {scriptData.title}</h3>
                      <div className="flex flex-col md:flex-row gap-2 text-sm text-muted-foreground">
                        <div className="w-full md:w-auto whitespace-nowrap">{t("totalDurationLabel", { duration: String(scriptData.totalDuration ?? '') })}</div>
                        <div className="w-full md:w-auto whitespace-nowrap">{t("aspectRatioDisplay", { ratio: String(scriptData.aspectRatio ?? '') })}</div>
                        <div className="w-full md:w-auto whitespace-nowrap">{t("sceneCountDisplay", { count: scriptData.scenes?.length || 0 })}</div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {/* 编辑功能已禁用 */}
                      {/* <Button
                        variant="outline"
                        size="sm"
                        onClick={handleStartEditScript}
                        disabled={workflowLoading}
                        className="h-8 text-xs"
                      >
                        <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        {t("editScriptButton")}
                      </Button> */}
                    </div>
                  </div>

                  {/* 场景详细列表 */}
                  <div className="space-y-4">
                    <h4 className="font-semibold text-sm flex items-center gap-2">
                      <span className="w-2 h-2 bg-primary rounded-full"></span>
                      {t("scriptDetailsWithCount", { count: scriptData?.scenes?.length || 0 })}
                    </h4>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- 自 operate.tsx 逐字搬移的存量类型（T13） */}
                    {scriptData.scenes?.map((scene: any, _index: number) => (
                      <div key={scene.id} className="p-4 rounded-lg bg-background/50 border border-border space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 border border-primary/20">
                            <span className="text-sm font-bold text-primary">{scene.id}</span>
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-medium">{t("sceneNumberDisplay", { number: scene.id })}</span>
                              <span className="text-muted-foreground">•</span>
                              <span className="text-muted-foreground">{t("durationSeconds", { count: scene.duration })}</span>
                            </div>
                          </div>
                        </div>

                        {/* 剧情描述 */}
                        {scene.plot && (
                          <div>
                            <div className="text-sm font-medium mb-2 flex items-center gap-2">
                              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                              {t("scenePlotLabel")}
                            </div>
                            <div className="p-3 rounded-lg bg-blue-50/50 border border-blue-200/50">
                              <p className="text-sm text-blue-900 leading-relaxed">{scene.plot}</p>
                            </div>
                          </div>
                        )}

                      </div>
                    ))}
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex gap-2 pt-4 border-t border-border">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleShowRegenerateScriptDialog}
                      disabled={workflowLoading || workflowPaused}
                      className="flex-1"
                    >
                      {workflowLoading ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      )}
                      {t("regenerateAllScriptButton")}
                    </Button>
                  </div>
                </div>
              )}
    </>
  )
}

/** 步骤5: 完整视频展示 + 错误提示 */
export function FinalVideoStep({
  videoData,
  workflowLoading,
  workflowStep,
  workflowError,
  scriptData,
  downloadingKey,
  handleDownloadFile,
}: {
  videoData: ComposedVideoResult | null
  workflowLoading: boolean
  workflowStep: WorkflowStep
  workflowError: string | null
  scriptData: ScriptData | null
  downloadingKey: string | null
  handleDownloadFile: (url?: string, filename?: string, key?: string) => void
}) {
  const t = useTranslations("operate")
  const tWorkflow = useTranslations("operate.workflow")

  return (
    <>
              {/* 步骤5: 完整视频展示（仅在已生成完整视频时显示） */}
              {videoData ? (
                <div className="p-4 rounded-lg bg-muted/50 border border-border space-y-3">
                  <div>
                    <h3 className="text-sm font-bold mb-2">🎬 {tWorkflow("videoTitle")}</h3>
                    <video
                      src={videoData.url}
                      controls
                      className="w-full rounded-lg"
                      poster={videoData.thumbnailUrl}
                    />
                    <div className="mt-2 text-xs text-muted-foreground">
                      <div className="flex flex-col sm:flex-row gap-2 min-w-0">
                        <div className="w-full sm:w-auto whitespace-nowrap">
                          {tWorkflow("videoDuration", { duration: String(videoData.duration ?? '') })}
                        </div>
                        <div className="w-full sm:w-auto whitespace-nowrap">
                          {tWorkflow("videoAspectRatio", { ratio: String(videoData.aspectRatio ?? '') })}
                        </div>
                        <div className="w-full sm:w-auto whitespace-nowrap">
                          {tWorkflow("videoSize", { size: String(videoData.fileSize ?? '') })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 操作按钮（移动端每行一个，移除“重新生成”） */}
                  <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border min-w-0">
                    <Button
                      size="sm"
                      variant="default"
                      className="w-full sm:flex-1 min-w-0"
                      onClick={() => {
                        const key = 'total-video'
                        handleDownloadFile(videoData.url, `${scriptData?.title || 'video'}.mp4`, key)
                      }}
                    >
                      {downloadingKey === 'total-video' ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          {t("downloading")}
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          {t("downloadVideo")}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ) : (workflowLoading && workflowStep === 'video') ? (
                <div className="p-4 rounded-lg bg-muted/50 border border-border space-y-3">
                  <div>
                    <h3 className="text-sm font-bold mb-2">🎬 {tWorkflow("videoTitle")}</h3>
                    <div className="w-full rounded-lg bg-muted/30 h-48 flex items-center justify-center relative">
                      <div className="text-center">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 200 120"
                          className="mx-auto w-full max-w-xs h-28 text-muted-foreground"
                          role="img"
                          aria-label={t("videoTitle") + " " + t("previewImageAlt")}
                        >
                          <rect x="2" y="2" width="196" height="116" rx="8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.06" />
                          <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
                            <path d="M20 20 L180 100" opacity="0.12" />
                            <path d="M20 100 L180 20" opacity="0.08" />
                          </g>
                        </svg>
                      </div>
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                        <div className="flex items-center gap-2 text-white">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {tWorkflow("generatingVideo")}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* 错误提示 */}
              {workflowError && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive text-destructive text-sm">
                  ❌ {workflowError}
                </div>
              )}
    </>
  )
}
