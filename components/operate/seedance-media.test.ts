import { describe, it, expect, vi, beforeEach } from 'vitest'
import { probeMediaUrl } from '@/lib/media-validation'
import { validateSeedanceMedia, type SeedanceMediaItem } from './seedance-media'

/**
 * validateSeedanceMedia 契约测试（operate 拆分 T2）。
 * 验证顺序契约：数量上限 → 总时长上限 → 逐文件元数据；正反两条路径都测。
 * probeMediaUrl 是探测边界，予以 mock；数量/时长/单文件校验规则用真实实现。
 */

vi.mock('@/lib/media-validation', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/media-validation')>()
  return { ...mod, probeMediaUrl: vi.fn() }
})

const mockProbe = probeMediaUrl as ReturnType<typeof vi.fn>

// t 桩：键+参数原样序列化，便于断言走的是哪个文案键
const t = (key: string, opts?: unknown) => `${key}|${JSON.stringify(opts ?? null)}`

const item = (type: SeedanceMediaItem['type'], filename = 'f.mp4'): SeedanceMediaItem => ({
  filename,
  localUrl: `blob:${filename}`,
  type,
})

// 800×600=48 万像素,落在 [409600,927408] 合规区间;时长作为参数
const meta = (duration: number) => ({ duration, width: 800, height: 600, fps: 30 })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('validateSeedanceMedia（Seedance 素材约束校验）', () => {
  it('全部合规 → ok:true', async () => {
    mockProbe.mockResolvedValue(meta(5))
    const result = await validateSeedanceMedia([item('video'), item('audio', 'a.mp3')], t)
    expect(result).toEqual({ ok: true })
  })

  it('视频数量超上限（>3）→ mediaValidationVideoCount', async () => {
    mockProbe.mockResolvedValue(meta(1))
    const result = await validateSeedanceMedia(
      [item('video', '1.mp4'), item('video', '2.mp4'), item('video', '3.mp4'), item('video', '4.mp4')],
      t,
    )
    expect(result.ok).toBe(false)
    expect((result as { message: string }).message).toContain('mediaValidationVideoCount')
  })

  it('视频总时长超上限（>15s）→ mediaValidationVideoTotalDuration', async () => {
    mockProbe.mockImplementation((_src, kind) =>
      Promise.resolve(meta(kind === 'video' ? 8 : 1)),
    )
    const result = await validateSeedanceMedia([item('video', '1.mp4'), item('video', '2.mp4')], t)
    expect(result.ok).toBe(false)
    expect((result as { message: string }).message).toContain('mediaValidationVideoTotalDuration')
  })

  it('音频总时长超上限 → mediaValidationAudioTotalDuration', async () => {
    mockProbe.mockResolvedValue(meta(9))
    const result = await validateSeedanceMedia(
      [item('audio', '1.mp3'), item('audio', '2.mp3')],
      t,
    )
    expect(result.ok).toBe(false)
    expect((result as { message: string }).message).toContain('mediaValidationAudioTotalDuration')
  })

  it('探测失败（无 source）→ mediaValidationProbeFailed', async () => {
    const result = await validateSeedanceMedia([{ filename: 'x.mp4', type: 'video' }], t)
    expect(result.ok).toBe(false)
    expect((result as { message: string }).message).toContain('mediaValidationProbeFailed')
  })

  it('单个文件时长过短（1s < 2s 下限,总时长仍合规）→ mediaValidationFileFailed（真实单文件校验,验证「数量→总时长→单文件」顺序契约）', async () => {
    mockProbe.mockResolvedValue(meta(1))
    const result = await validateSeedanceMedia([item('video', 'long.mp4')], t)
    expect(result.ok).toBe(false)
    const msg = (result as { message: string }).message
    expect(msg).toContain('mediaValidationFileFailed')
    expect(msg).toContain('duration must be in')
  })

  it('探测抛错 → 按 ProbeFailed 处理并带错误信息', async () => {
    mockProbe.mockRejectedValue(new Error('boom'))
    const result = await validateSeedanceMedia([item('video', 'bad.mp4')], t)
    expect(result.ok).toBe(false)
    expect((result as { message: string }).message).toContain('boom')
  })
})
