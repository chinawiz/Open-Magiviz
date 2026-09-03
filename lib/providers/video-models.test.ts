import { describe, it, expect, vi } from 'vitest'
import { VIDEO_SUBMITTERS, videoModelSupportedResolutions } from './submit'
import { VIDEO_MODEL_UNIT_POINTS } from '@/lib/video-pricing'
import {
  VIDEO_MODEL_RESOLUTIONS,
  VIDEO_MODEL_I18N_KEYS,
  VIDEO_MODEL_OPTION_ORDER,
  MEDIA_COMPATIBLE_VIDEO_MODELS,
  FIRST_LAST_FRAME_UNSUPPORTED_MODELS,
  AUTO_MODEL_FALLBACK,
} from './video-models'

// db 是 submit.ts/video-pricing.ts 的系统边界，予以 mock（照 submit.test.ts 惯例）
vi.mock('@/lib/db', () => ({ db: { insert: vi.fn() } }))

/**
 * video-models 客户端镜像表一致性守卫（operate 拆分 T1）。
 * 客户端 UI 表是服务端权威（submit 注册表 / video-pricing 定价表）的镜像，
 * 本测试锁死两边只许一起改——任何一侧单独漂移立刻红。
 */

describe('video-models 客户端镜像表一致性', () => {
  it('三方同集：选项顺序表(去 auto) = i18n 映射 = 提交注册表 = 定价表', () => {
    const optionKeys = VIDEO_MODEL_OPTION_ORDER.filter(k => k !== 'auto').sort()
    expect(optionKeys).toEqual(Object.keys(VIDEO_MODEL_I18N_KEYS).sort())
    expect(optionKeys).toEqual(Object.keys(VIDEO_SUBMITTERS).sort())
    expect(optionKeys).toEqual(Object.keys(VIDEO_MODEL_UNIT_POINTS).sort())
  })

  it('选项顺序表无重复项且 auto 置首', () => {
    expect(VIDEO_MODEL_OPTION_ORDER[0]).toBe('auto')
    expect(new Set(VIDEO_MODEL_OPTION_ORDER).size).toBe(VIDEO_MODEL_OPTION_ORDER.length)
  })

  it('分辨率镜像表 = submit 注册表中 ≥2 档的模型，逐值相等', () => {
    const expected = Object.keys(VIDEO_SUBMITTERS)
      .filter(k => videoModelSupportedResolutions(k).length >= 2)
      .sort()
    expect(Object.keys(VIDEO_MODEL_RESOLUTIONS).sort()).toEqual(expected)

    for (const [model, tiers] of Object.entries(VIDEO_MODEL_RESOLUTIONS)) {
      expect(videoModelSupportedResolutions(model)).toEqual(tiers)
    }
  })

  it('素材兼容集与首尾帧排除集都是注册表子集，auto 回落模型真实存在', () => {
    for (const k of MEDIA_COMPATIBLE_VIDEO_MODELS) {
      expect(VIDEO_SUBMITTERS[k]).toBeTruthy()
    }
    for (const k of FIRST_LAST_FRAME_UNSUPPORTED_MODELS) {
      expect(VIDEO_SUBMITTERS[k]).toBeTruthy()
    }
    expect(VIDEO_SUBMITTERS[AUTO_MODEL_FALLBACK]).toBeTruthy()
  })
})
