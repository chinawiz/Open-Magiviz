/* eslint-disable @typescript-eslint/no-explicit-any -- 映射逻辑逐字取自 operate.tsx 存量弱类型(批次6 T21a),随清理票收敛 */
import type { CharacterItem } from "@/lib/types"

type ScriptMapperT = (key: string, values?: Record<string, string | number>) => string

/**
 * 场景角色图组装(批次6 T21a 合一,原 pipeline/resume/regeneration 三处内联):
 * 按 scene.characterIds 筛选角色并映射为分镜生成入参。
 * 口径裁决(批次6):id 匹配统一 String 强转(resume 生产口径,对跨类型 id 更稳健);
 * prompt 兜底链 generationPrompt→prompt→description→空串。
 * 返回 relevantCharacters 供调用方诊断日志沿用。
 */
export function pickSceneCharacterImages(scene: any, characters: CharacterItem[]): {
  relevantCharacters: CharacterItem[]
  characterImages: Array<{ characterId: CharacterItem["id"]; imageUrl: string; imagePrompt: string }>
} {
  const sceneCharacterIds = (scene.characterIds && scene.characterIds.length > 0) ? scene.characterIds : []
  const relevantCharacters = sceneCharacterIds.length > 0
    ? characters.filter((char) => sceneCharacterIds.includes(String(char.id)))
    : []
  const characterImages = relevantCharacters.length > 0
    ? relevantCharacters.map((char: any) => ({
        characterId: char.id,
        imageUrl: char.imageUrl,
        imagePrompt: char.generationPrompt || char.prompt || char.description || ""
      }))
    : []
  return { relevantCharacters, characterImages }
}

type UiScriptData = {
  title: string
  aspectRatio: string
  totalDuration: number
  scenes: any[]
  characters: CharacterItem[]
  raw: any
}

/**
 * 剧情数据映射合一(批次6 T21a,原 pipeline/regeneration 两份内联,以 pipeline 完整版为准:
 * 含首尾帧提示词字段)。data 为 generate-story-details 返回的解析结果;
 * t/aspectRatio 由调用方注入,logPrefix 仅用于诊断日志。
 */
export function buildUiScriptData(
  data: any,
  aspectRatio: string,
  t: ScriptMapperT,
  logPrefix = "[mapToUiScriptData]",
): UiScriptData {
  console.log(`${logPrefix} 原始数据中的 scenes:`, data?.scenes?.map((s: any) => ({
    id: s.id,
    duration: s.duration,
    seconds: s.seconds
  })))

  const scenes = Array.isArray(data.scenes) ? data.scenes.map((s: any, idx: number) => {
    const sceneDuration = Number(s.duration ?? s.seconds ?? 5)
    return {
      id: s.id ?? idx + 1,
      title: s.title ?? t("scriptTitleDefault", { index: idx + 1 }),
      plot: s.description ?? s.plot ?? s.plotText ?? '',
      duration: sceneDuration,
      aspectRatio: s.aspectRatio ?? data.aspectRatio ?? aspectRatio,
      storyboardPrompt: s.storyboardPrompt ?? '',
      sceneVideoPrompt: s.sceneVideoPrompt ?? '',
      visualElements: Array.isArray(s.visualElements) ? s.visualElements : (s.visuals ? s.visuals : []),
      characterIds: Array.isArray(s.characterIds) ? s.characterIds : [],
      storyboardCharacterImages: Array.isArray(s.storyboardCharacterImages) ? s.storyboardCharacterImages : [],
      firstFramePrompt: s.firstFramePrompt ?? s.first_framePrompt ?? '',
      lastFramePrompt: s.lastFramePrompt ?? s.last_framePrompt ?? '',
    }
  }) : []

  console.log(`${logPrefix} 解析后的 scenes:`, scenes.map((s: any) => ({ id: s.id, duration: s.duration })))

  const characters = Array.isArray(data.characters) ? data.characters.map((c: any) => {
    const inferredPrompt = c.generationPrompt ?? c.prompt ?? c.generation_prompt ?? (c.description ? `realistic portrait, mid-shot, soft key light, ${c.description}` : `realistic portrait, mid-shot, soft key light, ${c.name ?? 'character'}`)
    return {
      id: c.id ?? String(c.name ?? `char_${Math.random().toString(36).slice(2,8)}`),
      name: c.name ?? c.id ?? t("characterTitle"),
      role: c.role ?? c.roleLabel ?? 'protagonist',
      description: c.description ?? c.desc ?? c.summary ?? '',
      // provide both generationPrompt and prompt alias so editor and generators can use either
      generationPrompt: inferredPrompt,
      prompt: inferredPrompt,
      imageUrl: c.imageUrl ?? c.image_url ?? '',
      thumbnailUrl: c.thumbnailUrl ?? c.thumbnail_url ?? '',
      personality: c.personality ?? '',
      appearance: c.appearance ?? ''
    }
  }) : []

  const title = data.title ?? data.summary ?? ''
  const aspect = data.aspectRatio ?? aspectRatio
  const totalDuration = scenes.reduce((sum: number, s: any) => sum + (Number(s.duration) || 0), 0)

  console.log(`${logPrefix} 计算的总时长:`, totalDuration, '秒')

  return {
    title,
    aspectRatio: aspect,
    totalDuration,
    scenes,
    characters,
    raw: data
  }
}
