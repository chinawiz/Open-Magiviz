import { describe, it, expect } from 'vitest'
import { pickSceneCharacterImages, buildUiScriptData } from './script-mapper'

const t = (key: string, values?: Record<string, string | number>) =>
  `${key}${values ? JSON.stringify(values) : ''}`

describe('pickSceneCharacterImages', () => {
  const chars = [
    { id: 'c1', name: 'A', imageUrl: 'u1', generationPrompt: 'p1', prompt: '', description: '' },
    { id: 2, name: 'B', imageUrl: 'u2', generationPrompt: '', prompt: 'p2', description: 'd2' },
  ] as any

  it('String 口径匹配跨类型 id(批次6 裁决)', () => {
    const r = pickSceneCharacterImages({ characterIds: ['c1', '2'] }, chars)
    expect(r.relevantCharacters).toHaveLength(2)
    expect(r.characterImages[0]).toEqual({ characterId: 'c1', imageUrl: 'u1', imagePrompt: 'p1' })
    expect(r.characterImages[1].imagePrompt).toBe('p2')
  })

  it('prompt 兜底链 generationPrompt→prompt→description→空串', () => {
    const r = pickSceneCharacterImages({ characterIds: ['x'] }, [{ id: 'x', imageUrl: '', generationPrompt: '', prompt: '', description: 'desc' } as any])
    expect(r.characterImages[0].imagePrompt).toBe('desc')
  })

  it('无 characterIds 或无命中时返回空数组', () => {
    expect(pickSceneCharacterImages({}, chars).characterImages).toEqual([])
    expect(pickSceneCharacterImages({ characterIds: ['zzz'] }, chars).relevantCharacters).toEqual([])
  })
})

describe('buildUiScriptData', () => {
  const data = {
    title: 'T',
    aspectRatio: '9:16',
    scenes: [{ id: 1, description: 'p1', seconds: 6, firstFramePrompt: 'ff' }],
    characters: [{ name: 'N', description: 'd' }],
  }

  it('映射 scenes/characters/title/总时长', () => {
    const ui = buildUiScriptData(data, '16:9', t)
    expect(ui.title).toBe('T')
    expect(ui.aspectRatio).toBe('9:16')
    expect(ui.totalDuration).toBe(6)
    expect(ui.scenes[0].duration).toBe(6)
    expect(ui.scenes[0].plot).toBe('p1')
    expect(ui.scenes[0].firstFramePrompt).toBe('ff')
    expect(ui.characters[0].id).toBeTypeOf('string')
    expect(ui.characters[0].generationPrompt).toContain('realistic portrait')
  })

  it('时长/秒数缺省回退 5', () => {
    const ui = buildUiScriptData({ scenes: [{ id: 1 }] }, '16:9', t)
    expect(ui.scenes[0].duration).toBe(5)
  })
})
