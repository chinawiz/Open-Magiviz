"use client"

/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @next/next/no-img-element -- JSX 逐字搬移自 operate.tsx 的存量弱类型(拆分 T18);逐处改类型将淹没「只移动不改行为」的 diff 证明,随后续清理票收敛 */

import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Loader2, ChevronLeft, ChevronRight, Eye, Download } from "lucide-react"
import type { SceneVideoItem, StoryboardItem } from "@/lib/types"

/**
 * 结果展示区(自 operate.tsx JSX 拆出,拆分 T18):
 * 步骤2 主角列表 + 每个剧情一行三栏的合并展示(剧情详情/分镜图轮播/场景视频)。
 * JSX 逐字搬移;全部状态与事件处理器由调用方注入(props 与原绑定同名),零自身业务逻辑。
 * 【压力线偏差】本文件 ~700 行超 ~500 压力线:三栏与行循环局部变量强耦合,
 * 按栏拆文件是伪分离(肢解循环闭包、行为风险>收益),故保持单组件,理由记票面。
 */
export function ResultPanels({
  workflowStep,
  scriptData,
  characterData,
  storyboardImages,
  sceneVideos,
  downloadingKey,
  isRegeneratingCharacterId,
  isRegeneratingSceneVideo,
  isRegeneratingStoryboard,
  storyboardCarouselPositions,
  workflowLoading,
  workflowPaused,
  handleDownloadFile,
  handleShowRegenerateCharacterDialog,
  handleShowRegenerateStoryboardDialog,
  handleShowRegenerateSceneVideoDialog,
  handleStartEditCharacter,
  handleStartEditStoryboard,
  handleStartEditSceneVideo,
  regenerateSingleFrame,
  setStoryboardCarouselPositions,
  setEditedCharacterData,
  setEditedSceneVideoData,
  setEditingSceneVideoIndex,
  setEditingStoryboardIndex,
  setIsEditingCharacter,
  setIsEditingSceneVideo,
  setIsEditingStoryboard,
  setShowCharacterPreview,
  setShowSceneVideoPreview,
  setShowStoryboardPreview,
}: {
  workflowStep: any
  scriptData: any
  characterData: any
  storyboardImages: any
  sceneVideos: any
  downloadingKey: any
  isRegeneratingCharacterId: any
  isRegeneratingSceneVideo: any
  isRegeneratingStoryboard: any
  storyboardCarouselPositions: any
  workflowLoading: any
  workflowPaused: any
  handleDownloadFile: any
  handleShowRegenerateCharacterDialog: any
  handleShowRegenerateStoryboardDialog: any
  handleShowRegenerateSceneVideoDialog: any
  handleStartEditCharacter: any
  handleStartEditStoryboard: any
  handleStartEditSceneVideo: any
  regenerateSingleFrame: any
  setStoryboardCarouselPositions: any
  setEditedCharacterData: any
  setEditedSceneVideoData: any
  setEditingSceneVideoIndex: any
  setEditingStoryboardIndex: any
  setIsEditingCharacter: any
  setIsEditingSceneVideo: any
  setIsEditingStoryboard: any
  setShowCharacterPreview: any
  setShowSceneVideoPreview: any
  setShowStoryboardPreview: any
}) {
  const t = useTranslations("operate")

  return (
    <>
              {/* 步骤2: 主角展示 */}
              {characterData && characterData.length > 0 && (
                <div className="p-4 rounded-lg bg-muted/50 border border-border space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{t("characterListTitle", { count: characterData.length })}</span>
                  </div>

                  {/* 主角列表 */}
                  <div className="space-y-3">
                    {characterData.map((character: any, index: number) => (
                      <div key={character.id || index} className="p-3 rounded-lg bg-background border border-border">
                        <div className="flex gap-3">
                          <div className="w-12 h-12 md:w-16 md:h-16 rounded-lg overflow-hidden relative bg-muted/20 flex items-center justify-center">
                            { (character.thumbnailUrl || character.imageUrl) ? (
                            <img
                                src={character.thumbnailUrl || character.imageUrl}
                                alt={character.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" className="w-10 h-10 text-muted-foreground">
                                <rect x="4" y="4" width="92" height="92" rx="8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.06" />
                                <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
                                  <path d="M10 10 L90 90" opacity="0.12" />
                                  <path d="M10 90 L90 10" opacity="0.08" />
                                </g>
                              </svg>
                            )}

                            {/* 失败状态显示（优先显示重新生成状态，然后才是错误） */}
                            {isRegeneratingCharacterId === character.id ? (
                              <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg text-white text-xs">
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                {t("generating")}
                              </div>
                            ) : character.generationError ? (
                              <div className="absolute inset-0 bg-red-500/80 flex items-center justify-center rounded-lg text-white text-xs p-1 text-center">
                                <span className="line-clamp-2">{character.generationError}</span>
                              </div>
                            ) : (
                              /* 只要没有图片且没有错误就显示"正在生成" */
                              (workflowLoading && workflowStep === 'character' && !(character.thumbnailUrl || character.imageUrl)) ? (
                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg text-white text-xs">
                                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                  {t("generating")}
                                </div>
                              ) : null
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-bold mb-1">{t("characterNamePrefix", { name: character.name })}</h4>
                            <p className="text-xs text-muted-foreground mb-2">{character.description}</p>
                            <div className="flex flex-wrap gap-2 text-xs">
                              <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full">{character.role}</span>
                            </div>
                            {/* 提示词在查看模式下已隐藏 */}
                          </div>
                        </div>

                        {/* 单个主角的操作按钮 */}
                        <div className="flex flex-col sm:flex-row gap-2 mt-3 pt-3 border-t border-border min-w-0">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditedCharacterData(character)
                              setIsEditingCharacter(false)
                              setShowCharacterPreview(true)
                            }}
                            disabled={(!character.thumbnailUrl && !character.imageUrl) || !!character.generationError}
                            className="w-full sm:flex-1 min-w-0"
                          >
                            <Eye className="w-3 h-3 mr-1" />
                            {t("view")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const url = character.thumbnailUrl || character.imageUrl
                              const key = `character-${character.id || index}`
                              handleDownloadFile(url, `${character.name || 'character'}.png`, key)
                            }}
                            disabled={(!character.thumbnailUrl && !character.imageUrl) || !!character.generationError}
                            className="w-full sm:flex-1 min-w-0"
                          >
                            {downloadingKey === `character-${character.id || index}` ? (
                              <>
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                {t("downloading")}
                              </>
                            ) : (
                              <>
                                <Download className="w-3 h-3 mr-1" />
                                {t("download")}
                              </>
                            )}
                          </Button>
                          {/* 单个主角编辑按钮 */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleStartEditCharacter(character)}
                            disabled={workflowLoading}
                            className="w-full sm:flex-1 min-w-0"
                          >
                            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            {t("edit")}
                          </Button>
                          {/* 重新生成按钮：即使生成失败也显示，只在工作流加载时或暂停时禁用 */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleShowRegenerateCharacterDialog(character)}
                            disabled={workflowLoading || isRegeneratingCharacterId === character.id || workflowPaused}
                            className="w-full sm:flex-1 min-w-0"
                            title={workflowPaused ? t("pauseWorkflow") : ""}
                          >
                            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            {t("regenerate")}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                </div>
              )}

              {/* 合并展示：每个剧情一行三栏（剧情详情 + 分镜图 + 剧情视频） */}
              {scriptData?.scenes && scriptData.scenes.length > 0 && (storyboardImages.length > 0 || sceneVideos.length > 0 || workflowStep === 'storyboard') && (
                <div className="p-3 md:p-4 rounded-lg bg-muted/50 border border-border space-y-3">
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <span className="text-lg">🎞️</span>
                    <span>{t("scriptAndVideo")}</span>
                  </h3>
                  <div className="space-y-3">
                    {scriptData.scenes.map((scene: any, index: number) => {
                      const sb = storyboardImages[index] as StoryboardItem | undefined
                      // 提前提取，避免在外层 `sb ?` 的 else 分支里对 sb 做 truthy 收窄（TS 会窄化为 never）
                      const sbError = sb?.error
                      const sbUrl = sb?.url
                      const sv = sceneVideos.find((v: any) => v?.sceneIndex === index) || sceneVideos?.[index]
                      // 优先使用 characterIds 数组匹配，兼容旧逻辑作为后备
                      const protagonists = (characterData || []).filter((char: any) => {
                        // 方案1：直接匹配 characterIds（最可靠）
                        if (Array.isArray(scene.characterIds) && scene.characterIds.includes(char.id)) {
                          return true
                        }
                        // 方案2：匹配 plot 中的名称（后备方案，需完全匹配）
                        return (scene.plot && char.name && scene.plot.includes(char.name)) ||
                          (scene.visualElements && Array.isArray(scene.visualElements) && scene.visualElements.some((el: any) => el.type === 'character' && el.name === char.name))
                      })

                      const aspectRatioValue = sv?.aspectRatio || sb?.aspectRatio || scene.aspectRatio
                      const durationValue = sv?.duration || scene.duration

                      return (
                        <div key={scene.id || index} className="p-3 md:p-4 rounded-md bg-background/50 border border-border">
                          <div className="flex flex-col md:flex-row gap-3">
                            {/* 第一栏：剧情详情 + 引用主角 */}
                            <div className="w-full md:w-1/4 min-w-0">
                          <div className="p-3 bg-background/50 border border-border rounded-md h-full">
                              <h4 className="text-sm font-medium mb-1">
                                {t("sceneWithIndex", { index: index + 1 })}
                                <span className="text-xs font-normal text-muted-foreground ml-2">
                                  {t("aspectRatioAndDuration", { ratio: aspectRatioValue || '—', duration: durationValue ? `${durationValue}秒` : '—' })}
                                </span>
                              </h4>
                              <div className="text-xs text-muted-foreground">
                                {scene.plot || <span className="text-muted-foreground">{t('noPlotDescription')}</span>}
                              </div>
                              {/* 比例与时长已在标题后显示，底部详情移除 */}

                              {protagonists.length > 0 && (
                                <div className="mt-3">
                                  <div className="font-medium text-xs mb-1">{t("referencedCharacters")}</div>
                                  <div className="flex flex-wrap gap-3">
                                    {protagonists.map((p: any, i: number) => (
                                      <div key={p.id || i} className="flex items-center gap-2 text-xs">
                                        {p.thumbnailUrl || p.imageUrl ? (
                                          <img src={p.thumbnailUrl || p.imageUrl} alt={p.name} className="w-6 h-6 md:w-8 md:h-8 rounded" />
                                        ) : (
                                          <div className="w-6 h-6 md:w-8 md:h-8 rounded bg-muted" />
                                        )}
                                        <div>{p.name}</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              </div>
                            </div>

                            {/* 第二栏：分镜图 + 提示词 + 操作 */}
                            <div className="w-full md:flex-1 min-w-0">
                              <div className="p-3 bg-background/50 border border-border rounded-md h-full">
                                    {sb ? (
                                <>
                                  {/* 分镜图轮播展示（支持首尾帧模式） */}
                                  <div className="w-full overflow-hidden rounded-lg max-h-48">
                                    {sb.url || sb.firstFrameUrl ? (
                                      <div className="relative group">
                                        {/* 轮播容器 */}
                                        <div 
                                          className="flex overflow-x-auto gap-1 snap-x snap-mandatory scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                                          style={{ scrollSnapType: 'x mandatory' }}
                                          onScroll={(e) => {
                                            const container = e.currentTarget
                                            const scrollLeft = container.scrollLeft
                                            const clientWidth = container.clientWidth
                                            const position = scrollLeft < clientWidth / 2 ? 'first' : 'last'
                                            setStoryboardCarouselPositions((prev: { [index: number]: 'first' | 'last' }) => ({ ...prev, [index]: position }))
                                          }}
                                        >
                                          {/* 首帧 */}
                                          <div className="flex-shrink-0 snap-start relative w-full">
                                            <img src={sb.firstFrameUrl || sb.url} alt={t("storyboardAlt", { index: index + 1 })} className="w-full h-auto max-h-48 object-contain" />
                                            {(sb.lastFrameUrl || sb.firstFrameUrl) && (
                                              <span className="absolute top-1 left-1 px-1.5 py-0.5 text-[10px] bg-black/60 text-white rounded">
                                                {sb.firstFrameUrl ? t("firstFrame") : "1/1"}
                                              </span>
                                            )}
                                            {/* 生成中覆盖层 */}
                                            {isRegeneratingStoryboard === index && sb.isGenerating && (
                                              <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                                                <div className="flex items-center gap-2 text-white">
                                                  <Loader2 className="w-4 h-4 animate-spin" />
                                                  {t("generating")}
                                                </div>
                                              </div>
                                            )}
                                          </div>

                                          {/* 尾帧（如果有） */}
                                          {sb.lastFrameUrl && sb.lastFrameUrl !== sb.firstFrameUrl && (
                                            <div className="flex-shrink-0 snap-start relative w-full">
                                              <img src={sb.lastFrameUrl} alt={t("storyboardAlt", { index: index + 1 }) + " " + t("lastFrame")} className="w-full h-auto max-h-48 object-contain" />
                                              <span className="absolute top-1 left-1 px-1.5 py-0.5 text-[10px] bg-black/60 text-white rounded">
                                                {t("lastFrame")}
                                              </span>
                                              {/* 生成中覆盖层 */}
                                              {isRegeneratingStoryboard === index && sb.isGenerating && (
                                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                                                  <div className="flex items-center gap-2 text-white">
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    {t("generating")}
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                        
                                        {/* 左右滑动按钮（如果有尾帧） */}
                                        {sb.lastFrameUrl && sb.lastFrameUrl !== sb.firstFrameUrl && (
                                          <>
                                            <button
                                              onClick={(e) => {
                                                const container = e.currentTarget.closest('.overflow-hidden')?.querySelector('.overflow-x-auto') as HTMLElement;
                                                if (container) {
                                                  container.scrollBy({ left: -container.clientWidth, behavior: 'smooth' });
                                                }
                                              }}
                                              className="absolute left-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                                            >
                                              <ChevronLeft className="w-4 h-4" />
                                            </button>
                                            <button
                                              onClick={(e) => {
                                                const container = e.currentTarget.closest('.overflow-hidden')?.querySelector('.overflow-x-auto') as HTMLElement;
                                                if (container) {
                                                  container.scrollBy({ left: container.clientWidth, behavior: 'smooth' });
                                                }
                                              }}
                                              className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                                            >
                                              <ChevronRight className="w-4 h-4" />
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="w-full h-48 bg-muted/30 flex items-center justify-center rounded-lg">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120" className="w-full max-w-xs h-28 text-muted-foreground">
                                          <rect x="2" y="2" width="196" height="116" rx="8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.06" />
                                          <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
                                            <path d="M20 20 L180 100" opacity="0.12" />
                                            <path d="M20 100 L180 20" opacity="0.08" />
                                          </g>
                                        </svg>
                                      </div>
                                    )}
                                  </div>
                                  {/* 分镜图提示词在查看模式下已隐藏 */}
                      <div className="flex flex-col sm:flex-row flex-wrap gap-2 mt-2 min-w-0">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setEditingStoryboardIndex(index)
                                        setIsEditingStoryboard(false)
                                        setShowStoryboardPreview(true)
                                      }}
                                      disabled={!sb.url || !!sb.error}
                                    className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      <Eye className="w-3 h-3 mr-1" />
                                      {t("view")}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        // 如果有尾帧，根据当前轮播位置决定下载哪一帧
                                        const position = sb.lastFrameUrl && sb.lastFrameUrl !== sb.firstFrameUrl
                                          ? storyboardCarouselPositions[index] || 'first'
                                          : 'first'
                                        const url = position === 'last' && sb.lastFrameUrl ? sb.lastFrameUrl : (sb.firstFrameUrl || sb.url)
                                        const key = `storyboard-${index}-${position}`
                                        handleDownloadFile(url, `storyboard-${index + 1}-${position === 'first' ? 'first' : 'last'}.png`, key)
                                      }}
                                      disabled={!sb.url || !!sb.error}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      {downloadingKey?.includes(`storyboard-${index}`) ? (
                                        <>
                                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                          {t("downloading")}
                                        </>
                                      ) : (
                                        <>
                                          <Download className="w-3 h-3 mr-1" />
                                          {sb.lastFrameUrl && sb.lastFrameUrl !== sb.firstFrameUrl ? (
                                            storyboardCarouselPositions[index] === 'last' ? t("downloadLast") : t("downloadFirst")
                                          ) : t("download")}
                                        </>
                                      )}
                                    </Button>
                                    {/* 单个分镜编辑按钮 */}
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        // 如果有尾帧，根据当前轮播位置决定编辑哪一帧
                                        const position = sb.lastFrameUrl && sb.lastFrameUrl !== sb.firstFrameUrl
                                          ? (storyboardCarouselPositions[index] || 'first')
                                          : null
                                        handleStartEditStoryboard(index, position || undefined)
                                      }}
                                      disabled={workflowLoading || isRegeneratingStoryboard === index}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                      {sb.lastFrameUrl && sb.lastFrameUrl !== sb.firstFrameUrl ? (
                                        storyboardCarouselPositions[index] === 'last' ? t("editLast") : t("editFirst")
                                      ) : t("edit")}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={async () => {
                                        // 如果有尾帧，根据当前轮播位置决定重新生成哪一帧
                                        if (sb.lastFrameUrl && sb.lastFrameUrl !== sb.firstFrameUrl) {
                                          const position = storyboardCarouselPositions[index] || 'first'
                                          await regenerateSingleFrame(index, position)
                                        } else {
                                          handleShowRegenerateStoryboardDialog(index)
                                        }
                                      }}
                                      disabled={workflowLoading || isRegeneratingStoryboard === index || workflowPaused}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      {isRegeneratingStoryboard === index ? (
                                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                      ) : (
                                        <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                        </svg>
                                      )}
                                      {sb.lastFrameUrl && sb.lastFrameUrl !== sb.firstFrameUrl ? (
                                        storyboardCarouselPositions[index] === 'last' ? t("regenerateLast") : t("regenerateFirst")
                                      ) : t("regenerate")}
                                    </Button>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="w-full rounded-lg bg-muted/30 h-48 flex items-center justify-center relative">
                                    <div className="text-center">
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        viewBox="0 0 200 120"
                                        className="mx-auto w-full max-w-xs h-28 text-muted-foreground"
                                        role="img"
                                        aria-label={t("storyboard") + " " + t("previewImageAlt")}
                                      >
                                        <rect x="2" y="2" width="196" height="116" rx="8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.06" />
                                        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
                                          <path d="M20 20 L180 100" opacity="0.12" />
                                          <path d="M20 100 L180 20" opacity="0.08" />
                                        </g>
                                        {/* visible label removed per UX: keep SVG shape only */}
                                      </svg>
                                    </div>
                                    {/* 失败状态显示（优先显示重新生成状态，然后才是错误） */}
                                    {isRegeneratingStoryboard === index ? (
                                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                                        <div className="flex items-center gap-2 text-white">
                                          <Loader2 className="w-4 h-4 animate-spin" />
                                          {t("generating")}
                                        </div>
                                      </div>
                                    ) : sbError ? (
                                      <div className="absolute inset-0 bg-red-500/80 flex items-center justify-center rounded-lg">
                                        <div className="text-white text-xs text-center px-2">
                                          <div className="font-medium mb-1">{t("generationFailed")}</div>
                                          <div className="line-clamp-3">{sbError}</div>
                                        </div>
                                      </div>
                                    ) : (
                                      /* 只要没有图片就显示"正在生成" */
                                      !sbUrl ? (
                                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                                          <div className="flex items-center gap-2 text-white">
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            {t("generating")}
                                          </div>
                                        </div>
                                      ) : null
                                    )}
                                  </div>
                                  {/* 即使生成失败也显示按钮，但禁用 */}
                                  <div className="flex flex-col sm:flex-row flex-wrap gap-2 mt-2 min-w-0">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setEditingStoryboardIndex(index)
                                        setIsEditingStoryboard(false)
                                        setShowStoryboardPreview(true)
                                      }}
                                      disabled={!sbUrl || !!sbError}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      <Eye className="w-3 h-3 mr-1" />
                                      {t("view")}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        const url = sbUrl
                                        const key = `storyboard-${index}`
                                        handleDownloadFile(url, `storyboard-${index + 1}.png`, key)
                                      }}
                                      disabled={!sbUrl || !!sbError}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      {downloadingKey === `storyboard-${index}` ? (
                                        <>
                                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                          {t("downloading")}
                                        </>
                                      ) : (
                                        <>
                                          <Download className="w-3 h-3 mr-1" />
                                          {t("download")}
                                        </>
                                      )}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleShowRegenerateStoryboardDialog(index)}
                                      disabled={workflowLoading || isRegeneratingStoryboard === index || workflowPaused}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                      </svg>
                                      {t("regenerate")}
                                    </Button>
                                  </div>
                                </>
                              )}
                              </div>
                            </div>

                            {/* 第三栏：剧情视频 + 提示词 + 操作 */}
                            <div className="w-full md:flex-1 min-w-0">
                              <div className="p-3 bg-background/50 border border-border rounded-md h-full">
                              {sv?.videoUrl ? (
                                <>
                                  <div className="w-full overflow-hidden rounded-lg max-h-48">
                                    <video
                                      src={sv.videoUrl}
                                      controls
                                      className="w-full h-auto max-h-48 object-contain"
                                      poster={sv.thumbnailUrl}
                                    />
                                  </div>
                                  {/* 剧情视频提示词在查看模式下已隐藏 */}
                                  <div className="flex flex-col sm:flex-row flex-wrap gap-2 mt-2 min-w-0">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setEditedSceneVideoData(sv)
                                        setEditingSceneVideoIndex(index)
                                        setIsEditingSceneVideo(false)
                                        setShowSceneVideoPreview(true)
                                      }}
                                      disabled={!sv.videoUrl || !!sv.error}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      <Eye className="w-3 h-3 mr-1" />
                                      {t("view")}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        const key = `scene-video-${index}`
                                        handleDownloadFile(sv.videoUrl ?? undefined, `scene-video-${index + 1}.mp4`, key)
                                      }}
                                      disabled={!sv.videoUrl || !!sv.error}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      {downloadingKey === `scene-video-${index}` ? (
                                        <>
                                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                          {t("downloading")}
                                        </>
                                      ) : (
                                        <>
                                          <Download className="w-3 h-3 mr-1" />
                                          {t("download")}
                                        </>
                                      )}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleStartEditSceneVideo(index)}
                                      disabled={workflowLoading}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                      {t("edit")}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleShowRegenerateSceneVideoDialog(index)}
                                      disabled={workflowLoading || isRegeneratingSceneVideo === index || workflowPaused}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                      </svg>
                                      {t("regenerate")}
                                    </Button>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="w-full rounded-lg bg-muted/30 h-48 flex items-center justify-center relative">
                                    <div className="text-center">
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        viewBox="0 0 200 120"
                                        className="mx-auto w-full max-w-xs h-28 text-muted-foreground"
                                        role="img"
                                        aria-label={t("sceneVideo") + " " + t("previewImageAlt")}
                                      >
                                        <rect x="2" y="2" width="196" height="116" rx="8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.06" />
                                        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
                                          <path d="M20 20 L180 100" opacity="0.12" />
                                          <path d="M20 100 L180 20" opacity="0.08" />
                                        </g>
                                        {/* visible label removed per UX: keep SVG shape only */}
                                      </svg>
                                    </div>
                                    {/* 失败状态显示（优先显示重新生成状态，然后才是错误） */}
                                    {isRegeneratingSceneVideo === index ? (
                                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                                        <div className="flex items-center gap-2 text-white">
                                          <Loader2 className="w-4 h-4 animate-spin" />
                                          {t("generating")}
                                        </div>
                                      </div>
                                    ) : sv?.error ? (
                                      <div className="absolute inset-0 bg-red-500/80 flex items-center justify-center rounded-lg">
                                        <div className="text-white text-xs text-center px-2">
                                          <div className="font-medium mb-1">{t("generationFailed")}</div>
                                          <div className="line-clamp-3">{sv.error}</div>
                                        </div>
                                      </div>
                                    ) : (
                                      /* 显示等待/生成中状态：
                                         - 分镜图还没生成时显示"等待生成"
                                         - 分镜图已生成但剧情视频未生成时显示"生成中"
                                      */
                                      !sb?.url ? (
                                        <div className="absolute inset-0 bg-muted/50 flex items-center justify-center rounded-lg">
                                          <div className="flex items-center gap-2 text-muted-foreground">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            {t("waitingForGeneration")}
                                          </div>
                                        </div>
                                      ) : !sv?.videoUrl ? (
                                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                                          <div className="flex items-center gap-2 text-white">
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            {t("generating")}
                                          </div>
                                        </div>
                                      ) : null
                                    )}
                                  </div>
                                  {/* 即使生成失败也显示按钮，但禁用 */}
                                  <div className="flex flex-col sm:flex-row flex-wrap gap-2 mt-2 min-w-0">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setEditedSceneVideoData(sv)
                                        setEditingSceneVideoIndex(index)
                                        setIsEditingSceneVideo(false)
                                        setShowSceneVideoPreview(true)
                                      }}
                                      disabled={!sv?.videoUrl || !!sv?.error}
                                    className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      <Eye className="w-3 h-3 mr-1" />
                                      {t("view")}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        const key = `scene-video-${index}`
                                        handleDownloadFile(sv?.videoUrl ?? undefined, `scene-video-${index + 1}.mp4`, key)
                                      }}
                                      disabled={!sv?.videoUrl || !!sv?.error}
                                    className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      {downloadingKey === `scene-video-${index}` ? (
                                        <>
                                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                          {t("downloading")}
                                        </>
                                      ) : (
                                        <>
                                          <Download className="w-3 h-3 mr-1" />
                                          {t("download")}
                                        </>
                                      )}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleStartEditSceneVideo(index)}
                                      disabled={workflowLoading}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                      {t("edit")}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleShowRegenerateSceneVideoDialog(index)}
                                      disabled={workflowLoading || isRegeneratingSceneVideo === index || workflowPaused}
                                      className="h-8 text-xs w-full sm:w-auto min-w-0"
                                    >
                                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                      </svg>
                                      {t("regenerate")}
                                    </Button>
                                  </div>
                                </>
                              )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
    </>
  )
}
