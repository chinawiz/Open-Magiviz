import { describe, it, expect, beforeEach, vi } from 'vitest'

// local-persist 顶层引入 lib/db（无合法 DATABASE_URL 即抛）——哑 env 放行模块加载（neon 格式合法串，不真连）
vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://user:pass@example.com/db?sslmode=require'
})

import {
  applyImageUrlToCharacters,
  applyImageUrlToStoryboards,
  persistLocalImageUrl,
} from './local-persist'

const charRow = { id: 'char_1', name: '主角', imageUrl: '' }
const sbRow = { id: '1', sceneId: '1', plot: 'p', imageUrl: '' }

describe('applyImageUrlToCharacters', () => {
  it('按 id 匹配写入 imageUrl', () => {
    const r = applyImageUrlToCharacters([charRow], 'char_1', 'https://r2/x.png')
    expect(r.ok).toBe(true)
    expect(r.next[0].imageUrl).toBe('https://r2/x.png')
  })
  it('未匹配返回 ok:false 且原数组不变', () => {
    const r = applyImageUrlToCharacters([charRow], 'char_404', 'u')
    expect(r.ok).toBe(false)
    expect(r.next[0].imageUrl).toBe('')
  })
})

describe('applyImageUrlToStoryboards', () => {
  it('优先按 id / sceneId 匹配', () => {
    const r = applyImageUrlToStoryboards([sbRow], '1', 'https://r2/sb.png')
    expect(r.ok).toBe(true)
    expect(r.next[0].imageUrl).toBe('https://r2/sb.png')
  })
  it('id 未命中时回落数字索引', () => {
    const r = applyImageUrlToStoryboards([sbRow], '0', 'u')
    expect(r.ok).toBe(true)
    expect(r.next[0].imageUrl).toBe('u')
  })
  it('未命中返回 ok:false', () => {
    expect(applyImageUrlToStoryboards([sbRow], '999', 'u').ok).toBe(false)
  })
})

describe('persistLocalImageUrl（db 链路）', () => {
  const row = {
    id: 'ver-1',
    version: 1,
    characterData: [charRow],
    storyboardData: [sbRow],
  }
  const update = vi.fn()
  beforeEach(() => {
    update.mockReset()
    vi.doMock('@/lib/db', () => ({
      db: {
        select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
        update: () => ({ set: (v: unknown) => ({ where: () => { update(v); return Promise.resolve() } }) }),
      },
    }))
  })

  it('character：写入条目并推进 currentStep', async () => {
    vi.resetModules()
    const mod = await import('./local-persist')
    const ok = await mod.persistLocalImageUrl({
      projectId: 'proj-1', versionId: 'ver-1', kind: 'character', itemId: 'char_1', imageUrl: 'u',
    })
    expect(ok).toBe(true)
    expect(update).toHaveBeenCalled()
  })

  it('缺 versionId 直接 false（不触库）', async () => {
    vi.resetModules()
    const mod = await import('./local-persist')
    const ok = await mod.persistLocalImageUrl({ projectId: 'p', kind: 'character', itemId: 'c', imageUrl: 'u' })
    expect(ok).toBe(false)
  })

  it('条目未匹配返回 false（不写库）', async () => {
    vi.resetModules()
    const mod = await import('./local-persist')
    const ok = await mod.persistLocalImageUrl({
      projectId: 'proj-1', versionId: 'ver-1', kind: 'storyboard', itemId: '999', imageUrl: 'u',
    })
    expect(ok).toBe(false)
  })
})
