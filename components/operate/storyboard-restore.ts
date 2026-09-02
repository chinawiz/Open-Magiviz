/**
 * 分镜数据恢复解析（纯函数，供 operate.tsx 的项目恢复流程使用）。
 *
 * 线上实际存在三种存储形状，必须全部识别（2026-09-02 事故：形状③曾被整体丢弃，
 * 恢复后误判「分镜未完成」，叠加起点判据错误导致重复生成扣积分）：
 * ① 帧对格式：id 形如 `1_first`/`1_last` 或带 frameType，sceneId 为 "scene_N" 字符串
 *    或可提取出 N 的形态——按场景分组合成首尾帧；
 * ② 旧格式：带 firstFrameUrl 字段的直通条目；
 * ③ 单图格式：按场景下标 dump 的 `{id, sceneId(数字), url, imageUrl, plot}`。
 *
 * 原则：无任何图片信息的条目一律跳过（恢复后不能被计为「已完成」）；
 * 只有尾帧的组回落尾帧为主图（避免「有数据但被判未完成」）。
 */

interface RawStoryboard {
  id?: string | number
  sceneId?: string | number
  imageUrl?: string
  url?: string
  plot?: string
  description?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  firstFramePrompt?: string
  first_framePrompt?: string
  last_framePrompt?: string
  lastFramePrompt?: string
  frameType?: string
  baseSceneIndex?: string | number
}

export interface RestoredStoryboardItem {
  id: string | number
  sceneId?: string | number
  imageUrl: string
  url: string
  plot: string
  firstFrameUrl: string
  lastFrameUrl: string
  firstFramePrompt: string
  lastFramePrompt: string
}

function isFramePair(sb: RawStoryboard): boolean {
  const id = String(sb.id ?? '')
  return id.endsWith('_first') || id.endsWith('_last') || sb.frameType === 'first' || sb.frameType === 'last'
}

/** 从 sceneId/baseSceneIndex 提取场景序号：兼容 "scene_N" 字符串与裸数字/数字字符串 */
function extractSceneIndex(sb: RawStoryboard): string | undefined {
  if (sb.baseSceneIndex !== undefined && sb.baseSceneIndex !== null && sb.baseSceneIndex !== '') {
    return String(sb.baseSceneIndex)
  }
  const raw = sb.sceneId
  if (raw === undefined || raw === null || raw === '') return undefined
  const asString = String(raw)
  const sceneMatch = asString.match(/scene_(\d+)/)
  if (sceneMatch) return sceneMatch[1]
  if (/^\d+$/.test(asString)) return asString
  return undefined
}

function directItem(sb: RawStoryboard, idx: number): RestoredStoryboardItem {
  const firstFrameUrl = sb.firstFrameUrl || ''
  const imageUrl = firstFrameUrl || sb.imageUrl || sb.url || ''
  return {
    id: sb.id ?? `sb_${idx}`,
    sceneId: sb.sceneId,
    imageUrl,
    url: imageUrl,
    plot: sb.plot || sb.description || '',
    firstFrameUrl,
    lastFrameUrl: sb.lastFrameUrl || '',
    firstFramePrompt: sb.firstFramePrompt || sb.first_framePrompt || '',
    lastFramePrompt: sb.lastFramePrompt || sb.last_framePrompt || '',
  }
}

export function parseStoryboardRestoreData(rawData: unknown): RestoredStoryboardItem[] {
  if (!Array.isArray(rawData)) return []
  const rows = rawData as RawStoryboard[]

  const framePairRows = rows.filter(isFramePair)
  if (framePairRows.length > 0) {
    // 形状①：按场景分组合成首尾帧
    const storyboardMap = new Map<string, RestoredStoryboardItem>()
    for (const sb of framePairRows) {
      const sceneIndex = extractSceneIndex(sb)
      if (sceneIndex === undefined) continue
      const key = `scene_${sceneIndex}`
      if (!storyboardMap.has(key)) {
        storyboardMap.set(key, {
          id: `storyboard_${sceneIndex}`,
          sceneId: key,
          imageUrl: '',
          url: '',
          plot: sb.plot || sb.description || '',
          firstFrameUrl: '',
          lastFrameUrl: '',
          firstFramePrompt: '',
          lastFramePrompt: '',
        })
      }
      const entry = storyboardMap.get(key)!
      const imageUrl = sb.imageUrl || sb.url || ''
      if (String(sb.id ?? '').endsWith('_first') || sb.frameType === 'first') {
        entry.firstFrameUrl = imageUrl
        if (sb.firstFramePrompt || sb.first_framePrompt) {
          entry.firstFramePrompt = String(sb.firstFramePrompt || sb.first_framePrompt || '')
        }
      } else {
        entry.lastFrameUrl = imageUrl
        if (sb.lastFramePrompt || sb.last_framePrompt) {
          entry.lastFramePrompt = String(sb.lastFramePrompt || sb.last_framePrompt || '')
        }
      }
      // 主图优先首帧，只有尾帧的组回落尾帧（不能出现「有数据但主图为空」）
      entry.imageUrl = entry.firstFrameUrl || entry.lastFrameUrl || ''
      entry.url = entry.imageUrl
    }
    return Array.from(storyboardMap.values())
  }

  // 形状②③：直通条目（旧格式带 firstFrameUrl；单图格式带 imageUrl/url）
  return rows
    .map((sb, idx) => ({ sb, idx }))
    .filter(({ sb }) => Boolean(sb.firstFrameUrl !== undefined || sb.imageUrl || sb.url))
    .map(({ sb, idx }) => directItem(sb, idx))
}
