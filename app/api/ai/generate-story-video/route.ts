import { NextRequest, NextResponse } from "next/server"
import { getAuthedSession, jsonError } from '@/lib/api'
import { getUserPoints, deductPoints, PointsAction } from '@/lib/points'
import { isPaidPlan } from '@/lib/plan-limits'
import { isKnownVideoModel, computeVideoPointsFor, getStyleFallbackModel, type VideoResolution } from '@/lib/video-pricing'
import { users as usersTable } from '@/lib/schema'
import { getVideoFallbackChain } from '@/lib/providers/defaults'
import { submitTask, pollTaskUntilVerdict, resolveBillableSeconds, videoModelLabel, videoModelSupportedResolutions, type SubmitInput, type SubmitMeta } from '@/lib/providers'
import { claimTaskPointsDeduction, markTaskSuccess } from '@/lib/task-points'
import { trackFunnelEvent } from '@/lib/observability/track'
import { db } from '@/lib/db'
import { aiGenerationTasks } from '@/lib/schema'
import { eq } from 'drizzle-orm'

/**
 * POST /api/ai/generate-story-video —— 剧情视频生成入口。
 *
 * 职责：验权与付费门控 → 解析目标模型（videoModel/videoStyle 回退）→ 余额预检
 * → 委托 lib/providers submitTask 提交（供应商知识、任务行落库、计费口径全在 seam 内）。
 * webhook 模式立即返回 taskId 由回调结算；无 webhook 时兜底轮询并按任务行金额结算。
 * 计费单价唯一事实源：lib/video-pricing.ts（预检与落行同源，禁止手抄单价）。
 *
 * Body 契约（单个请求）：
 * {
 *   imageUrl?: string,              // 分镜图 URL（非 Veo 模型必需）
 *   prompt: string,                 // 视频生成提示词
 *   aspectRatio?: string,           // 默认 16:9
 *   duration?: string,              // 如 "4s"/"6s"/"8s"，默认与合法区间随模型
 *   videoModel?: string,            // auto | veo31Fast | veo31Lite | veo31Quality | seedance25
 *                                   // | seedance2Fast | seedance2Mini | seedance2 | kling3
 *                                   // | happyHorse | wan27 | minimaxH3（auto 按 videoStyle 路由）
 *   videoStyle?: string,            // auto | anime | ads | hollywood（增强 prompt 或回退路由）
 *   additionalImageUrls?: string[], // 首尾帧/参考图
 *   generationType?: string,        // 仅 Veo（FIRST_AND_LAST_FRAMES_2_VIDEO / REFERENCE_2_VIDEO），
 *                                   // 不填按图片数自动判断
 *   videoUrls?: string[],           // 仅 Seedance 2.0 系参考视频（≤3）
 *   audioUrls?: string[],           // 仅 Seedance 2.0 系参考音频（≤3）
 *   projectId/versionId/versionGroupId/sceneIndex/sceneId, // 任务行定位字段
 *   webhookUrl?: string             // 自定义回调（环境变量优先）
 * }
 */

/**
 * 生成单个剧情视频：沿降级链逐个提交（模型路由与链的构建在 POST 中完成，
 * 预检已按链上最大消耗取上界）。
 */
async function generateSingleVideo(
  routeTo: string,
  chain: string[],
  input: SubmitInput,
  meta: SubmitMeta,
): Promise<{ success: boolean; videoUrl?: string; requestId?: string; error?: string; model?: string }> {
  // 按降级链提交：供应商知识、任务行落库、计费口径全在 submit seam 内
  const dispatchGeneration = async (model: string): Promise<{ success: boolean; videoUrl?: string; requestId?: string; error?: string }> => {
    const outcome = await submitTask(model, input, meta)
    if (!outcome.ok) return { success: false, error: outcome.error }
    // Gemini Omni webhook-only（历史行为：不轮询，直接返回空 videoUrl 由回调补齐）
    if (model === 'geminiOmni') return { success: true, videoUrl: '', requestId: outcome.taskId }
    if (outcome.webhook) return { success: true, requestId: outcome.taskId }
    return await fallbackPollAndSettle(outcome.taskType, outcome.taskId, meta.userId)
  }

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
 * 无 webhook 时的兜底轮询（webhook 环境变量缺失才走）：经供应商适配层 pollTask
 * 归一化查询；成功后与 webhook 结算同语义——原子认领、按任务行 pointsAmount 扣点、
 * 标记成功。失败/超时不改任务行，交由补偿任务关闭（与历史行为一致）。
 */
async function fallbackPollAndSettle(
  taskType: string,
  taskId: string,
  userId?: string,
): Promise<{ success: boolean; videoUrl?: string; requestId?: string; error?: string }> {
  const result = await pollTaskUntilVerdict(taskType, taskId, { maxAttempts: 180, intervalMs: 5000 })

  if (result.verdict === 'success') {
    const videoUrl = result.resultUrls[0] || ''
    if (!videoUrl) return { success: false, error: 'No video URL in result' }
    if (userId) {
      try {
        const claimed = await claimTaskPointsDeduction(taskId)
        if (claimed) {
          const rows = await db
            .select({ pointsAmount: aiGenerationTasks.pointsAmount })
            .from(aiGenerationTasks)
            .where(eq(aiGenerationTasks.taskId, taskId))
            .limit(1)
          const amount = rows[0]?.pointsAmount ?? 0
          if (amount > 0) {
            await deductPoints(userId, amount, undefined, PointsAction.GENERATE_STORY_VIDEO)
          }
        }
        await markTaskSuccess(taskId)
        console.log('[generate-story-video] 兜底轮询成功，已按任务行结算积分:', { taskId })
      } catch (settleError) {
        console.error('[generate-story-video] 兜底轮询结算失败:', settleError)
      }
    }
    return { success: true, videoUrl, requestId: taskId }
  }

  if (result.verdict === 'fail') return { success: false, error: 'Video generation failed' }
  return { success: false, error: 'Video generation timeout' }
}

export async function POST(request: NextRequest) {
  try {
    // 验证用户登录
    const session = await getAuthedSession()
    if (!session) {
      return jsonError(401, 'Unauthorized')
    }

    // 高成本步骤门控（2026-08-30 定价重构 §4.2）：仅付费计划或已验卡用户可生成视频。
    // free 用户在 freeFilm 额度（验卡赠送 48 点）内仍可消费——点数是预算，这里是能力闸。
    const planUserRows = await db
      .select({
        subscriptionPlan: usersTable.subscriptionPlan,
        cardVerifiedAt: usersTable.cardVerifiedAt,
      })
      .from(usersTable)
      .where(eq(usersTable.id, session.user.id))
      .limit(1)
    const planUser = planUserRows[0]
    if (!isPaidPlan(planUser?.subscriptionPlan) && !planUser?.cardVerifiedAt) {
      return jsonError(403, 'Video generation requires a paid plan or verified payment method', {
        errorKey: 'upgrade_required',
      })
    }

    // 读取原始请求体
    const rawText = await request.text()
    console.log('[generate-story-video] rawBody:', rawText.substring(0, 200))

    let body: {
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

    const projectId: string | undefined = body.projectId || undefined

    // 单个请求模式
    const { imageUrl, prompt, aspectRatio, duration, videoModel, videoStyle, webhookUrl, versionId, versionGroupId, additionalImageUrls, generationType, videoUrls, audioUrls } = body
    const sceneIndex = body.sceneIndex
    const sceneId = body.sceneId != null ? String(body.sceneId) : undefined

    const effectiveModel = isKnownVideoModel(videoModel) ? videoModel : null
    const routeTo = effectiveModel || getStyleFallbackModel(videoStyle) || 'veo31Fast'
    const modelName = videoModelLabel(routeTo)

    // 余额预检：取降级链各候选「各自计费秒数口径」（resolveBillableSeconds，与落行同源）
    // 下的最大消耗为上界——链上任何模型实际落行扣点都不会超过该预检。
    // 分辨率偏好仅对声明支持该档的候选生效，其余候选按原生默认档计价。
    const requestedResolution = (body as { resolution?: string }).resolution as VideoResolution | undefined
    const durationSeconds = getDurationSeconds(duration)
    const chain = getVideoFallbackChain(routeTo, {
      hasImage: !!(imageUrl && imageUrl.trim()),
      durationSec: durationSeconds,
    })
    const requiredPoints = Math.max(...chain.map(m => {
      const supported = videoModelSupportedResolutions(m)
      const res = requestedResolution && supported.includes(requestedResolution)
        ? requestedResolution as VideoResolution
        : undefined
      return computeVideoPointsFor(m, resolveBillableSeconds(m, duration), res)
    }))

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

    // 提交 seam 的输入包（供应商知识收敛在 lib/providers，路由只传业务字段）
    const submitInput: SubmitInput = {
      imageUrl: imageUrl ?? '',
      prompt: prompt ?? '',
      aspectRatio,
      duration,
      resolution: requestedResolution,
      videoStyle,
      additionalImageUrls,
      generationType,
      referenceVideoUrls: videoUrls,
      referenceAudioUrls: audioUrls,
    }
    const submitMeta: SubmitMeta = {
      userId: session.user.id,
      projectId,
      versionId,
      versionGroupId,
      sceneIndex: sceneIndex != null ? Number(sceneIndex) : undefined,
      sceneId,
      webhookUrl,
    }

    const result = await generateSingleVideo(routeTo, chain, submitInput, submitMeta)

    trackFunnelEvent({ stage: 'video', userId: session.user.id, projectId: projectId ?? null, success: result.success, provider: 'kieai', model: result.model ?? routeTo, fallbackApplied: (result.model ?? routeTo) !== routeTo, taskId: result.requestId, error: result.error })

    if (!result.success) {
      console.error(`[generate-story-video] [${modelName}] 生成失败:`, { error: result.error })
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    // 积分扣除：任务行已由 submitTask 落库（pointsAmount 与预检同源计费）；
    // webhook 模式由回调结算，兜底轮询模式已在 fallbackPollAndSettle 结算，此处不扣。

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

