import {
  AUTO_MODEL_FALLBACK,
  VIDEO_MODEL_RESOLUTIONS,
} from "@/lib/providers/video-models"
import { computeVideoPointsFor, getVideoUnitPointsFor, type VideoResolution } from "@/lib/video-pricing"

/**
 * 前端积分预估纯模块（自 operate.tsx 拆出，拆分 T11）。
 * 口径与 lib/video-pricing（路由预检/提交 seam）同源：模型×分辨率档单价取自同一
 * 注册表；auto 模型按默认路由 AUTO_MODEL_FALLBACK 估价。测试与 submit 预检对拍
 * 见 lib/points-estimate.test.ts。
 */

/**
 * 场景视频单条积分预估：场景时长缺省/非法按 8s 估
 * （与拆分前 operate.tsx 的 estimateSceneVideoPoints 行为一致）。
 */
export function estimateSceneVideoPoints(params: {
  videoModel: string
  videoResolution: string
  sceneDuration?: number
}): number {
  const model = params.videoModel !== 'auto' ? params.videoModel : AUTO_MODEL_FALLBACK
  const res = VIDEO_MODEL_RESOLUTIONS[model]?.includes(params.videoResolution)
    ? (params.videoResolution as VideoResolution)
    : undefined
  const duration = Number(params.sceneDuration)
  const seconds = Number.isFinite(duration) && duration > 0 ? duration : 8
  return computeVideoPointsFor(model, seconds, res)
}

/**
 * 一键生成积分预估（「起」价）：总时长 × 模型×分辨率单价；
 * 剧本/主角/分镜为小额固定项未计入；时长 auto 按 24s 估、非法值回退 24s
 * （与拆分前 operate.tsx 的 pointsCost 行为一致）。
 */
export function estimateWorkflowPoints(params: {
  videoModel: string
  videoResolution: string
  duration: string
}): number {
  const model = params.videoModel !== 'auto' ? params.videoModel : AUTO_MODEL_FALLBACK
  const res = VIDEO_MODEL_RESOLUTIONS[model]?.includes(params.videoResolution)
    ? (params.videoResolution as VideoResolution)
    : undefined
  const durSec = params.duration === 'auto' ? 24 : parseInt(String(params.duration), 10) || 24
  return Math.round(durSec * getVideoUnitPointsFor(model, res))
}
