import { describe, it, expect } from 'vitest'
import {
  AUTO_MODEL_FALLBACK,
  VIDEO_MODEL_I18N_KEYS,
  VIDEO_MODEL_RESOLUTIONS,
} from './providers/video-models'
import { computeVideoPointsFor, getVideoUnitPointsFor, type VideoResolution } from './video-pricing'
import { estimateSceneVideoPoints, estimateWorkflowPoints } from './points-estimate'

/**
 * 金钱路径对拍（methods §3b）：前端预估必须与 lib/video-pricing 提交 seam 逐值同源。
 * 重复的字面集合就是等待发生的口径漂移——本测试锁死「预估公式 = seam 公式」。
 */

const MODELS = Object.keys(VIDEO_MODEL_RESOLUTIONS)

describe('estimateSceneVideoPoints 与提交 seam 对拍', () => {
  it('注册表内模型×已声明分辨率:与 computeVideoPointsFor 逐值相等', () => {
    for (const model of MODELS) {
      for (const res of VIDEO_MODEL_RESOLUTIONS[model]) {
        expect(
          estimateSceneVideoPoints({ videoModel: model, videoResolution: res, sceneDuration: 12 })
        ).toBe(computeVideoPointsFor(model, 12, res as VideoResolution))
      }
    }
  })

  it('注册表内模型×未声明分辨率:回退 undefined 档(与 seam 缺省一致)', () => {
    for (const model of MODELS) {
      expect(
        estimateSceneVideoPoints({ videoModel: model, videoResolution: '9999p', sceneDuration: 8 })
      ).toBe(computeVideoPointsFor(model, 8, undefined))
    }
  })

  it('auto 模型按默认路由 AUTO_MODEL_FALLBACK 估价', () => {
    expect(
      estimateSceneVideoPoints({ videoModel: 'auto', videoResolution: '720p', sceneDuration: 8 })
    ).toBe(
      estimateSceneVideoPoints({ videoModel: AUTO_MODEL_FALLBACK, videoResolution: '720p', sceneDuration: 8 })
    )
  })

  it('场景时长缺省/0/NaN 回退 8s', () => {
    const base = { videoModel: 'veo31Fast', videoResolution: '720p' }
    expect(estimateSceneVideoPoints({ ...base })).toBe(estimateSceneVideoPoints({ ...base, sceneDuration: 8 }))
    expect(estimateSceneVideoPoints({ ...base, sceneDuration: 0 })).toBe(
      estimateSceneVideoPoints({ ...base, sceneDuration: 8 })
    )
    expect(estimateSceneVideoPoints({ ...base, sceneDuration: NaN })).toBe(
      estimateSceneVideoPoints({ ...base, sceneDuration: 8 })
    )
  })
})

describe('estimateWorkflowPoints 与提交 seam 对拍', () => {
  it('任意模型×分辨率:时长×单价与 seam 单价公式逐值相等', () => {
    for (const model of MODELS) {
      for (const res of VIDEO_MODEL_RESOLUTIONS[model]) {
        expect(
          estimateWorkflowPoints({ videoModel: model, videoResolution: res, duration: '24' })
        ).toBe(Math.round(24 * getVideoUnitPointsFor(model, res as VideoResolution)))
      }
    }
  })

  it('时长 auto 按 24s 估;非法时长回退 24s', () => {
    const base = { videoModel: 'veo31Fast', videoResolution: '720p' }
    expect(estimateWorkflowPoints({ ...base, duration: 'auto' })).toBe(
      estimateWorkflowPoints({ ...base, duration: '24' })
    )
    expect(estimateWorkflowPoints({ ...base, duration: 'garbage' })).toBe(
      estimateWorkflowPoints({ ...base, duration: '24' })
    )
  })
})

describe('预估与注册表的一致性守卫', () => {
  it('全模型集(含固定档模型)走缺省档估价都有价可查——auto 回落不落空', () => {
    // VIDEO_MODEL_RESOLUTIONS 只收 ≥2 档可选模型;固定档模型(veo31 系等)靠
    // 「resolution 未声明 → undefined 档」路径估价,必须与 seam 逐值一致。
    for (const model of Object.keys(VIDEO_MODEL_I18N_KEYS)) {
      expect(
        estimateSceneVideoPoints({ videoModel: model, videoResolution: '9999p', sceneDuration: 8 })
      ).toBe(computeVideoPointsFor(model, 8, undefined))
      expect(getVideoUnitPointsFor(model, undefined)).toBeGreaterThan(0)
    }
  })

  it('AUTO_MODEL_FALLBACK 必须有单价可查(auto 预估才有定义,与路由预检同源)', () => {
    expect(getVideoUnitPointsFor(AUTO_MODEL_FALLBACK, undefined)).toBeGreaterThan(0)
  })
})
