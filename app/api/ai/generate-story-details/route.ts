import { NextRequest, NextResponse } from 'next/server'
import { getAuthedSession, jsonError } from '@/lib/api'
import { trackFunnelEvent } from '@/lib/observability/track'
import { getUserPoints, deductPoints, PointsAction } from '@/lib/points'
import { db } from '@/lib/db'
import { projectData } from '@/lib/schema'
import { eq, desc } from 'drizzle-orm'
import { ZENMUX_API_URL } from '@/lib/llm'
import type { StoryGenerationResult, SceneDataItem } from '@/lib/ai-types'

/**
 * POST /api/ai/generate-story-details
 * Body:
 * {
 *   prompt: string,            // 用户输入的创意描述或剧情摘要
 *   maxTokens?: number,        // 可选，生成长度（默认 65536，最大输出支持）
 *   temperature?: number       // 可选，采样温度
 *   projectId?: string         // 可选，项目 ID
 *   userImages?: string[]      // 可选：用户上传的图片 URL 列表（每张会被 Gemini 视觉识别为角色图或场景图）
 * }
 *
 * 使用 ZenMux 调用 google/gemini-3.5-flash 生成剧情详情（情节、场景、角色要点等）。
 * 请在环境变量中设置 ZENMUX_API_KEY=<your_key>
 *
 * Gemini 3.5 Flash 支持最大输出 65,536 tokens。
 * 每次成功生成扣除1积分，失败不扣积分
 */

type GenerateRequestBody = {
  prompt: string
  maxTokens?: number
  temperature?: number
  duration?: number | string
  aspectRatio?: string
  videoStyle?: string
  videoModel?: string
  projectId?: string
  versionGroupId?: string
  userImages?: string[]   // 用户上传的参考图 URL 列表
}

/**
 * 调用 Gemini 视觉模型识别每张用户上传的图片，归类为 character / scene / unknown
 * 返回结果包含该图在 userImages 数组中的 index 和 url
 */
async function analyzeUserImages(
  imageUrls: string[],
  apiKey: string,
  model: string
): Promise<Array<{ index: number; url: string; type: string; desc: string }>> {
  const zenMuxUrl = ZENMUX_API_URL
  const results: Array<{ index: number; url: string; type: string; desc: string }> = []

  // 并行调用 Gemini 视觉模型识别每张图片
  const tasks = imageUrls.map(async (url, index) => {
    try {
      const r = await fetch(zenMuxUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    'Analyze the image and classify it as "character" (a person/figure/portrait), "scene" (a location/environment/storyboard frame), or "unknown" (neither clearly fits). ' +
                    'Provide a "desc" field with a one-sentence (max 30 words) description of the key visual features (face/hair/outfit for characters, location/atmosphere for scenes). ' +
                    'Output STRICT JSON only with no extra text, in this exact format: {"type":"character|scene|unknown","desc":"..."}'
                },
                { type: 'image_url', image_url: { url } }
              ]
            }
          ],
          max_tokens: 256,
          temperature: 0.2
        })
      })
      const j = await r.json()
      const text: string =
        j?.choices?.[0]?.message?.content ??
        j?.choices?.[0]?.text ??
        ''
      const cleaned = String(text).trim().replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
      let parsed: { type?: string; desc?: string } = { type: 'unknown', desc: '' }
      try {
        parsed = JSON.parse(cleaned)
      } catch {
        // 退而求其次：从文本中提取 type 字段
        const m = cleaned.match(/type\s*[:=]\s*"?(character|scene|unknown)"?/i)
        if (m) parsed.type = m[1].toLowerCase()
        const m2 = cleaned.match(/desc\s*[:=]\s*"([^"]+)"/i)
        if (m2) parsed.desc = m2[1]
      }
      return {
        index,
        url,
        type: ['character', 'scene', 'unknown'].includes(String(parsed.type).toLowerCase())
          ? String(parsed.type).toLowerCase()
          : 'unknown',
        desc: String(parsed.desc || '').slice(0, 80)
      }
    } catch (e) {
      console.error('[analyzeUserImages] 识别失败:', url, e)
      return { index, url, type: 'unknown', desc: '' }
    }
  })

  const arr = await Promise.all(tasks)
  return arr.sort((a, b) => a.index - b.index)
}

export async function POST(request: NextRequest) {
  try {
    // 验证用户登录状态
    const session = await getAuthedSession()
    if (!session) {
      return jsonError(401, 'Unauthorized')
    }

    const body: GenerateRequestBody = await request.json()

    if (!body || typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
      return NextResponse.json({ error: 'Missing required parameter: prompt' }, { status: 400 })
    }

    // 检查积分是否足够（需要1积分）
    const userPoints = await getUserPoints(session.user.id)
    if (userPoints < 1) {
      return NextResponse.json(
        { 
          error: '积分不足',
          code: 'INSUFFICIENT_POINTS',
          currentPoints: userPoints,
          requiredPoints: 1
        },
        { status: 400 }
      )
    }

    trackFunnelEvent({ stage: 'idea', userId: session.user.id, projectId: body.projectId ?? null })

    const apiKey = process.env.ZENMUX_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'ZenMux API key not configured (ZENMUX_API_KEY)' }, { status: 500 })
    }

    // 保持重构前行为：本路由使用专属模型，不随 lib/llm.ts 的 DEFAULT_MODEL 变更
    const model = 'google/gemini-3.5-flash'
    const maxTokens = typeof body.maxTokens === 'number'
      ? body.maxTokens
      : 65536
    const temperature = typeof body.temperature === 'number' ? body.temperature : 0.7

    // 用户上传的图片（每张将被 Gemini 视觉模型识别为 character 或 scene）
    const userImages: string[] = Array.isArray(body.userImages)
      ? body.userImages.filter((u: unknown) => typeof u === 'string' && u.trim().length > 0)
      : []

    // 识别结果：[{ index, url, type: 'character' | 'scene' | 'unknown', desc }]
    let imageAnalysis: Array<{ index: number; url: string; type: string; desc: string }> = []

    if (userImages.length > 0) {
      try {
        imageAnalysis = await analyzeUserImages(userImages, apiKey, model)
        console.log('[generate-story-details] 用户图片识别结果:', imageAnalysis)
      } catch (e) {
        console.error('[generate-story-details] 用户图片识别失败（继续生成剧情）:', e)
        imageAnalysis = userImages.map((url, idx) => ({ index: idx, url, type: 'unknown', desc: '' }))
      }
    }

    // 构建时长规则（根据 videoModel 优先，其次 videoStyle）
    // videoModel 决定模型，videoStyle 只用于 prompt 增强
    // videoModel === 'seedance25'       → Seedance 2.5      (9积分/s，4-30s 可变，audio on，720p)
    // videoModel === 'seedance2Fast'   → Seedance 2.0 Fast (2积分/s，4-15s 可变，audio on，720p)
    // videoModel === 'seedance2Mini'   → Seedance 2.0 Mini (1.5积分/s，4-15s 可变，audio on，720p)
    // videoModel === 'seedance2'       → Seedance 2.0    (3积分/s，4-15s 可变，audio on，720p)
    // videoModel === 'kling3'           → Kling 3.0        (2积分/s，3-15s 可变)
    // videoModel === 'wan27'            → Wan 2.7          (2积分/s，2-15s 可变，audio on，720p)
    // videoModel === 'minimaxH3'        → MiniMax H3       (2.5积分/s，4-15s 可变，支持首尾帧，768p)
    // videoModel === 'veo31Fast' 或 'auto' → Veo 3.1        (2积分/s，固定 8s)
    // videoModel === 'veo31Lite'      → Veo 3.1 Lite    (1积分/s，固定 8s)
    // videoModel === 'veo31Quality'    → Veo 3.1 Quality  (3积分/s，固定 8s)
    // videoModel === 'geminiOmni'      → Gemini Omni      (1积分/s，固定 4/6/8/10s，不支持首尾帧)
    // videoModel === 'happyHorse'       → HappyHorse        (2积分/s，默认 720p，底层调用 HappyHorse 1.1 接口)
    // videoStyle 回退路由（仅在 videoModel='auto' 时生效）：
    //   anime -> seedance2Fast（2pts/s）, ads -> seedance2（3pts/s）, hollywood/其他 -> veo31Fast
    const effectiveModel = body.videoModel && body.videoModel !== 'auto' ? body.videoModel : null
    const isVeoStyle = effectiveModel?.startsWith('veo') || (!effectiveModel && (body.videoStyle === 'auto' || !body.videoStyle))
    const isSeedance25Style = effectiveModel === 'seedance25'
    const isSeedanceFastStyle = effectiveModel === 'seedance2Fast' || (!effectiveModel && body.videoStyle === 'anime')
    const isSeedance2Style = effectiveModel === 'seedance2' || (!effectiveModel && body.videoStyle === 'ads')
    const isSeedanceMiniStyle = effectiveModel === 'seedance2Mini'
    const isKlingStyle = effectiveModel === 'kling3' || (!effectiveModel && body.videoStyle && body.videoStyle !== 'auto' && body.videoStyle !== 'anime' && body.videoStyle !== 'ads')
    const isWanStyle = effectiveModel === 'wan27'
    const isHappyHorseStyle = effectiveModel === 'happyHorse'
    const isGeminiOmniStyle = effectiveModel === 'geminiOmni'
    const isMinimaxH3Style = effectiveModel === 'minimaxH3'

    const durationRuleSystem = isVeoStyle
      ? `IMPORTANT - Duration rules for Veo 3.1:
- Veo 3.1 ONLY supports 8s per scene. Each scene's duration MUST be exactly 8 seconds (integer 8).
- User duration options: 'auto' (15-30s), 15s, 30s, or 60s.
- If duration is 'auto', design 2-4 scenes, each 8 seconds long, with total duration between 16-32 seconds (try to keep it between 16-24 seconds if possible).
- If user specifies 15s total: design 2 scenes of 8s each (16s total). This is closest to 15s and should be preferred.
- If user specifies 30s total: design 4 scenes of 8s each (32s total).
- If user specifies 60s total: design 7 or 8 scenes of 8s each (56s or 64s total). Prefer 8 scenes (64s total) for richer content.
- ALWAYS use only 8s for each scene. The sum should be as close as possible to the target total, but individual scene durations must always remain 8s.`
      : isSeedance25Style
      ? `IMPORTANT - Duration rules for Seedance 2.5:
- Seedance 2.5 supports any integer duration from 4s to 30s per scene.
- Use shorter durations (4-8s) for quick transitions or establishing shots.
- Use medium durations (9-15s) for standard dialogue/action scenes.
- Use longer durations (16-30s) for major scenes, emotional beats, or complex action sequences.
- User duration options: 'auto' (15-30s), 15s, 30s, or 60s.
- If duration is 'auto', design 2-4 scenes with variable durations (e.g., 15s+10s+5s = 30s).
- If user specifies 15s total: design 1-2 scenes (e.g., 10s + 5s).
- If user specifies 30s total: design 2-3 scenes with variable durations (e.g., 15s+10s+5s = 30s).
- If user specifies 60s total: design 3-5 scenes with variable durations (e.g., 30s+15s+10s+5s = 60s).
- Design enough scenes so the total duration approaches the target. Use varied scene lengths naturally to match narrative pacing.`
      : isSeedanceFastStyle
      ? `IMPORTANT - Duration rules for Seedance 2.0 Fast:
- Seedance 2.0 Fast supports any integer duration from 4s to 15s per scene.
- Use shorter durations (4-5s) for quick transitions or establishing shots.
- Use medium durations (6-10s) for standard dialogue/action scenes.
- Use longer durations (11-15s) for major scenes, emotional beats, or complex action sequences.
- User duration options: 'auto' (15-30s), 15s, 30s, or 60s.
- If duration is 'auto', design 2-4 scenes with variable durations (e.g., 10s+8s+6s = 24s).
- If user specifies 15s total: design 1-2 scenes (e.g., 10s + 5s).
- If user specifies 30s total: design 2-4 scenes with variable durations (e.g., 10s+8s+8s+4s = 30s).
- If user specifies 60s total: design 5-8 scenes with variable durations (e.g., 15s+12s+10s+8s+8s+7s = 60s).
- Design enough scenes so the total duration approaches the target. Use varied scene lengths naturally to match narrative pacing.`
      : isSeedance2Style
      ? `IMPORTANT - Duration rules for Seedance 2.0:
- Seedance 2.0 supports any integer duration from 4s to 15s per scene.
- Use shorter durations (4-5s) for quick transitions or establishing shots.
- Use medium durations (6-10s) for standard dialogue/action scenes.
- Use longer durations (11-15s) for major scenes, emotional beats, or complex action sequences.
- User duration options: 'auto' (15-30s), 15s, 30s, or 60s.
- If duration is 'auto', design 2-4 scenes with variable durations (e.g., 10s+8s+6s = 24s).
- If user specifies 15s total: design 1-2 scenes (e.g., 10s + 5s).
- If user specifies 30s total: design 2-4 scenes with variable durations (e.g., 10s+8s+8s+4s = 30s).
- If user specifies 60s total: design 5-8 scenes with variable durations (e.g., 15s+12s+10s+8s+8s+7s = 60s).
- Design enough scenes so the total duration approaches the target. Use varied scene lengths naturally to match narrative pacing.`
      : isSeedanceMiniStyle
      ? `IMPORTANT - Duration rules for Seedance 2.0 Mini:
- Seedance 2.0 Mini supports any integer duration from 4s to 15s per scene.
- Use shorter durations (4-5s) for quick transitions or establishing shots.
- Use medium durations (6-10s) for standard dialogue/action scenes.
- Use longer durations (11-15s) for major scenes, emotional beats, or complex action sequences.
- User duration options: 'auto' (15-30s), 15s, 30s, or 60s.
- If duration is 'auto', design 2-4 scenes with variable durations (e.g., 10s+8s+6s = 24s).
- If user specifies 15s total: design 1-2 scenes (e.g., 10s + 5s).
- If user specifies 30s total: design 2-4 scenes with variable durations (e.g., 10s+8s+8s+4s = 30s).
- If user specifies 60s total: design 5-8 scenes with variable durations (e.g., 15s+12s+10s+8s+8s+7s = 60s).
- Design enough scenes so the total duration approaches the target. Use varied scene lengths naturally to match narrative pacing.`
      : isWanStyle
      ? `IMPORTANT - Duration rules for Wan 2.7:
- Wan 2.7 supports any integer duration from 2s to 15s per scene.
- Use shorter durations (2-5s) for quick transitions or establishing shots.
- Use medium durations (6-10s) for standard dialogue/action scenes.
- Use longer durations (11-15s) for major scenes, emotional beats, or complex action sequences.
- User duration options: 'auto' (15-30s), 15s, 30s, or 60s.
- If duration is 'auto', design 2-4 scenes with variable durations (e.g., 12s+8s+6s = 26s).
- If user specifies 15s total: design 1-2 scenes (e.g., 10s + 5s).
- If user specifies 30s total: design 2-4 scenes with variable durations (e.g., 12s+8s+6s+4s = 30s).
- If user specifies 60s total: design 5-8 scenes with variable durations (e.g., 15s+12s+10s+8s+8s+7s = 60s).
- Design enough scenes so the total duration approaches the target. Use varied scene lengths naturally to match narrative pacing.`
      : isHappyHorseStyle
      ? `IMPORTANT - Duration rules for HappyHorse:
- HappyHorse supports any integer duration from 3s to 15s per scene.
- Use shorter durations (3-5s) for quick transitions or establishing shots.
- Use medium durations (6-10s) for standard dialogue/action scenes.
- Use longer durations (11-15s) for major scenes, emotional beats, or complex action sequences.
- User duration options: 'auto' (15-30s), 15s, 30s, or 60s.
- If duration is 'auto', design 2-4 scenes with variable durations (e.g., 10s+8s+6s = 24s).
- If user specifies 15s total: design 1-2 scenes (e.g., 10s + 5s).
- If user specifies 30s total: design 2-4 scenes with variable durations (e.g., 10s+8s+8s+4s = 30s).
- If user specifies 60s total: design 5-8 scenes with variable durations (e.g., 15s+12s+10s+8s+8s+7s = 60s).
- Design enough scenes so the total duration approaches the target. Use varied scene lengths naturally to match narrative pacing.`
      : isGeminiOmniStyle
      ? `IMPORTANT - Duration rules for Gemini Omni:
- Gemini Omni ONLY supports fixed durations: 4s, 6s, 8s, or 10s per scene. NO other durations are allowed.
- User duration options: 'auto' (8-20s), 15s, 30s, or 60s.
- If duration is 'auto', design 1-3 scenes, each 4s/6s/8s/10s long, with total duration between 8-24 seconds (prefer 8s or 16s if possible).
- If user specifies 15s total: design 2 scenes of 8s each (16s total) - closest to 15s.
- If user specifies 30s total: design 4 scenes of 8s each (32s total).
- If user specifies 60s total: design 7-8 scenes of 8s each (56s or 64s total). Prefer 8 scenes (64s total).
- IMPORTANT: First-last-frame mode is NOT supported for Gemini Omni. Do NOT suggest or use firstFramePrompt/lastFramePrompt in sceneVideoPrompt.
- IMPORTANT: Round durations to nearest available option (4/6/8/10s). Each scene duration MUST be one of these four values.`
      : isMinimaxH3Style
      ? `IMPORTANT - Duration rules for MiniMax H3:
- MiniMax H3 supports any integer duration from 4s to 15s per scene.
- Use shorter durations (4-5s) for quick transitions or establishing shots.
- Use medium durations (6-10s) for standard dialogue/action scenes.
- Use longer durations (11-15s) for major scenes, emotional beats, or complex action sequences.
- User duration options: 'auto' (15-30s), 15s, 30s, or 60s.
- If duration is 'auto', design 2-4 scenes with variable durations (e.g., 10s+8s+6s = 24s).
- If user specifies 15s total: design 1-2 scenes (e.g., 10s + 5s).
- If user specifies 30s total: design 2-4 scenes with variable durations (e.g., 10s+8s+8s+4s = 30s).
- If user specifies 60s total: design 5-8 scenes with variable durations (e.g., 15s+12s+10s+8s+8s+7s = 60s).
- Design enough scenes so the total duration approaches the target. Use varied scene lengths naturally to match narrative pacing.
- IMPORTANT: First-last-frame mode IS supported for MiniMax H3. Use firstFramePrompt/lastFramePrompt to define the first and last frames.`
      : `IMPORTANT - Duration rules for Kling 3.0:
- Kling 3.0 supports any integer duration from 3s to 15s per scene.
- Use shorter durations (3-5s) for quick transitions or establishing shots.
- Use medium durations (6-10s) for standard dialogue/action scenes.
- Use longer durations (11-15s) for major scenes, emotional beats, or complex action sequences.
- User duration options: 'auto' (15-30s), 15s, 30s, or 60s.
- If duration is 'auto', design 2-4 scenes with variable durations (e.g., 15s+10s+5s = 30s).
- If user specifies 15s total: design 1-2 scenes (e.g., 10s + 5s).
- If user specifies 30s total: design 2-3 scenes with variable durations (e.g., 15s+10s+5s or 12s+10s+8s).
- If user specifies 60s total: design 4-6 scenes with variable durations (e.g., 15s+12s+10s+10s+8s).
- Design enough scenes so the total duration approaches the target. Use varied scene lengths naturally to match narrative pacing.`

    // 构建 chat completion 请求体（ZenMux 兼容 OpenAI Chat 接口）
    const payload = {
      model,
      messages: [
        {
          role: 'system',
          content: `You are an assistant that expands a short creative prompt into detailed, structured story information used to drive downstream generation (high-fidelity storyboard images, image-to-video scene generation, and character assets).

Important: always respond using the same language as the user's prompt. If the user writes in Chinese, produce the JSON fields and all textual contents in Chinese; if the user writes in English, produce them in English. Preserve names and technical terms as-is when appropriate.

Requirements:
- Output MUST be valid JSON only (no explanatory text). If the model cannot produce strict JSON, return an object with an "error" field explaining the issue.
- Top-level JSON keys: "scenes" (array), "characters" (array), "summary" (string).

CRITICAL - Story Coherence Requirements (VERY IMPORTANT):
1. SCENE SEQUENCE COHERENCE: Each scene must logically follow from the previous one. The story should have a clear narrative arc: setup -> development -> climax -> resolution. Avoid arbitrary scene transitions.
2. CONTINUITY: Elements that appear in one scene (objects, characters, lighting, camera position) should either:
   - Continue naturally into the next scene (e.g., camera pans to reveal new area)
   - Have a logical explanation for change (e.g., time passes, character moves)
   - Be explicitly transitioned (e.g., fade, cut, dissolve)
3. VISUAL FLOW: The storyboardPrompt and sceneVideoPrompt must create a VISUALLY CONTINUOUS experience:
   - storyboardPrompt describes the KEY FRAME that will be animated
   - sceneVideoPrompt describes the MOTION from/to that key frame
   - Adjacent scenes should have smooth transitions (e.g., "continuing from previous shot", "panning to reveal next area", "dissolve from previous scene")
4. CAMERA CONTINUITY: Consider the camera movement across scenes. If scene 1 ends with a push-in, scene 2 can start from a similar angle or continue the movement logically.
5. EMOTIONAL ARC: The mood should flow naturally - tension builds, emotions peak, then resolve. Don't jump randomly between vastly different moods.

Content safety rules (VERY IMPORTANT):
- The user prompt may contain violence, gore, explicit sexual content, self-harm, or other extreme content.
- You MUST rewrite, summarize, or imply such content in a toned-down, movie-rating-friendly way in all generated fields, especially in "storyboardPrompt" and "sceneVideoPrompt".
- Do NOT describe graphic gore (no detailed blood, organs, severed limbs, torture, etc.). Instead, use neutral phrases like "intense action", "off-screen impact", or "the aftermath is implied but not shown".
- Do NOT describe explicit nudity or sexual acts. Use phrases like "romantic atmosphere", "intimate but tasteful scene", or "fade to black before explicit content".
- Do NOT encourage or visually depict explicit self-harm or suicide. You may describe "extremely depressed emotion", "the character is in despair", etc., but avoid explicit methods or instructions.
- Always keep all prompts suitable for a general-audience cinematic visualization.

Important prompt semantics:
- "storyboardPrompt" should be a concise, image-generation prompt intended to produce a HIGH-FIDELITY storyboard frame (NOT a sketch). Include camera angle, focal length, composition, lighting, mood, color palette, and style (e.g., "cinematic, wide-angle, soft rim light, high contrast, photorealistic"). IMPORTANT: This prompt defines the STARTING or KEY frame that will be animated.
- "firstFramePrompt": CONCISE prompt for the FIRST/OPENING frame of this scene (one or two sentences, ~30-50 words). Describe: subject positioning, camera angle, lighting, mood, composition at the START of the scene. Example: "A lone astronaut stands on Mars surface, wide shot, golden hour lighting, dust particles floating, epic scale, determined expression"
- "lastFramePrompt": CONCISE prompt for the LAST/CLOSING frame of this scene (one or two sentences, ~30-50 words). Describe: subject's FINAL position, camera movement conclusion, lighting changes, mood at the END of the scene. Example: "Astronaut raises hand to the sky, looking at approaching spacecraft, dust settling, warm light illuminating face, triumphant pose"
- IMPORTANT: "firstFramePrompt" and "lastFramePrompt" are for the FIRST and LAST frames that will be used for first-last-frame video generation mode. They describe the VISUAL STATE at the beginning and end of each scene.
- "sceneVideoPrompt" should be an image-to-video style prompt that uses the generated storyboard frame as the visual source. Describe motion, camera moves, timing, transitions, and any required effects or animation style (e.g., "slow push-in over 3s, slight camera shake, parallax of background stars, subtle bloom, cinematic color grade"). The motion should CONTINUE NATURALLY if this scene follows a previous scene. If the scene has dialogue, INCLUDE the speaker and dialogue text directly in the prompt (e.g., "Xiao Ming says: '你好呀'" or "小明说：'你好呀'"). PRESERVE the original language of the dialogue.
- "narration" field for each scene: if the scene contains spoken dialogue or narration, include the full exact narration/dialogue text here. This will be used for AI voice generation and audio synthesis. CRITICAL: The narration text MUST be preserved in the ORIGINAL LANGUAGE as written by the user - DO NOT translate, modify, or paraphrase the narration. Copy it EXACTLY.
- "transition" field: describe how this scene transitions to the next scene (e.g., "cut", "fade", "dissolve", "match cut", "continuing pan"). This helps ensure smooth video flow.

Character inclusion in storyboards:
- If a scene includes one or more characters (visualElements or scene description mentions characters), the scene object MUST include:
  - "characterIds": an array of character IDs (matching items in the top-level "characters" array) that appear in this scene.
  - "storyboardCharacterImages": an array of objects for each referenced character with keys:
      - "characterId": the character id
      - "imageUrl": if the top-level "characters" array provides an "imageUrl" for that character, set it here; otherwise set to empty string.
      - "imagePrompt": a concise prompt to generate the character image embedded in the storyboard frame (one sentence) — useful when "imageUrl" is not available.
  - The "storyboardPrompt" should consider the presence of these character images (e.g., "include commander in midground, three-quarter view, soft rim light").

Also, when possible, populate each character in the top-level "characters" array with an "imageUrl" field (a publicly accessible URL) if such an image already exists; otherwise leave "imageUrl" as an empty string and provide a "generationPrompt" for creating it.

USER REFERENCE IMAGES:
- If a character in the top-level "characters" array was matched with one of the user's uploaded reference images, that character object MUST include a "userImageUrl" field set to the URL of the matching image (one of the URLs listed in USER-IMAGES below). Characters without a matched user image should have "userImageUrl" as an empty string.
- Likewise, if a scene in "scenes" was matched with a user reference image, that scene object MUST include "userImageUrl" set to the matching image URL. Unmatched scenes should have "userImageUrl" as an empty string.
- The downstream image generation will use the userImageUrl as a reference for image-to-image generation, so the prompts (character.generationPrompt, scene.storyboardPrompt) should describe a target that PRESERVES the visual identity/atmosphere of the user image.

scenes: an array where each item is an object with keys:
  - "id": integer index starting at 1
  - "title": short title for the scene
  - "description": detailed scene description (what happens, camera moves, mood). If the scene contains dialogue, include the dialogue and specify who speaks it. PRESERVE the original dialogue text and language exactly. Include how this scene connects to the previous/next scene.
  - "duration": suggested duration in seconds (integer, 3-15 for Kling, 4-15 for Seedance, or 8 for Veo)
  - "aspectRatio": recommended aspect ratio string (e.g., "16:9")
  - "firstFramePrompt": CONCISE prompt for the FIRST frame image (~30-50 words). Describe the visual state at the START of the scene: subject positioning, camera angle, lighting, mood, composition. Example: "A lone astronaut stands on Mars surface, wide shot, golden hour lighting, dust particles floating, epic scale"
  - "lastFramePrompt": CONCISE prompt for the LAST frame image (~30-50 words). Describe the visual state at the END of the scene: subject's final position, camera movement conclusion, lighting changes, mood. Example: "Astronaut raises hand to the sky, looking at approaching spacecraft, dust settling, warm light illuminating face"
  - "storyboardPrompt": concise prompt for generating a high-fidelity storyboard image for this scene (one or two sentences). This is the KEY FRAME that will be animated - consider what motion will be applied.
  - "sceneVideoPrompt": concise image-to-video prompt that instructs how to animate the storyboard into video (one or two sentences). Include the speaker and their dialogue in the prompt (e.g., "Xiao Ming says: 'Hello!'" or "小明说：'你好呀'"). PRESERVE the original language of the dialogue. Describe motion that CONTINUOUSLY flows from/to adjacent scenes when possible.
  - "visualElements": array of short strings naming important visual elements (e.g., "rocket", "earth")
  - "narration": the exact narration/ dialogue text for this scene if any (for AI voice generation and audio synthesis), otherwise empty string. CRITICAL: Copy the narration text EXACTLY as provided by the user, preserving the original language without any translation or modification.
  - "transition": how this scene transitions to the next scene (e.g., "cut", "fade to black", "dissolve", "match cut", "continuing pan", "whip pan"). Use "cut" as default if nothing special.
  - (if applicable) "characterIds" and "storyboardCharacterImages" as described above

characters: an array where each item is an object with keys:
  - "id": string identifier
  - "name": display name
  - "role": short role label (e.g., "protagonist", "commander")
  - "description": short textual description (appearance, personality)
  - "generationPrompt": concise prompt suitable for image-generation models to create the character's portrait/thumbnail (one or two sentences)
  - "imageUrl": a publicly accessible URL for the character image if available, otherwise an empty string
  - "userImageUrl": the URL of the user-uploaded reference image that should be used as a reference for image-to-image generation. Empty string if no user image is associated with this character.

Each scene object in "scenes" may also include a "userImageUrl" field:
  - "userImageUrl": the URL of the user-uploaded reference image that should be used as a reference for image-to-image generation. Empty string if no user image is associated with this scene.

Also include a "summary" string briefly describing the full story.

Formatting rules:
- Use arrays and objects; do not include Markdown, explanatory paragraphs, or any text outside the JSON.
- Keep prompts short (one or two sentences) but precise: prefer camera terms (wide, close-up, 35mm/50mm/85mm), mood words (somber, tense), lighting (backlit, soft key), and style tags (photorealistic, cinematic, painterly).
- sceneVideoPrompt should describe the motion and camera movement based on the storyboard image. Do NOT include prefixes like "image-to-video:" - the API will automatically detect the image-to-video mode.

Example output (strict JSON):
{
  "scenes": [
    {
      "id": 1,
      "title": "Opening Earth Shot",
      "description": "A slow pullback from Earth's surface to full planet view, tranquil and awe-inspiring, soft orchestral mood. Establishing shot that sets the scene.",
      "duration": 8,
      "aspectRatio": "16:9",
      "firstFramePrompt": "Earth surface close-up, astronaut stepping onto red Martian soil, golden hour lighting, dust particles floating, epic scale, determined expression",
      "lastFramePrompt": "Astronaut raises hand to the sky, gazing at approaching spacecraft, dust settling, warm light illuminating face, triumphant pose, wide landscape behind",
      "storyboardPrompt": "photorealistic Earth full view, wide-angle, soft rim light, cinematic color grade",
      "sceneVideoPrompt": "slow cinematic pullback over 5s, subtle parallax and zoom, gentle atmospheric haze, epic scale transition",
      "visualElements": ["Earth", "stars"],
      "narration": "",
      "transition": "dissolve"
    },
    {
      "id": 2,
      "title": "Commander Speaks",
      "description": "Camera continues its movement, revealing the spaceship window where Commander stands. Commander addresses the crew with the message: 'Attention all crew members, we have arrived at our destination. Prepare for landing.' The camera push-in continues naturally from the previous shot's movement.",
      "duration": 8,
      "aspectRatio": "16:9",
      "firstFramePrompt": "Commander in uniform standing at spaceship window, three-quarter view, dramatic lighting from window, serious expression, camera pushing in",
      "lastFramePrompt": "Commander turns away from window, walking toward spacecraft exit, confident stride, backlit silhouette, mission control ambiance",
      "storyboardPrompt": "Commander in uniform standing at spaceship window, three-quarter view, dramatic lighting from window, serious expression, camera pushing in",
      "sceneVideoPrompt": "continue slow push-in on commander over 6s, maintaining smooth camera motion from previous shot, Commander says: 'Attention all crew members, we have arrived at our destination. Prepare for landing.'",
      "visualElements": ["Commander", "spaceship cockpit", "window view of planet"],
      "narration": "Attention all crew members, we have arrived at our destination. Prepare for landing.",
      "characterIds": ["char_commander"],
      "storyboardCharacterImages": [
        {
          "characterId": "char_commander",
          "imageUrl": "",
          "imagePrompt": "Commander in uniform, serious expression"
        }
      ],
      "transition": "cut"
    },
    {
      "id": 3,
      "title": "中文对话场景",
      "description": "The scene transitions to an interior shot. 主角走进房间，看到朋友后露出惊喜的表情。朋友说：'好久不见，你最近怎么样？'",
      "duration": 8,
      "aspectRatio": "16:9",
      "firstFramePrompt": "Door opening, protagonist entering cozy room, surprised expression, warm interior lighting, soft shadows",
      "lastFramePrompt": "Two friends hugging warmly, joyful expressions, soft golden light, emotional reunion moment, warm atmosphere",
      "storyboardPrompt": "Two friends meeting in a cozy room, warm lighting, surprised and happy expressions, natural composition, fade in from black",
      "sceneVideoPrompt": "gentle push-in over 5s capturing the warm reunion moment, smooth fade-in transition, Friend says: '好久不见，你最近怎么样？'",
      "visualElements": ["friends", "room", "cozy atmosphere"],
      "narration": "好久不见，你最近怎么样？",
      "characterIds": ["char_friend1", "char_friend2"],
      "storyboardCharacterImages": [
        {
          "characterId": "char_friend1",
          "imageUrl": "",
          "imagePrompt": "Person greeting friend, warm smile"
        },
        {
          "characterId": "char_friend2",
          "imageUrl": "",
          "imagePrompt": "Person being greeted, surprised expression"
        }
      ],
      "transition": "dissolve"
    }
  ],
  "characters": [
    {
      "id": "char_commander",
      "name": "Commander",
      "role": "protagonist",
      "description": "Middle-aged commander in uniform, serious and composed, authoritative presence.",
      "generationPrompt": "realistic portrait, mid-shot, uniform, stern expression, soft key light, 50mm, authoritative",
      "imageUrl": ""
    },
    {
      "id": "char_friend1",
      "name": "Friend 1",
      "role": "protagonist",
      "description": "Person greeting their friend with a warm smile, friendly demeanor.",
      "generationPrompt": "realistic portrait, mid-shot, warm smile, friendly expression, soft key light",
      "imageUrl": ""
    },
    {
      "id": "char_friend2",
      "name": "Friend 2",
      "role": "protagonist",
      "description": "Person being greeted, surprised but happy expression, welcoming demeanor.",
      "generationPrompt": "realistic portrait, mid-shot, surprised happy expression, welcoming demeanor, soft key light",
      "imageUrl": ""
    }
  ],
  "summary": "A crew arrives at a new planet under the commander's leadership, preparing for landing. Later, two friends meet and greet each other warmly."
}

Now generate the JSON described above based on the user's prompt (the content of the user message).`
        },
        { role: 'user', content: body.prompt },
        { role: 'system', content: `Target total duration: ${typeof body.duration !== 'undefined' ? body.duration : 'auto'}. Target aspect ratio: ${body.aspectRatio ?? 'unspecified'}. Target video model: ${body.videoModel ?? 'unspecified'}. Target video style: ${body.videoStyle ?? 'unspecified'}.

${durationRuleSystem}

${imageAnalysis.length > 0
  ? `USER-IMAGES (REFERENCE IMAGES UPLOADED BY THE USER):
The user uploaded ${imageAnalysis.length} reference image(s). Each image is identified as either "character" (a person/figure) or "scene" (a place/environment/storyboard frame). You MUST honor these references in your output and assign each image to a corresponding character or scene. Add a field "userImageUrl" (the URL of the image) in the matching character or scene object so the downstream image generation can perform image-to-image generation based on the user's reference.

Image inventory (preserve this order; the index starts at 0):
${imageAnalysis.map((it, i) => `- IMAGE_INDEX_${i} | type=${it.type} | desc=${it.desc || '(no description)'} | url=${it.url}`).join('\n')}

Assignment rules (IMPORTANT):
- For each IMAGE_INDEX with type="character", assign it to a character in the top-level "characters" array by setting "userImageUrl" to that image URL. If there are more character images than you can naturally fit, attach them to the most relevant characters (one image per character is ideal; multiple images may describe the same character — pick the best fit). When a character has a userImageUrl, its "generationPrompt" should describe visual traits to MAINTAIN from the reference (face, hairstyle, outfit, art style).
- For each IMAGE_INDEX with type="scene", assign it to a scene in the "scenes" array by setting "userImageUrl" to that image URL. The "storyboardPrompt" for that scene should describe a storyboard frame that preserves the visual style, composition, and atmosphere of the user's reference.
- Images with type="unknown" can be assigned to either a character or a scene depending on what the description fits best; if neither fits, you may omit them.
- Each user image should be assigned to AT MOST ONE character or scene. Do not duplicate the same userImageUrl across multiple characters/scenes.

Output format: include "userImageUrl" field at the top level of each character or scene object that should be regenerated using the user image as a reference.`
  : ''}` }
      ],
      max_tokens: maxTokens,
      temperature
    }

    // Use ZenMux API - OpenAI-compatible endpoint
    const zenMuxUrl = ZENMUX_API_URL

    // 直接使用 ZenMux HTTP 接口
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    }

    const doRequest = async (tokens: number) => {
      const bodyPayload = { ...payload, max_tokens: tokens }
      const r = await fetch(zenMuxUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload)
      })
      const j = await r.json()
      return { res: r, json: j }
    }

    // 第一次请求使用传入的 maxTokens
    const scriptStartedAt = Date.now()
    let { res, json: respJson } = await doRequest(maxTokens)

    if (!res.ok) {
      console.error('ZenMux error:', respJson)
      trackFunnelEvent({ stage: 'script', userId: session.user.id, projectId: body.projectId ?? null, success: false, durationMs: Date.now() - scriptStartedAt, provider: 'zenmux', model, error: JSON.stringify(respJson).slice(0, 200) })
      return NextResponse.json({ error: 'ZenMux request failed', details: respJson }, { status: 502 })
    }

    // 不再进行基于 max_tokens 的重试，使用首次返回结果

    // 尝试从响应中提取文本（兼容不同返回结构），并解析为 JSON 数据
    let generatedText: string | null = null
    if (respJson.choices && Array.isArray(respJson.choices) && respJson.choices[0]) {
      const choice = respJson.choices[0]
      if (choice.message && typeof choice.message.content === 'string') {
        generatedText = choice.message.content
      } else if (choice.message && Array.isArray(choice.message.content)) {
        generatedText = choice.message.content.join('\n')
      } else if (typeof choice.text === 'string') {
        generatedText = choice.text
      }
    } else if (typeof respJson.output === 'string') {
      generatedText = respJson.output
    }

    let parsedData: StoryGenerationResult = null as unknown as StoryGenerationResult
    if (generatedText) {
      // 尝试解析为严格 JSON（去掉 ``` 包裹）
      const cleaned = generatedText.trim().replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
      try {
        parsedData = JSON.parse(cleaned)
      } catch (e) {
        // 解析失败，回退为原始文本（后续会再次尝试解析）
        parsedData = cleaned as unknown as StoryGenerationResult
      }
    } else {
      // 如果没有文本输出，直接使用 respJson（可能已经为对象）
      parsedData = respJson as unknown as StoryGenerationResult
    }

    // 如果 parsedData 是字符串（未成功解析为对象），尝试从 raw 中挑选对象
    if (typeof parsedData === 'string') {
      try {
        parsedData = JSON.parse(parsedData)
      } catch (e) {
        // leave as string
      }
    }

    // 不保留 personality 字段，由前端决定是否展示或推断

    // 时长约束处理：
    // - Veo 风格：强制 8s（固定时长）
    // - Seedance 风格：裁剪到 4-15s
    // - Gemini Omni 风格：只能是 4/6/8/10s
    // - Kling/Wan/HappyHorse 风格：裁剪到 3-15s
    const applyDurationConstraint = (scenes: SceneDataItem[]): SceneDataItem[] => {
      if (!Array.isArray(scenes) || scenes.length === 0) return scenes

      if (isVeoStyle) {
        // Veo 风格：强制 8s
        return scenes.map((s: SceneDataItem) => ({
          ...s,
          duration: 8
        }))
      } else if (isGeminiOmniStyle) {
        // Gemini Omni 风格：只能选择 4/6/8/10s
        const nearestGeminiOmniDuration = (seconds: number) => {
          const options = [4, 6, 8, 10]
          if (isNaN(seconds)) return 8
          const nearest = options.reduce((prev, curr) =>
            Math.abs(curr - seconds) < Math.abs(prev - seconds) ? curr : prev
          )
          return nearest
        }
        return scenes.map((s: SceneDataItem) => {
          const rawDuration = Number(s.duration) || 8
          return {
            ...s,
            duration: nearestGeminiOmniDuration(rawDuration)
          }
        })
      } else if (isSeedanceFastStyle || isSeedance2Style) {
        // Seedance 风格：4-15s（通用）
        const nearestSeedanceDuration = (seconds: number) => {
          if (isNaN(seconds) || seconds < 4) return 4
          if (seconds > 15) return 15
          return seconds
        }
        return scenes.map((s: SceneDataItem) => {
          const rawDuration = Number(s.duration) || 8
          return {
            ...s,
            duration: nearestSeedanceDuration(rawDuration)
          }
        })
      } else if (isMinimaxH3Style) {
        // MiniMax H3 风格：4-15s
        const nearestMinimaxDuration = (seconds: number) => {
          if (isNaN(seconds) || seconds < 4) return 4
          if (seconds > 15) return 15
          return seconds
        }
        return scenes.map((s: SceneDataItem) => {
          const rawDuration = Number(s.duration) || 6
          return {
            ...s,
            duration: nearestMinimaxDuration(rawDuration)
          }
        })
      } else if (isKlingStyle || isWanStyle || isHappyHorseStyle) {
        // Kling/Wan/HappyHorse 风格：3-15s
        const nearestKlingDuration = (seconds: number) => {
          if (isNaN(seconds) || seconds < 3) return 3
          if (seconds > 15) return 15
          return seconds
        }
        return scenes.map((s: SceneDataItem) => {
          const rawDuration = Number(s.duration) || 5
          return {
            ...s,
            duration: nearestKlingDuration(rawDuration)
          }
        })
      } else {
        // 默认 Kling 风格：3-15s
        const nearestKlingDuration = (seconds: number) => {
          if (isNaN(seconds) || seconds < 3) return 3
          if (seconds > 15) return 15
          return seconds
        }
        return scenes.map((s: SceneDataItem) => {
          const rawDuration = Number(s.duration) || 5
          return {
            ...s,
            duration: nearestKlingDuration(rawDuration)
          }
        })
      }
    }

    if (parsedData && typeof parsedData === 'object' && Array.isArray(parsedData.scenes)) {
      parsedData.scenes = applyDurationConstraint(parsedData.scenes)
    }

    // 如果用户传入了 aspectRatio，设置到返回数据中
    if (body.aspectRatio && parsedData && typeof parsedData === 'object') {
      parsedData.aspectRatio = body.aspectRatio
    }

    // 如果用户传入了 videoStyle，设置到返回数据中
    if (body.videoStyle && parsedData && typeof parsedData === 'object') {
      parsedData.videoStyle = body.videoStyle
    }

    // 打印调试信息：原始响应与解析后数据
    console.debug('generate-story rawResp:', respJson)
    console.debug('generate-story parsedData type:', typeof parsedData, 'parsedData:', parsedData)

    // 验证生成的数据是否有效
    const isValidData = parsedData && typeof parsedData === 'object' && Array.isArray(parsedData.scenes) && parsedData.scenes.length > 0

    // 版本号（仅在有效数据保存后有值），实际是 record.id（nanoid）
    let savedVersion: string | null = null

    // 只有成功生成有效数据时才扣除积分
    if (isValidData) {
      try {
        await deductPoints(
          session.user.id,
          1,
          undefined, // 不传描述，使用默认的ACTION_DESCRIPTIONS，前端会根据语言显示
          PointsAction.GENERATE_STORY
        )
        console.log(`用户 ${session.user.id} 成功生成剧情，扣除1积分`)
      } catch (deductError) {
        // 如果扣除积分失败，记录错误但不影响返回结果（因为已经成功生成）
        console.error('扣除积分失败:', deductError)
      }

      // 保存剧情数据到 projectData
      if (body.projectId) {
        try {
          // 如果有 versionGroupId，创建新版本记录
          if (body.versionGroupId) {
            const { nanoid } = await import('nanoid')
            // 查找当前最新版本（用于计算版本号）
            const [latestRecord] = await db
              .select()
              .from(projectData)
              .where(eq(projectData.projectId, body.projectId))
              .orderBy(desc(projectData.version))
              .limit(1)

            const currentMaxVersion = latestRecord?.version ?? 0
            const newVersionNum = currentMaxVersion + 1

            // 初始化 storyboardData：从 scriptScenes 构建，确保 webhook 回调时能匹配
            const initialStoryboardData = (parsedData.scenes || []).map((scene: SceneDataItem, idx: number) => ({
              id: scene.id || String(idx + 1),
              sceneId: scene.id,
              imageUrl: '',
              plot: scene.plot || scene.description || '',
            }))

            const [newRecord] = await db
              .insert(projectData)
              .values({
                id: nanoid(),
                projectId: body.projectId,
                version: newVersionNum,
                scriptTitle: parsedData.title || parsedData.summary || null,
                scriptDescription: parsedData.summary || null,
                scriptScenes: parsedData.scenes || null,
                characterData: parsedData.characters || null,
                storyboardData: initialStoryboardData,
                versionGroupId: body.versionGroupId,
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .returning()

            savedVersion = newRecord?.id || null
            console.log(`[generate-story-details] 新版本已创建: projectId=${body.projectId}, recordId=${savedVersion}, version=${newVersionNum}, versionGroupId=${body.versionGroupId}`)
          } else {
            // 没有 versionGroupId，更新现有记录
            const [record] = await db
              .select()
              .from(projectData)
              .where(eq(projectData.projectId, body.projectId))
              .limit(1)

            if (record) {
              // 初始化 storyboardData（从 scriptScenes 构建或更新现有）
              let existingStoryboardData: SceneDataItem[] = []
              try {
                existingStoryboardData = typeof record.storyboardData === 'string'
                  ? JSON.parse(record.storyboardData)
                  : (record.storyboardData || []) as SceneDataItem[]
              } catch {}
              const initialStoryboardData = (parsedData.scenes || []).map((scene: SceneDataItem, idx: number) => {
                const existing = existingStoryboardData.find((s: SceneDataItem) => String(s.sceneId) === String(scene.id) || String(s.id) === String(scene.id))
                return existing || {
                  id: scene.id || String(idx + 1),
                  sceneId: scene.id,
                  imageUrl: '',
                  plot: scene.plot || scene.description || '',
                }
              })

              await db
                .update(projectData)
                .set({
                  scriptTitle: parsedData.title || parsedData.summary || null,
                  scriptDescription: parsedData.summary || null,
                  scriptScenes: parsedData.scenes || null,
                  characterData: parsedData.characters || null,
                  storyboardData: initialStoryboardData,
                  updatedAt: new Date(),
                })
                .where(eq(projectData.id, record.id))
              savedVersion = record.id
              console.log(`[generate-story-details] 剧情数据已保存: projectId=${body.projectId}, recordId=${record.id}`)
            }
          }
        } catch (dbError) {
          console.error('[generate-story-details] 保存剧情数据失败:', dbError)
        }
      }
    }

    trackFunnelEvent({ stage: 'script', userId: session.user.id, projectId: body.projectId ?? null, success: true, durationMs: Date.now() - scriptStartedAt, provider: 'zenmux', model })

    // 返回与 /api/video/generate-workflow 模拟格式一致的结构，便于前端统一解析
    return NextResponse.json({
      success: true,
      step: 'script',
      data: parsedData,
      raw: respJson,
      message: '剧情详情生成完成',
      version: savedVersion  // 实际是 record.id（nanoid）
    })
  } catch (error) {
    console.error('generate-story-details error:', error)
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

