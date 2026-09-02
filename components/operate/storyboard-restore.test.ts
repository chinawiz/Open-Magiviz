import { describe, it, expect } from 'vitest'
import { parseStoryboardRestoreData } from './storyboard-restore'

/**
 * 分镜数据恢复解析的契约测试。
 * 项目里实际存在三种存储形状（2026-09-02 事故实证：形状③曾被整体丢弃，
 * 恢复后误判「分镜未完成」导致重复生成扣积分）：
 * ① 帧对格式（id 形如 1_first/1_last 或 frameType，sceneId 为 "scene_N" 字符串）
 * ② 旧格式（带 firstFrameUrl 字段）
 * ③ 单图格式（{id, sceneId(数字), url, imageUrl, plot}——按场景下标 dump 的数组）
 */

describe('parseStoryboardRestoreData', () => {
  it('形状①：帧对按 sceneId 分组，首帧作为主图', () => {
    const items = parseStoryboardRestoreData([
      { id: '1_first', sceneId: 'scene_1', imageUrl: 'https://img/1f.png', plot: '第一场' },
      { id: '1_last', sceneId: 'scene_1', imageUrl: 'https://img/1l.png' },
      { id: '2_first', sceneId: 'scene_2', imageUrl: 'https://img/2f.png' },
    ])
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      sceneId: 'scene_1',
      imageUrl: 'https://img/1f.png',
      firstFrameUrl: 'https://img/1f.png',
      lastFrameUrl: 'https://img/1l.png',
      plot: '第一场',
    })
    expect(items[1].imageUrl).toBe('https://img/2f.png')
  })

  it('形状①变体：frameType 字段 + baseSceneIndex；只有尾帧的组回落尾帧为主图', () => {
    const items = parseStoryboardRestoreData([
      { id: 'x', frameType: 'last', baseSceneIndex: 1, imageUrl: 'https://img/last-only.png' },
    ])
    expect(items).toHaveLength(1)
    expect(items[0].imageUrl).toBe('https://img/last-only.png')
    expect(items[0].lastFrameUrl).toBe('https://img/last-only.png')
  })

  it('形状②：带 firstFrameUrl 的旧格式直通映射', () => {
    const items = parseStoryboardRestoreData([
      { id: 'sb_0', sceneId: 'scene_1', firstFrameUrl: 'https://img/legacy.png', plot: '旧格式' },
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'sb_0',
      sceneId: 'scene_1',
      imageUrl: 'https://img/legacy.png',
      firstFrameUrl: 'https://img/legacy.png',
    })
  })

  it('形状③：单图格式（数字 id/sceneId、url+imageUrl、无 firstFrameUrl）不再被丢弃——事故回归用例', () => {
    const items = parseStoryboardRestoreData([
      {
        id: 1,
        url: 'https://img/s1.png',
        plot: '晨光咖啡豆',
        sceneId: 1,
        imageUrl: 'https://img/s1.png',
      },
      {
        id: 2,
        url: 'https://img/s2.png',
        plot: '手冲注入',
        sceneId: 2,
        imageUrl: 'https://img/s2.png',
      },
    ])
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: 1,
      sceneId: 1,
      imageUrl: 'https://img/s1.png',
      plot: '晨光咖啡豆',
    })
    expect(items[1].sceneId).toBe(2)
  })

  it('无任何图片信息的条目跳过（不能计为已完成）；非数组输入返回空', () => {
    const items = parseStoryboardRestoreData([
      { id: 9, sceneId: 9, plot: '只有文字没有图' },
      { id: 1, sceneId: 1, url: 'https://img/ok.png' },
    ])
    expect(items).toHaveLength(1)
    expect(items[0].url).toBe('https://img/ok.png')

    expect(parseStoryboardRestoreData(null)).toEqual([])
    expect(parseStoryboardRestoreData('junk')).toEqual([])
  })
})
