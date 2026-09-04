import { describe, it, expect, vi, beforeEach } from 'vitest'

// 回退统计：近 N 天 fallbackApplied 事件按 stage 聚合（次数 + 最近回退时间）。

const rows: Array<{ stage: string; count: number; lastAt: Date | null }> = []

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          groupBy: vi.fn(async () => rows),
        })),
      })),
    })),
  },
}))

import { getFallbackStats } from './fallback-stats'

beforeEach(() => {
  rows.length = 0
})

describe('getFallbackStats', () => {
  it('聚合计数并数字化（drizzle count 返回可能是 string）', async () => {
    rows.push({ stage: 'script', count: 3 as unknown as number, lastAt: new Date('2026-09-01') })
    rows.push({ stage: 'character', count: '5' as unknown as number, lastAt: null })

    const stats = await getFallbackStats(7)

    expect(stats).toHaveLength(2)
    expect(stats[0]).toMatchObject({ stage: 'script', count: 3 })
    expect(stats[1].count).toBe(5)
    expect(stats[1].lastAt).toBeNull()
  })
})
