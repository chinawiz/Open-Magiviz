import { describe, it, expect } from 'vitest'
import { formatBytes, computeFileSizeLimit } from './format'

describe('formatBytes', () => {
  it('负数显示为无限制', () => {
    expect(formatBytes(-1)).toBe('无限制')
  })

  it('B / KB / MB / GB 分级', () => {
    expect(formatBytes(512)).toBe('512B')
    expect(formatBytes(2048)).toBe('2.0KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0MB')
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.00GB')
  })
})

describe('computeFileSizeLimit', () => {
  it('未登录/无计划：10MB', () => {
    expect(computeFileSizeLimit(null)).toBe(10 * 1024 * 1024)
    expect(computeFileSizeLimit('')).toBe(10 * 1024 * 1024)
  })

  it('annual：500MB', () => {
    expect(computeFileSizeLimit('annual')).toBe(500 * 1024 * 1024)
  })

  it('pro：100MB', () => {
    expect(computeFileSizeLimit('pro')).toBe(100 * 1024 * 1024)
  })

  it('trial：50MB', () => {
    expect(computeFileSizeLimit('trial')).toBe(50 * 1024 * 1024)
  })

  it('未知计划回退 10MB', () => {
    expect(computeFileSizeLimit('free')).toBe(10 * 1024 * 1024)
    expect(computeFileSizeLimit('whatever')).toBe(10 * 1024 * 1024)
  })
})
