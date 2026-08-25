import { describe, it, expect } from 'vitest'
import { getStaticDefaultRoutes, isKnownTaskType, getVideoFallbackChain, VIDEO_MODEL_FALLBACKS } from './defaults'

describe('getStaticDefaultRoutes（DB 不可用时的兜底路由）', () => {
  it('四个 capability 均有默认 primary', () => {
    const routes = getStaticDefaultRoutes()
    expect(routes.script[0].provider).toBe('zenmux')
    expect(routes.script[0].modelKey).toBe('google/gemini-3-flash-preview')
    expect(routes.image[0].provider).toBe('kieai')
    expect(routes.image[0].modelKey).toBe('nano-banana-2')
    expect(routes.video[0].provider).toBe('kieai')
    expect(routes.video[0].modelKey).toBeNull() // 模型级路由由调用方经 video-pricing 决定
    expect(routes.compose[0].provider).toBe('fal')
  })

  it('所有默认 priority 为 0（primary）', () => {
    for (const entries of Object.values(getStaticDefaultRoutes())) {
      for (const e of entries) expect(e.priority).toBe(0)
    }
  })
})

describe('isKnownTaskType（taskType → 供应商端点映射完整性）', () => {
  it('覆盖全部生成路由实际写入的 taskType', () => {
    const known = [
      'generate_character',
      'generate_storyboard',
      'generate_storyboard_frame',
      'generate_story_video_veo',
      'veo_3_1_lite_video',
      'veo_3_1_quality_video',
      'seedance_2_5_video',
      'seedance_2_0_video',
      'seedance_2_0_fast_video',
      'seedance_2_0_mini_video',
      'kling_3_0_video',
      'wan_2_7_video',
      'happyhorse_video',
      'gemini_omni_video',
      'minimax_h3_video',
      'generate_final_video',
    ]
    for (const t of known) expect(isKnownTaskType(t)).toBe(true)
  })

  it('未知 taskType 返回 false', () => {
    expect(isKnownTaskType('nonexistent_task')).toBe(false)
  })
})

describe('getVideoFallbackChain（视频模型级降级链）', () => {
  it('主模型在链首，候补按序跟随', () => {
    expect(getVideoFallbackChain('veo31Lite', { hasImage: true, durationSec: 4 })).toEqual(
      ['veo31Lite', 'veo31Fast', 'wan27', 'happyHorse'],
    )
  })

  it('无图（纯文生视频）时过滤所有图生视频模型，只剩 Veo 系', () => {
    const chain = getVideoFallbackChain('veo31Lite', { hasImage: false, durationSec: 8 })
    expect(chain[0]).toBe('veo31Lite')
    expect(chain.every(m => m.startsWith('veo31'))).toBe(true)
  })

  it('无图且主模型本身要求图时链为空安全处理（仅剩主模型，由提交函数报错）', () => {
    expect(getVideoFallbackChain('kling3', { hasImage: false, durationSec: 8 })).toEqual(['kling3'])
  })

  it('geminiOmni 受 4/6/8/10s 硬约束过滤', () => {
    const chain = getVideoFallbackChain('geminiOmni', { hasImage: true, durationSec: 5 })
    expect(chain).toEqual(['veo31Fast', 'wan27']) // 主模型 5s 不合约束被滤掉
    const okChain = getVideoFallbackChain('geminiOmni', { hasImage: true, durationSec: 6 })
    expect(okChain[0]).toBe('geminiOmni')
  })

  it('minimaxH3 受 4-15s 约束过滤', () => {
    expect(getVideoFallbackChain('minimaxH3', { hasImage: true, durationSec: 30 })[0]).not.toBe('minimaxH3')
    expect(getVideoFallbackChain('minimaxH3', { hasImage: true, durationSec: 15 })[0]).toBe('minimaxH3')
  })

  it('未知主模型返回仅含主模型，不抛错', () => {
    expect(getVideoFallbackChain('nonexistent')).toEqual(['nonexistent'])
  })

  it('链内无重复', () => {
    for (const primary of Object.keys(VIDEO_MODEL_FALLBACKS)) {
      const chain = getVideoFallbackChain(primary, { hasImage: true, durationSec: 8 })
      expect(new Set(chain).size).toBe(chain.length)
    }
  })
})
