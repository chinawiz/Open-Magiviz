import { NextRequest, NextResponse } from "next/server"
import type { KieRequestBody, KieApiResponse } from '@/lib/ai-types'
import { getAuthedSession, jsonError } from '@/lib/api'
import { getUserPoints, deductPoints, PointsAction } from '@/lib/points'
import { getVideoUnitPoints, computeVideoPoints } from '@/lib/video-pricing'
import { getVideoFallbackChain } from '@/lib/providers/defaults'
import { trackFunnelEvent } from '@/lib/observability/track'
import { db } from '@/lib/db'
import { aiGenerationTasks } from '@/lib/schema'
import { v4 as uuidv4 } from 'uuid'
import { eq } from 'drizzle-orm'

/**
 * POST /api/ai/generate-story-video
 *
 * 计费单价唯一事实源：lib/video-pricing.ts（本注释中的单价为历史说明，如有出入以模块为准）
 * Body (单个请求):
 * {
 *   imageUrl?: string,                   // 可选：分镜图 URL
 *   prompt: string,                      // 必需：视频生成提示词
 *   aspectRatio?: "16:9" | "9:16",       // 可选：画面比例，默认 16:9
 *   duration?: "4s" | "6s" | "8s",       // 可选：视频时长，默认 8s
 *   videoModel?: string,                 // 可选：视频模型（auto, veo31Fast, veo31Lite, veo31Quality, seedance25, seedance2Fast, seedance2Mini, seedance2, kling3, happyHorse, wan27, minimaxH3）
 *                                              auto: 根据 videoStyle 路由（默认）
 *                                              veo31Fast: Veo 3.1 Fast
 *                                              veo31Lite: Veo 3.1 Lite（1积分/s，性价比最高）
 *                                              veo31Quality: Veo 3.1 Quality（旗舰模型，最高画质，3积分/s）
 *                                              seedance25: Seedance 2.5（9积分/s，720p，4-30s）
 *                                              seedance2Fast: Seedance 2.0 Fast
 *                                              seedance2Mini: Seedance 2.0 Mini（1.5积分/s，720p）
 *                                              seedance2: Seedance 2.0
 *                                              kling3: Kling 3.0
 *                                              happyHorse: HappyHorse（2积分/s，默认 720p，调用 HappyHorse 1.1 接口）
 *                                              wan27: Wan 2.7
 *                                              minimaxH3: MiniMax H3（2.5积分/s，4-15s，支持首尾帧，768p）
 *   videoStyle?: string,                 // 可选：视频风格（auto, anime, ads, hollywood）
 *                                              auto: 默认路由（→ veo31Fast）
 *                                              anime: 动漫 → seedance2Fast（2pts/s）
 *                                              ads: 广告 → seedance2（3pts/s）
 *                                              hollywood: → kling3
 *   additionalImageUrls?: string[],        // 可选：额外的图片URL数组（用于首尾帧或参考图模式）
 *   generationType?: string,              // 可选：视频生成模式（仅 Veo 支持）
 *                                              FIRST_AND_LAST_FRAMES_2_VIDEO: 首尾帧生视频
 *                                                  - 传1张图片：基于该图片生成视频
 *   videoUrls?: string[],                 // 可选：参考视频URL数组（仅 Seedance 2.0 / Seedance 2.0 Fast / Seedance 2.0 Mini 生效，<=3 个）
 *   audioUrls?: string[],                 // 可选：参考音频URL数组（仅 Seedance 2.0 / Seedance 2.0 Fast / Seedance 2.0 Mini 生效，<=3 段）
 *                                                  - 传2张图片：第一张作为首帧，第二张作为尾帧，生成过渡视频
 *                                              REFERENCE_2_VIDEO: 参考图生视频（需要1-3张图片）
 *                                                  - 重要：此模式目前仅支持 veo3_fast 模型
 *                                              不填写时系统会根据是否提供 imageUrls 自动判断
 *   webhookUrl?: string                  // 可选：自定义 webhook URL
 * }
 *
 * Body (批量请求):
 * {
 *   scenes: [
 *     { id: string, imageUrl?: string, prompt: string, aspectRatio?: "16:9" | "9:16", duration?: "4s" | "6s" | "8s", videoModel?: string, videoStyle?: string, additionalImageUrls?: string[], generationType?: string }
 *   ]
 * }
 *
 * 路由逻辑：
 * - videoModel === 'seedance25' -> Seedance 2.5（9积分/s，720p，4-30s）
 * - videoModel === 'veo31Lite' -> Veo 3.1 Lite（1积分/s，性价比最高）
 * - videoModel === 'veo31Fast' -> Veo 3.1 Fast（2积分/s）
 * - videoModel === 'veo31Quality' -> Veo 3.1 Quality（旗舰模型，最高画质，3积分/s）
 * - videoModel === 'seedance2Fast' -> Seedance 2.0 Fast（2积分/s）
 * - videoModel === 'seedance2Mini' -> Seedance 2.0 Mini（1.5积分/s，720p）
 * - videoModel === 'seedance2' -> Seedance 2.0（3积分/s）
 * - videoModel === 'kling3' -> Kling 3.0（2积分/s）
 * - videoModel === 'happyHorse' -> HappyHorse（2积分/s，默认 720p，调用 HappyHorse 1.1 接口）
 * - videoModel === 'wan27' -> Wan 2.7（2积分/s）
 * - videoModel === 'minimaxH3' -> MiniMax H3（2.5积分/s，4-15s，支持首尾帧，768p）
 * - videoModel === 'auto'（无 videoModel）-> Veo 3.1 Fast（2积分/s）
 * - videoStyle 仅用于增强 prompt（已选模型时）或决定路由（未选模型时）
 *
 * 视频生成模式逻辑（仅 Veo 模型）：
 * - generationType === 'FIRST_AND_LAST_FRAMES_2_VIDEO'：首尾帧模式
 *   - 1张图片：基于该图片生成视频
 *   - 2张图片：第一张作为首帧，第二张作为尾帧
 * - generationType === 'REFERENCE_2_VIDEO'：参考图模式，需要1-3张图片（仅 veo3_fast）
 * - 不指定：自动判断
 *   - 1张 imageUrl → 基于该图片生成视频
 *   - 2张 imageUrls → FIRST_AND_LAST_FRAMES_2_VIDEO
 *   - 1-3张 imageUrls → REFERENCE_2_VIDEO
 *
 * 使用 webhook 模式或轮询模式获取结果
 */

// Kie.ai API 配置
const KIE_API_URL = "https://api.kie.ai/api/v1/veo/generate"
const KIE_DETAIL_URL = "https://api.kie.ai/api/v1/veo/record-info"
const KIE_API_KEY = process.env.KIE_API_KEY!

// Kie.ai Kling 3.0 API 配置
const KIE_KLING_API_URL = "https://api.kie.ai/api/v1/jobs/createTask"
const KIE_KLING_DETAIL_URL = "https://api.kie.ai/api/v1/jobs/get"

// Kie.ai Seedance 2.0 Fast API 配置
const KIE_SEEDANCE_API_URL = "https://api.kie.ai/api/v1/jobs/createTask"
const KIE_SEEDANCE_DETAIL_URL = "https://api.kie.ai/api/v1/jobs/get"

// Kie.ai Wan 2.7 API 配置
const KIE_WAN_API_URL = "https://api.kie.ai/api/v1/jobs/createTask"
const KIE_WAN_DETAIL_URL = "https://api.kie.ai/api/v1/jobs/get"

// Kie.ai HappyHorse API 配置
const KIE_HAPPYHORSE_API_URL = "https://api.kie.ai/api/v1/jobs/createTask"
const KIE_HAPPYHORSE_DETAIL_URL = "https://api.kie.ai/api/v1/jobs/get"

  // Kie.ai Gemini Omni API 配置
const KIE_GEMINI_OMNI_API_URL = "https://api.kie.ai/api/v1/jobs/createTask"
const KIE_GEMINI_OMNI_DETAIL_URL = "https://api.kie.ai/api/v1/jobs/get"

// Kie.ai MiniMax H3 API 配置
const KIE_MINIMAX_API_URL = "https://api.kie.ai/api/v1/jobs/createTask"
const KIE_MINIMAX_DETAIL_URL = "https://api.kie.ai/api/v1/jobs/get"

// Webhook URL - VEO 视频使用专门的环境变量
const WEBHOOK_URL = process.env.KIE_VEO_WEBHOOK_URL

// Webhook URL - Kling 3.0 / Seedance 2.0 Fast / Wan 2.7 / HappyHorse 共用环境变量
const KLING_WEBHOOK_URL = process.env.KIE_VIDEO_WEBHOOK_URL || process.env.KIE_KLING_WEBHOOK_URL

/**
 * 生成单个剧情视频
 * videoModel 决定路由模型：
 *   - videoModel='veo31Lite' -> Veo 3.1 Lite（1积分/s，性价比最高）
 *   - videoModel='veo31Fast' -> Veo 3.1 Fast（2积分/s）
 *   - videoModel='veo31Quality' -> Veo 3.1 Quality（旗舰模型，最高画质）
 *   - videoModel='seedance2Fast' -> Seedance 2.0 Fast（2积分/s，audio on，720p，model=bytedance/seedance-2-fast）
 *   - videoModel='seedance2Mini' -> Seedance 2.0 Mini（1.5积分/s，audio on，720p，model=bytedance/seedance-2-mini）
 *   - videoModel='seedance2' -> Seedance 2.0  (3积分/s，audio on，720p，model=bytedance/seedance-2）
 *   - videoModel='kling3'     -> Kling 3.0（2积分/s）
 *   - videoModel='wan27'      -> Wan 2.7（2积分/s，720p，audio on，model=wan/2-7-image-to-video）
 *   - videoModel='minimaxH3'  -> MiniMax H3（2.5积分/s，4-15s，支持首尾帧，768p）
 * videoStyle 回退路由（仅在 videoModel='auto' 时生效）：
 *   - anime -> seedance2Fast（2pts/s）
 *   - ads   -> seedance2（3pts/s）
 *   - hollywood/其他 -> veo31Fast（2pts/s）
 */
async function generateSingleVideo(
  imageUrl: string,
  prompt: string,
  aspectRatio?: string,
  duration?: string,
  videoModel?: string,
  videoStyle?: string,
  webhookUrl?: string,
  userId?: string,
  projectId?: string,
  sceneIndex?: number,
  sceneId?: string,
  versionId?: string,
  versionGroupId?: string,
  additionalImageUrls?: string[],
  generationType?: string,
  referenceVideoUrls?: string[],
  referenceAudioUrls?: string[],
): Promise<{ success: boolean; videoUrl?: string; requestId?: string; error?: string; model?: string }> {
  // videoModel === 'auto' 或未传 → 根据 videoStyle 回退路由
  const effectiveModel = ['seedance25', 'seedance2Fast', 'seedance2Mini', 'seedance2', 'kling3', 'veo31Fast', 'veo31Lite', 'veo31Quality', 'happyHorse', 'wan27', 'geminiOmni', 'minimaxH3'].includes(videoModel || '') ? videoModel : null
  const styleFallbackModel = !effectiveModel
    ? (videoStyle === 'anime' ? 'seedance2Fast' : (videoStyle === 'ads' ? 'seedance2' : (videoStyle && videoStyle !== 'auto' ? 'veo31Fast' : null)))
    : null
  const routeTo = effectiveModel || styleFallbackModel || 'veo31Fast'

  // 单次目标模型的提交分发（videoModel 参数传当前链上模型，保证各函数内部
  // 的模型分支/计费单价与实际目标一致；各函数内部自带 taskType 常量）
  const dispatchGeneration = async (model: string): Promise<{ success: boolean; videoUrl?: string; requestId?: string; error?: string }> => {
    if (model === 'seedance25' || model === 'seedance2Fast' || model === 'seedance2Mini' || model === 'seedance2') {
      // Seedance 支持首尾帧模式
      return await generateWithSeedance2(imageUrl, prompt, aspectRatio, duration, model, videoStyle, webhookUrl, userId, model, projectId, sceneIndex, sceneId, versionId, versionGroupId, additionalImageUrls, referenceVideoUrls, referenceAudioUrls)
    }

    if (model === 'kling3') {
      // Kling 支持首尾帧模式
      return await generateWithKling(imageUrl, prompt, aspectRatio, duration, model, videoStyle, webhookUrl, userId, projectId, sceneIndex, sceneId, versionId, versionGroupId, additionalImageUrls)
    }

    if (model === 'wan27') {
      // Wan 支持首尾帧模式
      return await generateWithWan(imageUrl, prompt, aspectRatio, duration, model, videoStyle, webhookUrl, userId, undefined, projectId, sceneIndex, sceneId, versionId, versionGroupId, additionalImageUrls)
    }

    // HappyHorse - 2积分/s, 默认 720p（API 实际调用 HappyHorse 1.1 接口）
    if (model === 'happyHorse') {
      return await generateWithHappyHorse(imageUrl, prompt, aspectRatio, duration, webhookUrl, userId, projectId, sceneIndex, sceneId, versionId, versionGroupId)
    }

    // Gemini Omni - 1积分/s, 固定 4/6/8/10s, 1080p, 不支持首尾帧
    if (model === 'geminiOmni') {
      const durationSec = getDurationSeconds(duration)
      const allowedDurations = [4, 6, 8, 10]
      if (!allowedDurations.includes(durationSec)) {
        return { success: false, error: `Gemini Omni 只支持 4/6/8/10s，当前: ${durationSec}s` }
      }
      return await generateWithGeminiOmni(imageUrl, prompt, aspectRatio, duration, webhookUrl, userId, projectId, sceneIndex, sceneId, versionId, versionGroupId, additionalImageUrls)
    }

    // MiniMax H3 - 4-15s, 支持首尾帧
    if (model === 'minimaxH3') {
      return await generateWithMinimaxH3(imageUrl, prompt, aspectRatio, duration, webhookUrl, userId, projectId, sceneIndex, sceneId, versionId, versionGroupId, additionalImageUrls)
    }

    // Veo 3.1 Lite / Fast / Quality - 支持视频生成模式
    if (model === 'veo31Lite' || model === 'veo31Fast' || model === 'veo31Quality') {
      return await generateWithVeo(imageUrl, prompt, aspectRatio, duration, model, videoStyle, webhookUrl, userId, projectId, sceneIndex, sceneId, versionId, versionGroupId, additionalImageUrls, generationType)
    }

    return { success: false, error: `Unsupported model: ${model}` }
  }

  // F2 基础降级：按"主模型 → 候补链"依次尝试，提交失败（含供应商报错/校验不符）
  // 即切下一模型；链条依输入形态（是否有图）与时长约束过滤（lib/providers/defaults）
  const chain = getVideoFallbackChain(routeTo, {
    hasImage: !!(imageUrl && imageUrl.trim()),
    durationSec: getDurationSeconds(duration),
  })

  let lastResult: { success: boolean; videoUrl?: string; requestId?: string; error?: string } = { success: false, error: 'No generation attempted' }
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i]
    const result = await dispatchGeneration(model)
    if (result.success) {
      if (model !== routeTo) {
        console.warn(`[generate-story-video] 降级生效: ${routeTo} → ${model}（第 ${i + 1} 候补）`)
      }
      return { ...result, model }
    }
    lastResult = result
    console.error(`[generate-story-video] 模型 ${model} 提交失败（${i + 1}/${chain.length}）: ${result.error || 'unknown'}`)
  }
  console.error(`[generate-story-video] 降级链耗尽: [${chain.join(' → ')}]`)
  return lastResult
}

/**
 * 轮询查询视频状态
 * Kie.ai API 返回格式：
 * - successFlag: 0=生成中, 1=成功, 2=失败, 3=生成失败
 * - response.resultUrls: 成功时的视频URL数组
 */
async function pollVideoStatus(
  taskId: string,
  userId?: string,
  storedTaskId?: string,
  duration?: string
): Promise<{ success: boolean; videoUrl?: string; requestId?: string; error?: string }> {
  // 15分钟超时 = 180次 × 5秒 = 900秒
  const maxRetries = 180
  let retryCount = 0

  while (retryCount < maxRetries) {
    try {
      const queryResponse = await fetch(`${KIE_DETAIL_URL}?taskId=${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${KIE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      })

      if (!queryResponse.ok) {
        console.error('[generate-story-video] [Veo] 查询失败:', queryResponse.status)
        retryCount++
        await new Promise(resolve => setTimeout(resolve, 5000))
        continue
      }

      const queryData: KieApiResponse = await queryResponse.json()
      console.log('[generate-story-video] [Veo] 查询状态:', {
        taskId,
        code: queryData.code,
        successFlag: queryData.data?.successFlag,
        state: queryData.data?.state
      })

      // 根据 Kie.ai 文档的 successFlag 状态检查
      if (queryData.code === 200 && queryData.data) {
        const taskData = queryData.data
        const successFlag = taskData.successFlag

        // 成功 (successFlag === 1)
        if (successFlag === 1) {
          const response = taskData.response || {}
          const resultUrls = response.resultUrls || []
          const videoUrl = resultUrls[0] || ''

          if (videoUrl) {
            console.log('[generate-story-video] [Veo] 视频生成成功:', { taskId, videoUrl })
            
            // 轮询模式：任务已完成，立即扣除积分
            if (userId && storedTaskId) {
              try {
                const durationSeconds = getDurationSeconds(duration)
                const pointsAmount = computeVideoPoints('veo31Fast', durationSeconds)
                
                // 更新任务状态为成功
                await db.update(aiGenerationTasks)
                  .set({ 
                    status: 'success',
                    pointsDeducted: true,
                    updatedAt: new Date()
                  })
                  .where(eq(aiGenerationTasks.taskId, storedTaskId))

                // 扣除积分
                await deductPoints(
                  userId,
                  pointsAmount,
                  undefined,
                  PointsAction.GENERATE_STORY_VIDEO
                )
                console.log(`[generate-story-video] [Veo] 轮询模式：用户 ${userId} 成功生成视频（${durationSeconds}秒），扣除 ${pointsAmount} 积分`)
              } catch (deductError) {
                console.error('[generate-story-video] [Veo] 轮询模式扣除积分失败:', deductError)
                // 即使扣除积分失败，也返回成功结果
              }
            }
            
            return { success: true, videoUrl, requestId: taskId }
          }
          return { success: false, error: "No video URL in result" }
        }

        // 失败 (successFlag === 2 或 3)
        if (successFlag === 2 || successFlag === 3) {
          console.error('[generate-story-video] [Veo] 视频生成失败:', {
            successFlag,
            errorMessage: taskData.errorMessage || taskData.failMsg
          })
          return { success: false, error: taskData.errorMessage || taskData.failMsg || "Video generation failed" }
        }

        // 生成中 (successFlag === 0)，继续等待
        if (successFlag === 0) {
          console.log('[generate-story-video] [Veo] 视频生成中...')
        }
      }

      // 400 可能是 1080P 正在处理，继续等待
      if (queryData.code === 400) {
        console.log('[generate-story-video] [Veo] 1080P 处理中，继续等待...')
      }

      // 其他错误
      if (queryData.code === 501) {
        return { success: false, error: queryData.msg || "Video generation failed" }
      }
    } catch (queryError) {
      console.error('[generate-story-video] [Veo] 查询出错:', queryError)
    }

    // 等待5秒后重试
    await new Promise(resolve => setTimeout(resolve, 5000))
    retryCount++
  }

  console.error('[generate-story-video] [Veo] 轮询超时:', { taskId })
  return { success: false, error: "Video generation timeout" }
}

/**
 * 从 duration 字符串中提取秒数（例如 "4s" -> 4, "6s" -> 6, "8s" -> 8）
 */
function getDurationSeconds(duration?: string): number {
  if (!duration || typeof duration !== 'string') {
    return 8 // 默认 8 秒
  }
  const match = duration.match(/^(\d+)s?$/i)
  if (match) {
    const seconds = parseInt(match[1], 10)
    return seconds > 0 ? seconds : 8
  }
  return 8 // 默认 8 秒
}


/**
 * 使用 Kie.ai Veo 3.1 Fast/Lite 生成视频
 * 视频生成模式（generationType）：
 * - FIRST_AND_LAST_FRAMES_2_VIDEO：首尾帧生视频
 *   - 传1张图片：基于该图片生成视频
 *   - 传2张图片：第一张作为首帧，第二张作为尾帧，生成过渡视频
 * - REFERENCE_2_VIDEO：参考图生视频（需要1-3张图片，仅支持 veo3_fast）
 * 
 * 为空时自动判断：
 * - 1张 imageUrl → 基于该图片生成视频
 * - 2张 imageUrls → FIRST_AND_LAST_FRAMES_2_VIDEO（首尾帧）
 * - 1-3张 imageUrls → REFERENCE_2_VIDEO（参考图模式）
 */
async function generateWithVeo(
  imageUrl: string,
  prompt: string,
  aspectRatio?: string,
  duration?: string,
  videoModel?: string,
  videoStyle?: string,
  webhookUrl?: string,
  userId?: string,
  projectId?: string,
  sceneIndex?: number,
  sceneId?: string,
  versionId?: string,
  versionGroupId?: string,
  additionalImageUrls?: string[], // 额外的图片URL（用于首尾帧或参考图模式）
  generationType?: string // 可选：显式指定的生成模式
): Promise<{ success: boolean; videoUrl?: string; requestId?: string; error?: string }> {
  if (!prompt || !prompt.trim()) {
    return { success: false, error: "Prompt is required" }
  }

  const aspectRatioParam = (aspectRatio === '16:9' || aspectRatio === '9:16') ? aspectRatio : '16:9'
  const durationParam = (duration === '4s' || duration === '6s' || duration === '8s') ? duration : '8s'

  const videoStyleMap: Record<string, string> = {
    anime: "anime style, Japanese animation style",
    hollywood: "Hollywood cinematic style, film-like quality",
    ads: "advertisement style, educational video style"
  }

  let enhancedPrompt = prompt
  if (videoStyle && videoStyle !== 'auto' && videoStyleMap[videoStyle]) {
    enhancedPrompt = `${prompt}, ${videoStyleMap[videoStyle]}`
  }

  // Veo 3.1 Lite / Fast / Quality - 决定使用哪个模型
  const isVeoLite = videoModel === 'veo31Lite'
  const isVeoQuality = videoModel === 'veo31Quality'
  const kieModel = isVeoLite ? 'veo3_lite' : (isVeoQuality ? 'veo3' : 'veo3_fast')

  // 自动判断生成模式
  // 合并所有图片：additionalImageUrls 优先，然后是 imageUrl
  const allImageUrls: string[] = []
  if (imageUrl && imageUrl.trim()) {
    allImageUrls.push(imageUrl)
  }
  if (additionalImageUrls && additionalImageUrls.length > 0) {
    allImageUrls.push(...additionalImageUrls.filter(u => u && u.trim()))
  }

  let finalGenerationType = generationType || ''
  
  // 如果未指定模式，自动判断
  if (!finalGenerationType) {
    if (allImageUrls.length === 1) {
      // 单张图片 → 基于该图片生成视频
      finalGenerationType = 'FIRST_AND_LAST_FRAMES_2_VIDEO'
    } else if (allImageUrls.length === 2) {
      // 两张图片 → 首尾帧模式
      finalGenerationType = 'FIRST_AND_LAST_FRAMES_2_VIDEO'
    } else {
      // 3+张图片 → 参考图模式
      finalGenerationType = 'REFERENCE_2_VIDEO'
    }
  }

  // 验证 REFERENCE_2_VIDEO 模式只能使用 veo3_fast 或 veo3
  if (finalGenerationType === 'REFERENCE_2_VIDEO' && isVeoLite) {
    console.warn('[generate-story-video] [Veo] REFERENCE_2_VIDEO 模式不支持 veo3_lite')
  }

  // 构建 Kie.ai 请求体
  const kieRequestBody: KieRequestBody = {
    prompt: enhancedPrompt,
    model: kieModel,
    generationType: finalGenerationType,
    aspect_ratio: aspectRatioParam,  // Kie.ai API 使用下划线格式
    duration: getDurationSeconds(durationParam),  // API 需要数字格式
    enableTranslation: true,
  }

  // 根据生成模式设置图片
  if (finalGenerationType === 'FIRST_AND_LAST_FRAMES_2_VIDEO') {
    // 首尾帧模式
    if (allImageUrls.length === 1) {
      // 单张图片：作为首帧生成视频
      kieRequestBody.imageUrls = [allImageUrls[0]]
    } else if (allImageUrls.length >= 2) {
      // 两张图片：第一张为首帧，第二张为尾帧
      kieRequestBody.imageUrls = [allImageUrls[0], allImageUrls[1]]
    } else if (imageUrl && imageUrl.trim()) {
      // 兜底：使用传入的 imageUrl
      kieRequestBody.imageUrls = [imageUrl]
    } else {
      // 完全没有图片，记录警告但继续（API会报错）
      console.warn('[generate-story-video] [Veo] FIRST_AND_LAST_FRAMES_2_VIDEO 模式需要至少1张图片')
      kieRequestBody.imageUrls = []
    }
  } else if (finalGenerationType === 'REFERENCE_2_VIDEO') {
    // 参考图模式：1-3张图片
    const refUrls = allImageUrls.slice(0, 3)
    if (refUrls.length > 0) {
      kieRequestBody.imageUrls = refUrls
    } else if (imageUrl && imageUrl.trim()) {
      // 兜底：使用传入的 imageUrl
      kieRequestBody.imageUrls = [imageUrl]
    } else {
      // 完全没有图片，记录警告但继续（API会报错）
      console.warn('[generate-story-video] [Veo] REFERENCE_2_VIDEO 模式需要至少1张图片')
      kieRequestBody.imageUrls = []
    }
  } else {
    // 默认：使用单张图片（需要 imageUrl）
    if (imageUrl && imageUrl.trim()) {
      kieRequestBody.imageUrls = [imageUrl]
    } else {
      console.warn('[generate-story-video] [Veo] 默认模式需要 imageUrl')
      kieRequestBody.imageUrls = []
    }
  }

  const finalWebhookUrl = WEBHOOK_URL || webhookUrl
  if (finalWebhookUrl) {
    kieRequestBody.callBackUrl = finalWebhookUrl
  }

  console.log(`[generate-story-video] [Veo ${isVeoLite ? '3.1 Lite' : (isVeoQuality ? '3.1 Quality' : '3.1 Fast')}] 创建视频任务:`, {
    imageUrl: imageUrl ? imageUrl.substring(0, 50) + '...' : 'none',
    additionalImageUrls: additionalImageUrls?.map(u => u?.substring(0, 30) + '...'),
    promptLength: prompt.length,
    // 显示实际发送的请求体参数
    requestBody: {
      aspect_ratio: kieRequestBody.aspect_ratio,
      duration: kieRequestBody.duration,
      model: kieRequestBody.model,
      generationType: kieRequestBody.generationType,
      imageUrlsCount: kieRequestBody.imageUrls?.length || 0,
    },
    hasWebhook: !!finalWebhookUrl,
  })

  const response = await fetch(KIE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KIE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(kieRequestBody)
  })

  const responseText = await response.text()

  if (!response.ok) {
    console.error('[generate-story-video] [Veo] API error:', response.status, responseText)
    return { success: false, error: `API error: ${response.status}` }
  }

  let data: KieApiResponse
  try {
    data = JSON.parse(responseText)
  } catch (e) {
    console.error('[generate-story-video] [Veo] 解析响应失败:', responseText)
    return { success: false, error: "Invalid API response" }
  }

  console.log('[generate-story-video] [Veo] API 响应:', data)

  if (data.code !== 200) {
    console.error('[generate-story-video] [Veo] 生成失败:', data.msg)
    return { success: false, error: data.msg || "Video generation failed" }
  }

  const taskId = data.data?.taskId
  if (!taskId) {
    console.error('[generate-story-video] [Veo] 未返回 taskId:', data)
    return { success: false, error: "No task ID returned" }
  }

  console.log(`[generate-story-video] [Veo ${isVeoLite ? '3.1 Lite' : (isVeoQuality ? '3.1 Quality' : '3.1 Fast')}] 任务创建成功:`, { taskId })

  const useWebhookMode = !!finalWebhookUrl
  const durationSeconds = getDurationSeconds(duration)
  // 单价唯一事实源：lib/video-pricing.ts
  const pointsPerSecond = getVideoUnitPoints(isVeoLite ? 'veo31Lite' : (isVeoQuality ? 'veo31Quality' : 'veo31Fast'))
  const pointsAmount = durationSeconds * pointsPerSecond

  if (userId) {
    try {
      await db.insert(aiGenerationTasks).values({
        id: uuidv4(),
        taskId: taskId,
        userId: userId,
        taskType: 'generate_story_video_veo',
        pointsAmount: pointsAmount,
        pointsDeducted: false,
        status: 'pending',
        projectId: projectId || null,
        versionId: versionId || null,
        itemId: sceneId ? String(sceneIndex) : null,
        versionGroupId: versionGroupId || null,
        newVersionId: null,
      })
      console.log(`[generate-story-video] [Veo ${isVeoLite ? '3.1 Lite' : (isVeoQuality ? '3.1 Quality' : '3.1 Fast')}] 任务映射已存储:`, { taskId, userId, pointsAmount, projectId, sceneIndex, sceneId, versionId, versionGroupId })
    } catch (error) {
      console.error('[generate-story-video] [Veo] 存储任务映射失败:', error)
    }
  }

  if (useWebhookMode) {
    return { success: true, requestId: taskId }
  }

  const result = await pollVideoStatus(taskId, userId, taskId, duration)
  return result
}

/**
 * 使用 Kie.ai Seedance 生成视频（图生视频/首尾帧视频）
 * routeTo 决定具体版本：
 *   - seedance25:    Seedance 2.5   (9积分/s，audio on，720p，model=bytedance/seedance-2-5）
 *   - seedance2Fast: Seedance 2.0 Fast（2积分/s，audio on，720p，model=bytedance/seedance-2-fast）
 *   - seedance2Mini: Seedance 2.0 Mini（1.5积分/s，audio on，720p，model=bytedance/seedance-2-mini）
 *   - seedance2:     Seedance 2.0     (3积分/s，audio on，720p，model=bytedance/seedance-2）
 * anime 风格使用 seedance2Fast，ads 风格使用 seedance2
 * 支持首尾帧模式：如果提供了 additionalImageUrls，会使用 first_frame_url + last_frame_url
 */
async function generateWithSeedance2(
  imageUrl: string,
  prompt: string,
  aspectRatio?: string,
  duration?: string,
  videoModel?: string,
  videoStyle?: string,
  webhookUrl?: string,
  userId?: string,
  routeTo?: string,
  projectId?: string,
  sceneIndex?: number,
  sceneId?: string,
  versionId?: string,
  versionGroupId?: string,
  additionalImageUrls?: string[],
  referenceVideoUrls?: string[],
  referenceAudioUrls?: string[],
): Promise<{ success: boolean; videoUrl?: string; requestId?: string; error?: string }> {
  if (!imageUrl || !imageUrl.trim()) {
    return { success: false, error: "Image URL is required" }
  }

  if (!prompt || !prompt.trim()) {
    return { success: false, error: "Prompt is required" }
  }

  const is25 = routeTo === 'seedance25'
  const isFast = routeTo === 'seedance2Fast'
  const isMini = routeTo === 'seedance2Mini'

  // Seedance 支持的画面比例
  const validAspectRatios = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive']
  const aspectRatioParam = validAspectRatios.includes(aspectRatio || '') ? aspectRatio! : '16:9'

  // 验证时长 (4-30 for Seedance 2.5, 4-15 for others)
  const durationSeconds = parseInt(String(duration || '5').replace(/s$/i, ''), 10)
  const maxDuration = is25 ? 30 : 15
  const durationParam = (!isNaN(durationSeconds) && durationSeconds >= 4 && durationSeconds <= maxDuration)
    ? durationSeconds
    : (is25 ? 5 : 8)

  // 获取尾帧图片
  const lastFrameUrl = additionalImageUrls?.[0] || ''

  // 选模型 id：Seedance 2.5 走 bytedance/seedance-2-5，Mini 走 seedance-2-mini，Fast 走 seedance-2-fast，否则 seedance-2
  const kieModel = is25
    ? 'bytedance/seedance-2-5'
    : (isMini
      ? 'bytedance/seedance-2-mini'
      : (isFast ? 'bytedance/seedance-2-fast' : 'bytedance/seedance-2'))

  const kieRequestBody: KieRequestBody = {
    model: kieModel,
    input: {
      prompt: prompt,
      first_frame_url: imageUrl,
      last_frame_url: lastFrameUrl || undefined,  // Seedance 支持尾帧
      generate_audio: true, // 默认开启声音
      resolution: "720p",  // 默认 720p
      aspect_ratio: aspectRatioParam,
      duration: durationParam,
      web_search: false,
      reference_video_urls: undefined as string[] | undefined,
      reference_audio_urls: undefined as string[] | undefined,
    }
  }

  // Seedance 2.0 多模态参考：把上传的视频/音频传给模型
  const refVideoUrls = (referenceVideoUrls || []).filter((u) => typeof u === "string" && u.trim().length > 0)
  const refAudioUrls = (referenceAudioUrls || []).filter((u) => typeof u === "string" && u.trim().length > 0)
  if (refVideoUrls.length > 0) {
    kieRequestBody.input!.reference_video_urls = refVideoUrls.slice(0, 3)
  } else {
    delete kieRequestBody.input!.reference_video_urls
  }
  if (refAudioUrls.length > 0) {
    kieRequestBody.input!.reference_audio_urls = refAudioUrls.slice(0, 3)
  } else {
    delete kieRequestBody.input!.reference_audio_urls
  }

  // 如果没有尾帧，移除该字段
  if (!lastFrameUrl) {
    delete kieRequestBody.input!.last_frame_url
  }

  // 配置 webhook（与 Kling 共用环境变量，支持前端覆盖）
  const finalWebhookUrl = KLING_WEBHOOK_URL || webhookUrl
  if (finalWebhookUrl) {
    kieRequestBody.callBackUrl = finalWebhookUrl
  }

  const taskType = is25
    ? 'seedance_2_5_video'
    : (isMini
      ? 'seedance_2_0_mini_video'
      : (isFast ? 'seedance_2_0_fast_video' : 'seedance_2_0_video'))
  const pointsPerSecond = getVideoUnitPoints(is25 ? 'seedance25' : (isMini ? 'seedance2Mini' : (isFast ? 'seedance2Fast' : 'seedance2')))
  const pointsAmount = Math.round(durationParam * pointsPerSecond)

  const modelLabel = is25 ? 'Seedance 2.5' : (isMini ? 'Seedance 2.0 Mini' : (isFast ? 'Seedance 2.0 Fast' : 'Seedance 2.0'))

  console.log(`[generate-story-video] [${modelLabel}] 创建视频任务:`, {
    imageUrl: imageUrl.substring(0, 50) + '...',
    lastFrameUrl: lastFrameUrl ? lastFrameUrl.substring(0, 50) + '...' : 'none',
    hasLastFrame: !!lastFrameUrl,
    referenceVideoUrls: refVideoUrls.length,
    referenceAudioUrls: refAudioUrls.length,
    promptLength: prompt.length,
    aspectRatio: aspectRatioParam,
    duration: durationParam,
    model: kieModel,
    pointsPerSecond,
    generateAudio: true,
    resolution: "720p",
    useWebhook: !!finalWebhookUrl
  })

  // 调用 Kie.ai Seedance 2.0 API
  const response = await fetch(KIE_SEEDANCE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KIE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(kieRequestBody)
  })

  const responseText = await response.text()

  if (!response.ok) {
    console.error(`[generate-story-video] [${modelLabel}] API error:`, response.status, responseText)
    return { success: false, error: `API error: ${response.status}` }
  }

  let data: KieApiResponse
  try {
    data = JSON.parse(responseText)
  } catch (e) {
    console.error(`[generate-story-video] [${modelLabel}] 解析响应失败:`, responseText)
    return { success: false, error: "Invalid API response" }
  }

  console.log(`[generate-story-video] [${modelLabel}] API 响应:`, data)

  if (data.code !== 200) {
    console.error(`[generate-story-video] [${modelLabel}] 生成失败:`, data.msg)
    return { success: false, error: data.msg || "Video generation failed" }
  }

  const taskId = data.data?.taskId
  if (!taskId) {
    console.error(`[generate-story-video] [${modelLabel}] 未返回 taskId:`, data)
    return { success: false, error: "No task ID returned" }
  }

  console.log(`[generate-story-video] [${modelLabel}] 任务创建成功:`, { taskId })

  // 存储任务映射（用于 webhook 回调时扣除积分）
  if (userId) {
    try {
      await db.insert(aiGenerationTasks).values({
        id: uuidv4(),
        taskId: taskId,
        userId: userId,
        taskType: taskType,
        pointsAmount: pointsAmount,
        pointsDeducted: false,
        status: 'pending',
        projectId: projectId || null,
        versionId: versionId || null,
        itemId: sceneId ? String(sceneIndex) : null,
        versionGroupId: versionGroupId || null,
        newVersionId: null,
      })
      console.log(`[generate-story-video] [${modelLabel}] 任务映射已存储:`, { taskId, userId, pointsAmount, projectId, sceneIndex, sceneId, versionId, versionGroupId })
    } catch (error) {
      console.error(`[generate-story-video] [${modelLabel}] 存储任务映射失败:`, error)
    }
  }

  // 判断是否使用 webhook 模式
  if (finalWebhookUrl) {
    return { success: true, requestId: taskId }
  }

  // 轮询模式
  const result = await pollSeedanceVideoStatus(taskId, userId, taskId, durationParam.toString(), is25, isFast, isMini, pointsPerSecond)
  return result
}

/**
 * 轮询查询 Seedance 视频状态
 */
async function pollSeedanceVideoStatus(
  taskId: string,
  userId?: string,
  storedTaskId?: string,
  duration?: string,
  is25?: boolean,
  isFast?: boolean,
  isMini?: boolean,
  pointsPerSecond?: number
): Promise<{ success: boolean; videoUrl?: string; requestId?: string; error?: string }> {
  const maxRetries = 180 // 15分钟超时
  let retryCount = 0
  const pts = pointsPerSecond ?? getVideoUnitPoints(is25 ? 'seedance25' : (isMini ? 'seedance2Mini' : (isFast ? 'seedance2Fast' : 'seedance2')))
  const label = is25 ? 'Seedance 2.5' : (isMini ? 'Seedance 2.0 Mini' : (isFast ? 'Seedance 2.0 Fast' : 'Seedance 2.0'))

  while (retryCount < maxRetries) {
    try {
      const queryResponse = await fetch(`${KIE_SEEDANCE_DETAIL_URL}?taskId=${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${KIE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      })

      if (!queryResponse.ok) {
        console.error(`[generate-story-video] [${label}] 查询失败:`, queryResponse.status)
        retryCount++
        await new Promise(resolve => setTimeout(resolve, 5000))
        continue
      }

      const queryData: KieApiResponse = await queryResponse.json()
      console.log(`[generate-story-video] [${label}] 查询状态:`, {
        taskId,
        code: queryData.code,
        task: queryData.data
      })

      if (queryData.code === 200 && queryData.data) {
        const taskData = queryData.data
        const taskStatus = taskData.taskStatus || taskData.task_status

        // 成功
        if (taskStatus === 'SUCCESS' || taskStatus === 'success') {
          const resultUrls = taskData.result?.resultUrls || []
          const videoUrl = resultUrls[0] || ''

          if (videoUrl) {
            console.log(`[generate-story-video] [${label}] 视频生成成功:`, { taskId, videoUrl })

            // 扣除积分
            if (userId) {
              try {
                const durationSeconds = parseInt(duration || '8', 10)
                const pointsAmount = Math.round(durationSeconds * pts)

                // 更新任务状态为成功
                await db.update(aiGenerationTasks)
                  .set({
                    status: 'success',
                    pointsDeducted: true,
                    updatedAt: new Date()
                  })
                  .where(eq(aiGenerationTasks.taskId, taskId))

                // 扣除积分
                await deductPoints(
                  userId,
                  pointsAmount,
                  undefined,
                  PointsAction.GENERATE_STORY_VIDEO
                )
                console.log(`[generate-story-video] [${label}] 用户 ${userId} 成功生成视频（${durationSeconds}秒），扣除 ${pointsAmount} 积分`)
              } catch (deductError) {
                console.error(`[generate-story-video] [${label}] 扣除积分失败:`, deductError)
              }
            }

            return { success: true, videoUrl, requestId: taskId }
          }
          return { success: false, error: "No video URL in result" }
        }

        // 失败
        if (taskStatus === 'FAILED' || taskStatus === 'fail') {
          const errorMsg = taskData.result?.failMsg || taskData.errorMessage || "Video generation failed"
          console.error(`[generate-story-video] [${label}] 视频生成失败:`, { taskId, errorMsg })
          return { success: false, error: errorMsg }
        }

        // 生成中
        if (taskStatus === 'PENDING' || taskStatus === 'PROCESSING' || taskStatus === 'pending') {
          console.log(`[generate-story-video] [${label}] 视频生成中...`, { taskId, status: taskStatus })
        }
      }

    } catch (queryError) {
      console.error(`[generate-story-video] [${label}] 查询出错:`, queryError)
    }

    await new Promise(resolve => setTimeout(resolve, 5000))
    retryCount++
  }

  console.error(`[generate-story-video] [${label}] 轮询超时:`, { taskId })
  return { success: false, error: "Video generation timeout" }
}


/**
 * 使用 Kie.ai Wan 2.7 生成视频（图生视频/首尾帧视频）
 * videoModel='wan27' 时使用此函数（2积分/s，720p，audio on）
 * 支持首尾帧模式：如果提供了 additionalImageUrls，会使用 first_frame_url + last_frame_url
 */
async function generateWithWan(
  imageUrl: string,
  prompt: string,
  aspectRatio?: string,
  duration?: string,
  videoModel?: string,
  videoStyle?: string,
  webhookUrl?: string,
  userId?: string,
  routeTo?: string,
  projectId?: string,
  sceneIndex?: number,
  sceneId?: string,
  versionId?: string,
  versionGroupId?: string,
  additionalImageUrls?: string[]
): Promise<{ success: boolean; videoUrl?: string; requestId?: string; error?: string }> {
  if (!imageUrl || !imageUrl.trim()) {
    return { success: false, error: "Image URL is required" }
  }

  if (!prompt || !prompt.trim()) {
    return { success: false, error: "Prompt is required" }
  }

  // Wan 2.7 支持的画面比例
  const validAspectRatios = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9']
  const aspectRatioParam = validAspectRatios.includes(aspectRatio || '') ? aspectRatio! : '16:9'

  // 验证时长 (2-15)
  const durationSeconds = parseInt(String(duration || '5').replace(/s$/i, ''), 10)
  const durationParam = (!isNaN(durationSeconds) && durationSeconds >= 2 && durationSeconds <= 15)
    ? durationSeconds
    : 5

  // 获取尾帧图片
  const lastFrameUrl = additionalImageUrls?.[0] || ''

  const kieRequestBody: KieRequestBody = {
    model: "wan/2-7-image-to-video",
    input: {
      prompt: prompt,
      first_frame_url: imageUrl,
      last_frame_url: lastFrameUrl || undefined,  // Wan 支持尾帧
      resolution: "720p",
      duration: durationParam,
      prompt_extend: true,
      watermark: false,
      nsfw_checker: false,
      driving_audio_url: "", // 开启音频生成（传空字符串触发自动音频）
    }
  }

  // 如果没有尾帧，移除该字段
  if (!lastFrameUrl) {
    delete kieRequestBody.input!.last_frame_url
  }

  // 配置 webhook（与 Kling/Seedance 共用环境变量）
  const finalWebhookUrl = KLING_WEBHOOK_URL || webhookUrl
  if (finalWebhookUrl) {
    kieRequestBody.callBackUrl = finalWebhookUrl
  }

  const taskType = 'wan_2_7_video'
  const pointsPerSecond = getVideoUnitPoints('wan27')
  const pointsAmount = durationParam * pointsPerSecond

  console.log(`[generate-story-video] [Wan 2.7] 创建视频任务:`, {
    imageUrl: imageUrl.substring(0, 50) + '...',
    lastFrameUrl: lastFrameUrl ? lastFrameUrl.substring(0, 50) + '...' : 'none',
    hasLastFrame: !!lastFrameUrl,
    promptLength: prompt.length,
    aspectRatio: aspectRatioParam,
    duration: durationParam,
    pointsPerSecond,
    promptExtend: true,
    audio: true,
    useWebhook: !!finalWebhookUrl
  })

  // 调用 Kie.ai Wan 2.7 API
  const response = await fetch(KIE_WAN_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KIE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(kieRequestBody)
  })

  const responseText = await response.text()

  if (!response.ok) {
    console.error(`[generate-story-video] [Wan 2.7] API error:`, response.status, responseText)
    return { success: false, error: `API error: ${response.status}` }
  }

  let data: KieApiResponse
  try {
    data = JSON.parse(responseText)
  } catch (e) {
    console.error(`[generate-story-video] [Wan 2.7] 解析响应失败:`, responseText)
    return { success: false, error: "Invalid API response" }
  }

  console.log(`[generate-story-video] [Wan 2.7] API 响应:`, data)

  if (data.code !== 200) {
    console.error(`[generate-story-video] [Wan 2.7] 生成失败:`, data.msg)
    return { success: false, error: data.msg || "Video generation failed" }
  }

  const taskId = data.data?.taskId
  if (!taskId) {
    console.error(`[generate-story-video] [Wan 2.7] 未返回 taskId:`, data)
    return { success: false, error: "No task ID returned" }
  }

  console.log(`[generate-story-video] [Wan 2.7] 任务创建成功:`, { taskId })

  // 存储任务映射（用于 webhook 回调时扣除积分）
  if (userId) {
    try {
      await db.insert(aiGenerationTasks).values({
        id: uuidv4(),
        taskId: taskId,
        userId: userId,
        taskType: taskType,
        pointsAmount: pointsAmount,
        pointsDeducted: false,
        status: 'pending',
        projectId: projectId || null,
        versionId: versionId || null,
        itemId: sceneId ? String(sceneIndex) : null,
        versionGroupId: versionGroupId || null,
        newVersionId: null,
      })
      console.log(`[generate-story-video] [Wan 2.7] 任务映射已存储:`, { taskId, userId, pointsAmount, projectId, sceneIndex, sceneId, versionId, versionGroupId })
    } catch (error) {
      console.error(`[generate-story-video] [Wan 2.7] 存储任务映射失败:`, error)
    }
  }

  // 判断是否使用 webhook 模式
  if (finalWebhookUrl) {
    return { success: true, requestId: taskId }
  }

  // 轮询模式
  const result = await pollWanVideoStatus(taskId, userId, durationParam.toString())
  return result
}

/**
 * 轮询查询 Wan 2.7 视频状态
 */
async function pollWanVideoStatus(
  taskId: string,
  userId?: string,
  duration?: string
): Promise<{ success: boolean; videoUrl?: string; requestId?: string; error?: string }> {
  const maxRetries = 180
  let retryCount = 0

  while (retryCount < maxRetries) {
    try {
      const queryResponse = await fetch(`${KIE_WAN_DETAIL_URL}?taskId=${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${KIE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      })

      if (!queryResponse.ok) {
        console.error(`[generate-story-video] [Wan 2.7] 查询失败:`, queryResponse.status)
        retryCount++
        await new Promise(resolve => setTimeout(resolve, 5000))
        continue
      }

      const queryData: KieApiResponse = await queryResponse.json()
      console.log(`[generate-story-video] [Wan 2.7] 查询状态:`, {
        taskId,
        code: queryData.code,
        task: queryData.data
      })

      if (queryData.code === 200 && queryData.data) {
        const taskData = queryData.data
        const taskStatus = taskData.taskStatus || taskData.task_status

        if (taskStatus === 'SUCCESS' || taskStatus === 'success') {
          const resultUrls = taskData.result?.resultUrls || []
          const videoUrl = resultUrls[0] || ''

          if (videoUrl) {
            console.log(`[generate-story-video] [Wan 2.7] 视频生成成功:`, { taskId, videoUrl })

            if (userId) {
              try {
                const durationSeconds = parseInt(duration || '5', 10)
                const pointsAmount = computeVideoPoints('wan27', durationSeconds)

                await db.update(aiGenerationTasks)
                  .set({
                    status: 'success',
                    pointsDeducted: true,
                    updatedAt: new Date()
                  })
                  .where(eq(aiGenerationTasks.taskId, taskId))

                await deductPoints(
                  userId,
                  pointsAmount,
                  undefined,
                  PointsAction.GENERATE_STORY_VIDEO
                )
                console.log(`[generate-story-video] [Wan 2.7] 用户 ${userId} 成功生成视频（${durationSeconds}秒），扣除 ${pointsAmount} 积分`)
              } catch (deductError) {
                console.error(`[generate-story-video] [Wan 2.7] 扣除积分失败:`, deductError)
              }
            }

            return { success: true, videoUrl, requestId: taskId }
          }
          return { success: false, error: "No video URL in result" }
        }

        if (taskStatus === 'FAILED' || taskStatus === 'fail') {
          const errorMsg = taskData.result?.failMsg || taskData.errorMessage || "Video generation failed"
          console.error(`[generate-story-video] [Wan 2.7] 视频生成失败:`, { taskId, errorMsg })
          return { success: false, error: errorMsg }
        }

        if (taskStatus === 'PENDING' || taskStatus === 'PROCESSING' || taskStatus === 'pending') {
          console.log(`[generate-story-video] [Wan 2.7] 视频生成中...`, { taskId, status: taskStatus })
        }
      }

    } catch (queryError) {
      console.error(`[generate-story-video] [Wan 2.7] 查询出错:`, queryError)
    }

    await new Promise(resolve => setTimeout(resolve, 5000))
    retryCount++
  }

  console.error(`[generate-story-video] [Wan 2.7] 轮询超时:`, { taskId })
  return { success: false, error: "Video generation timeout" }
}


/**
 * 使用 Kie.ai HappyHorse 生成视频（图生视频）
 * videoModel='happyHorse' 时使用此函数（2积分/s，默认 720p，底层调用 HappyHorse 1.1 接口）
 * API文档: https://docs.kie.ai/cn/market/happyhorse-1-1
 */
async function generateWithHappyHorse(
  imageUrl: string,
  prompt: string,
  aspectRatio?: string,
  duration?: string,
  webhookUrl?: string,
  userId?: string,
  projectId?: string,
  sceneIndex?: number,
  sceneId?: string,
  versionId?: string,
  versionGroupId?: string
): Promise<{ success: boolean; videoUrl?: string; requestId?: string; error?: string }> {
  if (!imageUrl || !imageUrl.trim()) {
    return { success: false, error: "Image URL is required" }
  }

  if (!prompt || !prompt.trim()) {
    return { success: false, error: "Prompt is required" }
  }

  // HappyHorse API 配置（使用顶部定义的常量）
  // 验证时长 (3-15秒)
  const durationSeconds = parseInt(String(duration || '5').replace(/s$/i, ''), 10)
  const durationParam = (!isNaN(durationSeconds) && durationSeconds >= 3 && durationSeconds <= 15)
    ? durationSeconds
    : 5

  // 构建 webhook URL
  const finalWebhookUrl = webhookUrl || (projectId ? `${KLING_WEBHOOK_URL || `${process.env.NEXT_PUBLIC_APP_URL}/api/ai/kie/video-webhook`}?projectId=${projectId}&sceneIndex=${sceneIndex}&sceneId=${sceneId}&versionId=${versionId}&versionGroupId=${versionGroupId}` : (KLING_WEBHOOK_URL || `${process.env.NEXT_PUBLIC_APP_URL}/api/ai/kie/video-webhook`))

  // 构建请求体
  // HappyHorse：API 调用 HappyHorse 1.1 接口（happyhorse-1-1/image-to-video），默认 720p
  const kieRequestBody: KieRequestBody = {
    model: "happyhorse-1-1/image-to-video",
    callBackUrl: finalWebhookUrl,
    input: {
      prompt: prompt,
      image_urls: [imageUrl],
      resolution: "720p",
      duration: durationParam,
    }
  }

  const taskType = 'happyhorse_video'
  const pointsPerSecond = getVideoUnitPoints('happyHorse')
  const pointsAmount = durationParam * pointsPerSecond

  console.log(`[generate-story-video] [HappyHorse] 创建视频任务:`, {
    imageUrl: imageUrl.substring(0, 50) + '...',
    promptLength: prompt.length,
    duration: durationParam,
    resolution: '720p',
    pointsPerSecond,
    useWebhook: !!finalWebhookUrl
  })

  // 调用 Kie.ai HappyHorse API
  const response = await fetch(KIE_HAPPYHORSE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KIE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(kieRequestBody)
  })

  const responseText = await response.text()

  if (!response.ok) {
    console.error(`[generate-story-video] [HappyHorse] API error:`, response.status, responseText)
    return { success: false, error: `API error: ${response.status}` }
  }

  let data: KieApiResponse
  try {
    data = JSON.parse(responseText)
  } catch (e) {
    console.error(`[generate-story-video] [HappyHorse] 解析响应失败:`, responseText)
    return { success: false, error: "Invalid API response" }
  }

  console.log(`[generate-story-video] [HappyHorse] API 响应:`, data)

  if (data.code !== 200) {
    console.error(`[generate-story-video] [HappyHorse] 生成失败:`, data.msg)
    return { success: false, error: data.msg || "Video generation failed" }
  }

  const taskId = data.data?.taskId
  if (!taskId) {
    console.error(`[generate-story-video] [HappyHorse] 未返回 taskId:`, data)
    return { success: false, error: "No task ID returned" }
  }

  console.log(`[generate-story-video] [HappyHorse] 任务创建成功:`, { taskId })

  // 存储任务映射（用于 webhook 回调时扣除积分）
  if (userId) {
    try {
      await db.insert(aiGenerationTasks).values({
        id: uuidv4(),
        taskId: taskId,
        userId: userId,
        taskType: taskType,
        pointsAmount: pointsAmount,
        pointsDeducted: false,
        status: 'pending',
        projectId: projectId || null,
        versionId: versionId || null,
        itemId: sceneId ? String(sceneIndex) : null,
        versionGroupId: versionGroupId || null,
        newVersionId: null,
      })
      console.log(`[generate-story-video] [HappyHorse] 任务映射已存储:`, { taskId, userId, pointsAmount, projectId, sceneIndex, sceneId, versionId, versionGroupId })
    } catch (error) {
      console.error(`[generate-story-video] [HappyHorse] 存储任务映射失败:`, error)
    }
  }

  // 判断是否使用 webhook 模式
  if (finalWebhookUrl) {
    return { success: true, requestId: taskId }
  }

  // 轮询模式
  const result = await pollHappyHorseVideoStatus(taskId, userId, durationParam.toString())
  return result
}

/**
 * 轮询查询 HappyHorse 视频状态
 */
async function pollHappyHorseVideoStatus(
  taskId: string,
  userId?: string,
  duration?: string
): Promise<{ success: boolean; videoUrl?: string; requestId?: string; error?: string }> {
  const maxRetries = 180
  let retryCount = 0

  while (retryCount < maxRetries) {
    try {
      const queryResponse = await fetch(`${KIE_HAPPYHORSE_DETAIL_URL}?taskId=${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${KIE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      })

      if (!queryResponse.ok) {
        console.error(`[generate-story-video] [HappyHorse] 查询失败:`, queryResponse.status)
        retryCount++
        await new Promise(resolve => setTimeout(resolve, 5000))
        continue
      }

      const queryData: KieApiResponse = await queryResponse.json()
      console.log(`[generate-story-video] [HappyHorse] 查询状态:`, {
        taskId,
        code: queryData.code,
        task: queryData.data
      })

      if (queryData.code === 200 && queryData.data) {
        const taskData = queryData.data
        const taskStatus = taskData.taskStatus || taskData.status

        if (taskStatus === 'SUCCESS' || taskStatus === 'success' || taskStatus === 'completed') {
          const resultUrls = taskData.result?.videoUrl || taskData.result?.resultUrls || []
          const videoUrl = Array.isArray(resultUrls) ? resultUrls[0] : resultUrls || ''

          if (videoUrl) {
            console.log(`[generate-story-video] [HappyHorse] 视频生成成功:`, { taskId, videoUrl })

            if (userId) {
              try {
                const durationSeconds = parseInt(duration || '5', 10)
                const pointsAmount = computeVideoPoints('happyHorse', durationSeconds)

                await db.update(aiGenerationTasks)
                  .set({
                    status: 'success',
                    pointsDeducted: true,
                    updatedAt: new Date()
                  })
                  .where(eq(aiGenerationTasks.taskId, taskId))

                await deductPoints(
                  userId,
                  pointsAmount,
                  `HappyHorse 视频生成: ${taskId}`
                )

                console.log(`[generate-story-video] [HappyHorse] 积分已扣除:`, { userId, pointsAmount, taskId })
              } catch (error) {
                console.error(`[generate-story-video] [HappyHorse] 扣除积分失败:`, error)
              }
            }

            return { success: true, videoUrl, requestId: taskId }
          }
        }

        // 失败
        if (taskStatus === 'FAILED' || taskStatus === 'fail' || taskStatus === 'failed') {
          const errorMsg = taskData.result?.failMsg || taskData.errorMessage || taskData.message || "Video generation failed"
          console.error(`[generate-story-video] [HappyHorse] 视频生成失败:`, { taskId, errorMsg })
          return { success: false, error: errorMsg }
        }

        // 生成中
        if (taskStatus === 'PENDING' || taskStatus === 'PROCESSING' || taskStatus === 'pending' || taskStatus === 'running') {
          console.log(`[generate-story-video] [HappyHorse] 视频生成中...`, { taskId, status: taskStatus })
        }
      }

    } catch (queryError) {
      console.error(`[generate-story-video] [HappyHorse] 查询出错:`, queryError)
    }

    await new Promise(resolve => setTimeout(resolve, 5000))
    retryCount++
  }

  console.error(`[generate-story-video] [HappyHorse] 轮询超时:`, { taskId })
  return { success: false, error: "Video generation timeout" }
}


/**
 * 使用 Kie.ai Gemini Omni 生成视频
 * videoModel='geminiOmni' 时使用此函数
 * 1积分/s，固定 4/6/8/10s，1080p，不支持首尾帧
 * API文档: https://docs.kie.ai/cn/market/gemini-omni-video
 */
async function generateWithGeminiOmni(
  imageUrl: string,
  prompt: string,
  aspectRatio?: string,
  duration?: string,
  webhookUrl?: string,
  userId?: string,
  projectId?: string,
  sceneIndex?: number,
  sceneId?: string,
  versionId?: string,
  versionGroupId?: string,
  additionalImageUrls?: string[]
): Promise<{ success: boolean; videoUrl?: string; requestId?: string; error?: string }> {
  if (!prompt || !prompt.trim()) {
    return { success: false, error: "Prompt is required" }
  }

  const durationSeconds = parseInt(String(duration || '8').replace(/s$/i, ''), 10)
  const allowedDurations = [4, 6, 8, 10]
  if (!allowedDurations.includes(durationSeconds)) {
    return { success: false, error: `Gemini Omni 只支持 4/6/8/10s，当前: ${durationSeconds}s` }
  }

  const resolution = '1080p'
  const finalAspectRatio = aspectRatio || '16:9'
  const taskType = 'gemini_omni_video'
  const pointsPerSecond = getVideoUnitPoints('geminiOmni')
  const pointsAmount = durationSeconds * pointsPerSecond

  // 构建 image_urls：imageUrl + additionalImageUrls（Gemini Omni 不支持首尾帧，仅作参考图）
  const allImageUrls: string[] = []
  if (imageUrl && imageUrl.trim()) {
    allImageUrls.push(imageUrl.trim())
  }
  if (additionalImageUrls && additionalImageUrls.length > 0) {
    allImageUrls.push(...additionalImageUrls.filter(url => url && url.trim()))
  }

  const apiUrl = KIE_GEMINI_OMNI_API_URL
  const callbackUrl = webhookUrl || KLING_WEBHOOK_URL

  // 构建请求体
  const requestBody: KieRequestBody = {
    model: 'gemini-omni-video',
    input: {
      prompt: prompt.trim(),
      duration: String(durationSeconds),
      aspect_ratio: finalAspectRatio,
      resolution
    }
  }

  if (allImageUrls.length > 0) {
    requestBody.input!.image_urls = allImageUrls.slice(0, 7)
  }

  if (callbackUrl) {
    requestBody.callBackUrl = callbackUrl
  }

  console.log(`[generate-story-video] [Gemini Omni] 创建视频任务:`, {
    promptLength: prompt.length,
    duration: durationSeconds,
    resolution,
    aspectRatio: finalAspectRatio,
    imageCount: allImageUrls.length,
    useWebhook: !!callbackUrl
  })

  // 调用 API
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${KIE_API_KEY}`
    },
    body: JSON.stringify(requestBody)
  })

  const responseText = await response.text()
  let data: KieApiResponse
  try {
    data = JSON.parse(responseText)
  } catch (e) {
    console.error(`[generate-story-video] [Gemini Omni] 解析响应失败:`, responseText)
    return { success: false, error: "Invalid API response" }
  }

  console.log(`[generate-story-video] [Gemini Omni] API 响应:`, data)

  if (data.code !== 200) {
    console.error(`[generate-story-video] [Gemini Omni] 生成失败:`, data.msg)
    return { success: false, error: data.msg || "Video generation failed" }
  }

  const taskId = data.data?.taskId
  if (!taskId) {
    console.error(`[generate-story-video] [Gemini Omni] 未返回 taskId:`, data)
    return { success: false, error: "No task ID returned" }
  }

  console.log(`[generate-story-video] [Gemini Omni] 任务创建成功:`, { taskId })

  // 存储任务映射（用于 webhook 回调时扣除积分）
  if (userId) {
    try {
      await db.insert(aiGenerationTasks).values({
        id: uuidv4(),
        taskId: taskId,
        userId: userId,
        taskType: taskType,
        pointsAmount: pointsAmount,
        pointsDeducted: false,
        status: 'pending',
        projectId: projectId || null,
        versionId: versionId || null,
        itemId: sceneId ? String(sceneIndex) : null,
        versionGroupId: versionGroupId || null,
        newVersionId: null,
      })
      console.log(`[generate-story-video] [Gemini Omni] 任务映射已存储:`, { taskId, userId, pointsAmount, projectId, sceneIndex, sceneId, versionId, versionGroupId })
    } catch (dbError) {
      console.error(`[generate-story-video] [Gemini Omni] 存储任务映射失败:`, dbError)
    }
  }

  return {
    success: true,
    videoUrl: '',
    requestId: taskId
  }
}


/**
 * 使用 Kie.ai MiniMax H3 生成视频（图生视频/首尾帧视频）
 * videoModel='minimaxH3' 时使用此函数（2.5积分/s，4-15s，768p）
 * 支持首尾帧模式：如果提供了 additionalImageUrls，会使用 first_frame_url + last_frame_url
 * API文档: https://docs.kie.ai/cn/market/minimax-h3/image-to-video
 */
async function generateWithMinimaxH3(
  imageUrl: string,
  prompt: string,
  aspectRatio?: string,
  duration?: string,
  webhookUrl?: string,
  userId?: string,
  projectId?: string,
  sceneIndex?: number,
  sceneId?: string,
  versionId?: string,
  versionGroupId?: string,
  additionalImageUrls?: string[]
): Promise<{ success: boolean; videoUrl?: string; requestId?: string; error?: string }> {
  if (!imageUrl || !imageUrl.trim()) {
    return { success: false, error: "Image URL is required for MiniMax H3" }
  }

  if (!prompt || !prompt.trim()) {
    return { success: false, error: "Prompt is required" }
  }

  // MiniMax H3 支持的画面比例
  const validAspectRatios = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9']
  const aspectRatioParam = validAspectRatios.includes(aspectRatio || '') ? aspectRatio! : '16:9'

  // 验证时长 (4-15秒)
  const durationSeconds = parseInt(String(duration || '6').replace(/s$/i, ''), 10)
  const durationParam = (!isNaN(durationSeconds) && durationSeconds >= 4 && durationSeconds <= 15)
    ? durationSeconds
    : 6

  // 获取尾帧图片
  const lastFrameUrl = additionalImageUrls?.[0] || ''

  // MiniMax H3 至少需要首帧或尾帧图片
  if (!imageUrl && !lastFrameUrl) {
    return { success: false, error: "MiniMax H3 requires at least first_frame_url or last_frame_url" }
  }

  const kieRequestBody: KieRequestBody = {
    model: "minimax-h3/image-to-video",
    input: {
      prompt: prompt,
      first_frame_url: imageUrl || undefined,
      last_frame_url: lastFrameUrl || undefined,
      duration: durationParam,
      resolution: '768p',
    }
  }

  // 配置 webhook
  const finalWebhookUrl = webhookUrl || KLING_WEBHOOK_URL
  if (finalWebhookUrl) {
    kieRequestBody.callBackUrl = finalWebhookUrl
  }

  const taskType = 'minimax_h3_video'
  const pointsPerSecond = getVideoUnitPoints('minimaxH3')
  const pointsAmount = durationParam * pointsPerSecond

  console.log(`[generate-story-video] [MiniMax H3] 创建视频任务:`, {
    imageUrl: imageUrl ? imageUrl.substring(0, 50) + '...' : 'none',
    lastFrameUrl: lastFrameUrl ? lastFrameUrl.substring(0, 50) + '...' : 'none',
    hasLastFrame: !!lastFrameUrl,
    promptLength: prompt.length,
    duration: durationParam,
    pointsPerSecond,
    useWebhook: !!finalWebhookUrl
  })

  // 调用 Kie.ai MiniMax H3 API
  const response = await fetch(KIE_MINIMAX_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KIE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(kieRequestBody)
  })

  const responseText = await response.text()

  if (!response.ok) {
    console.error(`[generate-story-video] [MiniMax H3] API error:`, response.status, responseText)
    return { success: false, error: `API error: ${response.status}` }
  }

  let data: KieApiResponse
  try {
    data = JSON.parse(responseText)
  } catch (e) {
    console.error(`[generate-story-video] [MiniMax H3] 解析响应失败:`, responseText)
    return { success: false, error: "Invalid API response" }
  }

  console.log(`[generate-story-video] [MiniMax H3] API 响应:`, data)

  if (data.code !== 200) {
    console.error(`[generate-story-video] [MiniMax H3] 生成失败:`, data.msg)
    return { success: false, error: data.msg || "Video generation failed" }
  }

  const taskId = data.data?.taskId
  if (!taskId) {
    console.error(`[generate-story-video] [MiniMax H3] 未返回 taskId:`, data)
    return { success: false, error: "No task ID returned" }
  }

  console.log(`[generate-story-video] [MiniMax H3] 任务创建成功:`, { taskId })

  // 存储任务映射（用于 webhook 回调时扣除积分）
  if (userId) {
    try {
      await db.insert(aiGenerationTasks).values({
        id: uuidv4(),
        taskId: taskId,
        userId: userId,
        taskType: taskType,
        pointsAmount: pointsAmount,
        pointsDeducted: false,
        status: 'pending',
        projectId: projectId || null,
        versionId: versionId || null,
        itemId: sceneId ? String(sceneIndex) : null,
        versionGroupId: versionGroupId || null,
        newVersionId: null,
      })
      console.log(`[generate-story-video] [MiniMax H3] 任务映射已存储:`, { taskId, userId, pointsAmount, projectId, sceneIndex, sceneId, versionId, versionGroupId })
    } catch (dbError) {
      console.error(`[generate-story-video] [MiniMax H3] 存储任务映射失败:`, dbError)
    }
  }

  // 判断是否使用 webhook 模式
  if (finalWebhookUrl) {
    return { success: true, requestId: taskId }
  }

  // 轮询模式
  const result = await pollMinimaxH3VideoStatus(taskId, userId, durationParam.toString())
  return result
}

/**
 * 轮询查询 MiniMax H3 视频状态
 */
async function pollMinimaxH3VideoStatus(
  taskId: string,
  userId?: string,
  duration?: string
): Promise<{ success: boolean; videoUrl?: string; requestId?: string; error?: string }> {
  // MiniMax H3 4-15s，轮询时间可以短一些
  const maxRetries = 180
  let retryCount = 0

  while (retryCount < maxRetries) {
    try {
      const queryResponse = await fetch(`${KIE_MINIMAX_DETAIL_URL}?taskId=${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${KIE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      })

      if (!queryResponse.ok) {
        console.error('[generate-story-video] [MiniMax H3] 查询失败:', queryResponse.status)
        retryCount++
        await new Promise(resolve => setTimeout(resolve, 5000))
        continue
      }

      const queryData: KieApiResponse = await queryResponse.json()
      console.log('[generate-story-video] [MiniMax H3] 查询状态:', {
        taskId,
        code: queryData.code,
        state: queryData.data?.state,
        successFlag: queryData.data?.successFlag
      })

      if (queryData.code === 200 && queryData.data) {
        const taskData = queryData.data
        const successFlag = taskData.successFlag

        // 成功
        if (successFlag === 1) {
          const response = taskData.response || {}
          const videoUrl = response.videoUrl || response.url || (response.urls && response.urls[0])

          if (videoUrl) {
            console.log(`[generate-story-video] [MiniMax H3] 生成成功:`, { taskId, videoUrl })
            return { success: true, videoUrl, requestId: taskId }
          }
        }

        // 失败
        if (successFlag === 2 || successFlag === 3) {
          const errorMsg = taskData.response?.errorMessage || taskData.response?.error || 'Video generation failed'
          console.error(`[generate-story-video] [MiniMax H3] 生成失败:`, { taskId, successFlag, errorMsg })
          return { success: false, error: errorMsg, requestId: taskId }
        }
      }

      retryCount++
      await new Promise(resolve => setTimeout(resolve, 5000))
    } catch (error) {
      console.error(`[generate-story-video] [MiniMax H3] 查询异常:`, error)
      retryCount++
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
  }

  console.error(`[generate-story-video] [MiniMax H3] 轮询超时:`, { taskId })
  return { success: false, error: "Video generation timeout" }
}


/**
 * 使用 Kie.ai Kling 3.0 生成视频（图生视频/首尾帧视频）
 * videoModel='kling3' 时使用此函数
 * 支持首尾帧模式：如果提供了 additionalImageUrls，会使用 image_urls[0] + image_urls[1]
 */
async function generateWithKling(
  imageUrl: string,
  prompt: string,
  aspectRatio?: string,
  duration?: string,
  videoModel?: string,
  videoStyle?: string,
  webhookUrl?: string,
  userId?: string,
  projectId?: string,
  sceneIndex?: number,
  sceneId?: string,
  versionId?: string,
  versionGroupId?: string,
  additionalImageUrls?: string[]
): Promise<{ success: boolean; videoUrl?: string; requestId?: string; error?: string }> {
  if (!imageUrl || !imageUrl.trim()) {
    return { success: false, error: "Image URL is required" }
  }

  if (!prompt || !prompt.trim()) {
    return { success: false, error: "Prompt is required" }
  }

  // Kling 支持的画面比例
  const validAspectRatios = ['16:9', '9:16', '1:1']
  const aspectRatioParam = validAspectRatios.includes(aspectRatio || '') ? aspectRatio! : '16:9'

  // 验证时长 (3-15)
  const durationSeconds = parseInt(String(duration || '5').replace(/s$/i, ''), 10)
  const durationParam = (!isNaN(durationSeconds) && durationSeconds >= 3 && durationSeconds <= 15)
    ? durationSeconds.toString()
    : '5'

  // 视频风格映射到增强提示词
  const videoStyleMap: Record<string, string> = {
    anime: "anime style, Japanese animation style",
    hollywood: "Hollywood cinematic style, film-like quality, dramatic lighting, cinematic color grading",
    ads: "advertisement style, educational video style"
  }

  // 根据视频风格增强 prompt
  let enhancedPrompt = prompt
  if (videoStyle && videoStyle !== 'auto' && videoStyleMap[videoStyle]) {
    enhancedPrompt = `${prompt}, ${videoStyleMap[videoStyle]}`
  }

  // 检查是否有尾帧图片
  const lastFrameUrl = additionalImageUrls?.[0]
  const hasFirstLastFrame = !!lastFrameUrl

  // 构建 Kie.ai Kling 3.0 请求体
  const kieRequestBody: KieRequestBody = {
    model: "kling-3.0/video",
    input: {
      prompt: enhancedPrompt,
      image_urls: hasFirstLastFrame 
        ? [imageUrl, lastFrameUrl]  // 首尾帧模式：首帧 + 尾帧
        : [imageUrl],               // 普通模式：首帧图片
      duration: durationParam,
      aspect_ratio: aspectRatioParam,
      mode: "std",
      sound: true,
      multi_shots: false,  // false = 首尾帧模式
    }
  }

  // 配置 webhook（环境变量优先，支持前端覆盖）
  const finalWebhookUrl = KLING_WEBHOOK_URL || webhookUrl
  if (finalWebhookUrl) {
    kieRequestBody.callBackUrl = finalWebhookUrl
  }

  // Kling 图生视频暂不支持 webhook，使用轮询模式
  console.log('[generate-story-video] [Kling 3.0] 创建视频任务:', {
    imageUrl: imageUrl.substring(0, 50) + '...',
    lastFrameUrl: hasFirstLastFrame ? lastFrameUrl.substring(0, 50) + '...' : 'none',
    hasFirstLastFrame,
    promptLength: prompt.length,
    aspectRatio: aspectRatioParam,
    duration: durationParam,
    videoStyle,
    useWebhook: !!finalWebhookUrl
  })

  // 调用 Kie.ai Kling 3.0 API
  const response = await fetch(KIE_KLING_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KIE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(kieRequestBody)
  })

  const responseText = await response.text()

  if (!response.ok) {
    console.error('[generate-story-video] [Kling 3.0] API error:', response.status, responseText)
    return { success: false, error: `API error: ${response.status}` }
  }

  let data: KieApiResponse
  try {
    data = JSON.parse(responseText)
  } catch (e) {
    console.error('[generate-story-video] [Kling 3.0] 解析响应失败:', responseText)
    return { success: false, error: "Invalid API response" }
  }

  console.log('[generate-story-video] [Kling 3.0] API 响应:', data)

  if (data.code !== 200) {
    console.error('[generate-story-video] [Kling 3.0] 生成失败:', data.msg)
    return { success: false, error: data.msg || "Video generation failed" }
  }

  const taskId = data.data?.taskId
  if (!taskId) {
    console.error('[generate-story-video] [Kling 3.0] 未返回 taskId:', data)
    return { success: false, error: "No task ID returned" }
  }

  console.log('[generate-story-video] [Kling 3.0] 任务创建成功:', { taskId })

  // 存储任务映射（用于 webhook 回调时扣除积分）
  if (userId) {
    const durationSeconds = parseInt(durationParam, 10)
    const pointsAmount = computeVideoPoints('kling3', durationSeconds)
    try {
      await db.insert(aiGenerationTasks).values({
        id: uuidv4(),
        taskId: taskId,
        userId: userId,
        taskType: 'kling_3_0_video',
        pointsAmount: pointsAmount,
        pointsDeducted: false,
        status: 'pending',
        projectId: projectId || null,
        versionId: versionId || null,
        itemId: sceneId ? String(sceneIndex) : null,
        versionGroupId: versionGroupId || null,
        newVersionId: null,
      })
      console.log('[generate-story-video] [Kling 3.0] 任务映射已存储:', { taskId, userId, pointsAmount, projectId, sceneIndex, sceneId, versionId, versionGroupId })
    } catch (error) {
      console.error('[generate-story-video] [Kling 3.0] 存储任务映射失败:', error)
    }
  }

  // 判断是否使用 webhook 模式
  if (finalWebhookUrl) {
    return { success: true, requestId: taskId }
  }

  // 轮询模式
  const result = await pollKlingVideoStatus(taskId, userId, taskId, durationParam)
  return result
}

/**
 * 轮询查询 Kling 视频状态
 */
async function pollKlingVideoStatus(
  taskId: string,
  userId?: string,
  storedTaskId?: string,
  duration?: string
): Promise<{ success: boolean; videoUrl?: string; requestId?: string; error?: string }> {
  const maxRetries = 180 // 15分钟超时
  let retryCount = 0

  while (retryCount < maxRetries) {
    try {
      const queryResponse = await fetch(`${KIE_KLING_DETAIL_URL}?taskId=${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${KIE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      })

      if (!queryResponse.ok) {
        console.error('[generate-story-video] [Kling 3.0] 查询失败:', queryResponse.status)
        retryCount++
        await new Promise(resolve => setTimeout(resolve, 5000))
        continue
      }

      const queryData: KieApiResponse = await queryResponse.json()
      console.log('[generate-story-video] [Kling 3.0] 查询状态:', {
        taskId,
        code: queryData.code,
        task: queryData.data
      })

      if (queryData.code === 200 && queryData.data) {
        const taskData = queryData.data
        const taskStatus = taskData.taskStatus || taskData.task_status

        // 成功
        if (taskStatus === 'SUCCESS' || taskStatus === 'success') {
          const resultUrls = taskData.result?.resultUrls || []
          const videoUrl = resultUrls[0] || ''

          if (videoUrl) {
            console.log('[generate-story-video] [Kling 3.0] 视频生成成功:', { taskId, videoUrl })

            // 扣除积分
            if (userId) {
              try {
                const durationSeconds = parseInt(duration || '5', 10)
                const pointsAmount = computeVideoPoints('kling3', durationSeconds)

                // 更新任务状态为成功
                await db.update(aiGenerationTasks)
                  .set({
                    status: 'success',
                    pointsDeducted: true,
                    updatedAt: new Date()
                  })
                  .where(eq(aiGenerationTasks.taskId, taskId))

                // 扣除积分
                await deductPoints(
                  userId,
                  pointsAmount,
                  undefined,
                  PointsAction.GENERATE_STORY_VIDEO
                )
                console.log(`[generate-story-video] [Kling 3.0] 用户 ${userId} 成功生成视频（${durationSeconds}秒），扣除 ${pointsAmount} 积分`)
              } catch (deductError) {
                console.error('[generate-story-video] [Kling 3.0] 扣除积分失败:', deductError)
              }
            }

            return { success: true, videoUrl, requestId: taskId }
          }
          return { success: false, error: "No video URL in result" }
        }

        // 失败
        if (taskStatus === 'FAILED' || taskStatus === 'fail') {
          const errorMsg = taskData.result?.failMsg || taskData.errorMessage || "Video generation failed"
          console.error('[generate-story-video] [Kling 3.0] 视频生成失败:', { taskId, errorMsg })
          return { success: false, error: errorMsg }
        }

        // 生成中
        if (taskStatus === 'PENDING' || taskStatus === 'PROCESSING' || taskStatus === 'pending') {
          console.log('[generate-story-video] [Kling 3.0] 视频生成中...', { taskId, status: taskStatus })
        }
      }

    } catch (queryError) {
      console.error('[generate-story-video] [Kling 3.0] 查询出错:', queryError)
    }

    await new Promise(resolve => setTimeout(resolve, 5000))
    retryCount++
  }

  console.error('[generate-story-video] [Kling 3.0] 轮询超时:', { taskId })
  return { success: false, error: "Video generation timeout" }
}

export async function POST(request: NextRequest) {
  try {
    // 验证用户登录
    const session = await getAuthedSession()
    if (!session) {
      return jsonError(401, 'Unauthorized')
70827}

    // 读取原始请求体
    const rawText = await request.text()
    console.log('[generate-story-video] rawBody:', rawText.substring(0, 200))

    let body: {
      scenes?: Array<{
        id?: string | number
        imageUrl?: string
        image_url?: string
        prompt?: string
        aspectRatio?: string
        aspect_ratio?: string
        duration?: string
        videoModel?: string
        videoStyle?: string
        additionalImageUrls?: string[]
        generationType?: string
        videoUrls?: string[]
        audioUrls?: string[]
      }>
      projectId?: string
      versionId?: string
      versionGroupId?: string
      videoModel?: string
      videoStyle?: string
      imageUrl?: string
      prompt?: string
      aspectRatio?: string
      duration?: string
      webhookUrl?: string
      additionalImageUrls?: string[]
      generationType?: string
      videoUrls?: string[]
      audioUrls?: string[]
      sceneIndex?: number | string
      sceneId?: string | number
    } = {}
    try {
      body = JSON.parse(rawText)
    } catch (e) {
      return NextResponse.json({ error: 'Invalid JSON body', details: String(e) }, { status: 400 })
    }

    // 检查是否是批量请求
    const isBatch = Array.isArray(body?.scenes) && body.scenes.length > 0
    const projectId: string | undefined = body.projectId || undefined

    // 批量请求模式
    if (isBatch) {
      const scenes = body.scenes!
      console.log('[generate-story-video] 批量请求:', { count: scenes.length, projectId })

      // 计算需要扣除的积分总数
      let totalRequiredPoints = 0
      for (const s of scenes!) {
        const duration = s.duration || '8s'
        const seconds = getDurationSeconds(duration)
        const videoModel = s.videoModel || body.videoModel
        const videoStyle = s.videoStyle || body.videoStyle
        const effectiveModel = ['seedance25', 'seedance2Fast', 'seedance2Mini', 'seedance2', 'kling3', 'veo31Fast', 'veo31Lite', 'veo31Quality', 'wan27', 'geminiOmni', 'minimaxH3'].includes(videoModel || '') ? videoModel : null
        const styleFallback = !effectiveModel
          ? (videoStyle === 'anime' ? 'seedance2Fast' : (videoStyle === 'ads' ? 'seedance2' : (videoStyle && videoStyle !== 'auto' ? 'veo31Fast' : 'veo31Fast')))
          : null
        const routeTo = effectiveModel || styleFallback || 'veo31Fast'
        // Seedance 2.5: 9积分/s, Seedance 2.0 Mini: 1.5积分/s, Veo 3.1 Lite/Gemini Omni: 1积分/s, Seedance 2.0/Veo 3.1 Quality: 3积分/s, HappyHorse: 2积分/s, MiniMax H3: 2.5积分/s, 其他: 2积分/s
        const pps = routeTo === 'seedance25'
          ? 9
          : (routeTo === 'seedance2Mini'
            ? 1.5
            : (routeTo === 'seedance2' ? 3 : (routeTo === 'veo31Lite' ? 1 : (routeTo === 'veo31Quality' ? 3 : (routeTo === 'happyHorse' ? 2 : (routeTo === 'geminiOmni' ? 1 : (routeTo === 'minimaxH3' ? 2.5 : 2)))))))
        totalRequiredPoints += seconds * pps
      }

      // 数据库积分字段为整数，先按 Math.round 累加到近似整数
      totalRequiredPoints = Math.round(totalRequiredPoints)

      // 检查积分是否足够
      const userPoints = await getUserPoints(session.user.id)
      if (userPoints < totalRequiredPoints) {
        return NextResponse.json(
          {
            error: '积分不足',
            code: 'INSUFFICIENT_POINTS',
            currentPoints: userPoints,
            requiredPoints: totalRequiredPoints
          },
          { status: 400 }
        )
      }

      const results: Array<{ sceneId?: string | number | null; videoUrl?: string; requestId?: string; error?: string }> = []

      for (let index = 0; index < scenes!.length; index++) {
        const s = scenes![index]
        const imageUrl = s.imageUrl || s.image_url || ''
        const prompt = s.prompt || ''
        const sceneId = s.id != null ? String(s.id) : undefined
        const aspectRatio = s.aspectRatio || s.aspect_ratio || '16:9'
        const duration = s.duration || '8s'
        const videoModel = s.videoModel || body.videoModel
        const videoStyle = s.videoStyle || body.videoStyle
        const effectiveModel = ['seedance25', 'seedance2Fast', 'seedance2Mini', 'seedance2', 'kling3', 'veo31Fast', 'veo31Lite', 'veo31Quality', 'wan27', 'geminiOmni', 'minimaxH3'].includes(videoModel || '') ? videoModel : null
        const styleFallback = !effectiveModel
          ? (videoStyle === 'anime' ? 'seedance2Fast' : (videoStyle === 'ads' ? 'seedance2' : (videoStyle && videoStyle !== 'auto' ? 'veo31Fast' : 'veo31Fast')))
          : null
        const routeTo = effectiveModel || styleFallback || 'veo31Fast'
        const getModelName = (model: string) => {
          const names: Record<string, string> = {
            'seedance25': 'Seedance 2.5',
            'seedance2Fast': 'Seedance 2.0 Fast',
            'seedance2Mini': 'Seedance 2.0 Mini',
            'seedance2': 'Seedance 2.0',
            'kling3': 'Kling 3.0',
            'wan27': 'Wan 2.7',
            'veo31Lite': 'Veo 3.1 Lite',
            'veo31Quality': 'Veo 3.1 Quality',
            'happyHorse': 'HappyHorse',
            'veo31Fast': 'Veo 3.1',
            'minimaxH3': 'MiniMax H3',
            'geminiOmni': 'Gemini Omni'
          }
          return names[model] || 'Veo 3.1'
        }
        const modelName = getModelName(routeTo)

        console.log(`[generate-story-video] [${modelName}] 处理场景:`, { sceneId, promptLength: prompt.length, duration, videoModel, videoStyle })

        // 获取额外的图片URL和生成模式（用于Veo）
        const additionalImageUrls = s.additionalImageUrls || body.additionalImageUrls
        const generationType = s.generationType || body.generationType

        // Seedance 2.0 多模态参考：支持 scene 级覆盖，否则使用 body 级
        const sceneVideoUrls = s.videoUrls || body.videoUrls
        const sceneAudioUrls = s.audioUrls || body.audioUrls

        // 非Veo模型（包括 Gemini Omni、Seedance 2.5）仍然需要 imageUrl
        if ((routeTo === 'seedance25' || routeTo === 'seedance2Fast' || routeTo === 'seedance2Mini' || routeTo === 'seedance2' || routeTo === 'kling3' || routeTo === 'wan27' || routeTo === 'happyHorse' || routeTo === 'geminiOmni' || routeTo === 'minimaxH3') && !imageUrl.trim()) {
          results.push({ sceneId, error: 'Missing imageUrl' })
          continue
        }

        const result = await generateSingleVideo(
          imageUrl,
          prompt,
          aspectRatio,
          duration,
          routeTo,
          videoStyle,
          undefined,
          session.user.id,
          projectId,
          index,
          sceneId,
          body.versionId,
          body.versionGroupId,
          additionalImageUrls,
          generationType,
          sceneVideoUrls,
          sceneAudioUrls
        )

        trackFunnelEvent({ stage: 'video', userId: session.user.id, projectId: projectId ?? null, success: result.success, provider: 'kieai', model: result.model ?? routeTo, fallbackApplied: (result.model ?? routeTo) !== routeTo, taskId: result.requestId, error: result.error })

        if (result.success) {
          console.log(`[generate-story-video] [${modelName}] 场景完成:`, { sceneId, requestId: result.requestId })
        } else {
          console.error(`[generate-story-video] [${modelName}] 场景失败:`, { sceneId, error: result.error })
        }

        results.push({
          sceneId,
          videoUrl: result.success ? result.videoUrl : undefined,
          requestId: result.requestId,
          error: result.error
        })
      }

      // 批量模式：积分扣除在 webhook 回调或轮询完成时进行
      // 这里不再扣除积分，因为任务可能还在处理中（webhook 模式）

      console.log('[generate-story-video] 批量完成:', { total: results.length, success: results.filter(r => !r.error).length })
      return NextResponse.json({ success: true, results })
    }

    // 单个请求模式
    const { imageUrl, prompt, aspectRatio, duration, videoModel, videoStyle, webhookUrl, versionId, versionGroupId, additionalImageUrls, generationType, videoUrls, audioUrls } = body
    const sceneIndex = body.sceneIndex
    const sceneId = body.sceneId != null ? String(body.sceneId) : undefined
    const durationSeconds = getDurationSeconds(duration)
    const effectiveModel = ['seedance25', 'seedance2Fast', 'seedance2Mini', 'seedance2', 'kling3', 'veo31Fast', 'veo31Lite', 'veo31Quality', 'happyHorse', 'wan27', 'geminiOmni', 'minimaxH3'].includes(videoModel || '') ? videoModel : null
    const styleFallback = !effectiveModel
      ? (videoStyle === 'anime' ? 'seedance2Fast' : (videoStyle === 'ads' ? 'seedance2' : (videoStyle && videoStyle !== 'auto' ? 'veo31Fast' : 'veo31Fast')))
      : null
    const routeTo = effectiveModel || styleFallback || 'veo31Fast'
    // 单价唯一事实源：lib/video-pricing.ts
    const pointsPerSecond = getVideoUnitPoints(routeTo)
    const requiredPoints = Math.round(durationSeconds * pointsPerSecond)
    const getModelName = (model: string) => {
      const names: Record<string, string> = {
        'seedance25': 'Seedance 2.5',
        'seedance2Fast': 'Seedance 2.0 Fast',
        'seedance2Mini': 'Seedance 2.0 Mini',
        'seedance2': 'Seedance 2.0',
        'kling3': 'Kling 3.0',
        'wan27': 'Wan 2.7',
        'veo31Lite': 'Veo 3.1 Lite',
        'veo31Quality': 'Veo 3.1 Quality',
        'happyHorse': 'HappyHorse',
        'geminiOmni': 'Gemini Omni',
        'veo31Fast': 'Veo 3.1',
        'minimaxH3': 'MiniMax H3'
      }
      return names[model] || 'Veo 3.1'
    }
    const modelName = getModelName(routeTo)

    console.log(`[generate-story-video] [${modelName}] 单个请求:`, {
      imageUrl: imageUrl?.substring(0, 50) + '...',
      additionalImageUrls: additionalImageUrls?.map((u: string) => u?.substring(0, 30) + '...'),
      generationType,
      promptLength: prompt?.length,
      aspectRatio,
      duration,
      videoStyle,
      durationSeconds,
      requiredPoints,
      versionId,
      versionGroupId
    })

    // 非Veo模型需要 imageUrl（Seedance, Kling, Wan 都基于图片生成视频）
    const isVeoModel = routeTo === 'veo31Fast' || routeTo === 'veo31Lite' || routeTo === 'veo31Quality'
    if (!isVeoModel && (!imageUrl || !imageUrl.trim())) {
      return NextResponse.json(
        { error: `${modelName} 模式需要提供 imageUrl` },
        { status: 400 }
      )
    }

    // 检查积分是否足够
    const userPoints = await getUserPoints(session.user.id)
    if (userPoints < requiredPoints) {
      return NextResponse.json(
        {
          error: '积分不足',
          code: 'INSUFFICIENT_POINTS',
          currentPoints: userPoints,
          requiredPoints: requiredPoints
        },
        { status: 400 }
      )
    }

    const result = await generateSingleVideo(
      imageUrl ?? '',
      prompt ?? '',
      aspectRatio,
      duration,
      videoModel,
      videoStyle,
      webhookUrl,
      session.user.id,
      projectId,
      sceneIndex != null ? Number(sceneIndex) : undefined,
      sceneId,
      versionId,
      versionGroupId,
      additionalImageUrls,
      generationType,
      videoUrls,
      audioUrls
    )

    trackFunnelEvent({ stage: 'video', userId: session.user.id, projectId: projectId ?? null, success: result.success, provider: 'kieai', model: result.model ?? routeTo, fallbackApplied: (result.model ?? routeTo) !== routeTo, taskId: result.requestId, error: result.error })

    if (!result.success) {
      console.error(`[generate-story-video] [${modelName}] 生成失败:`, { error: result.error })
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    // 积分扣除逻辑：
    // - Webhook 模式：在 webhook 回调成功时扣除（已在 generateSingleVideo 中存储任务映射）
    // - 轮询模式：在 generateSingleVideo 中已完成扣除
    // 这里不再需要扣除积分

    console.log(`[generate-story-video] [${modelName}] 成功:`, { requestId: result.requestId, videoUrl: result.videoUrl?.substring(0, 50) + '...' })
    return NextResponse.json({
      success: true,
      data: {
        videoUrl: result.videoUrl,
        prompt: body.prompt,
        requestId: result.requestId
      }
    })

  } catch (error) {
    console.error('[generate-story-video] API error:', error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

