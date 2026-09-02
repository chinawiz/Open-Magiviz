import { getAuthedSession, jsonError, jsonOk } from '@/lib/api'
import { callChatCompletion, parseJsonFromContent, LLMError } from '@/lib/llm'
import { moderatePrompt, moderationErrorResponse, combineTextsForModeration } from '@/lib/content-moderation'

// ── 常量配置 ───────────────────────────────────────────────
const MODEL = 'google/gemini-3-flash-preview'
const DEFAULT_ASPECT_RATIO = '16:9'
const DEFAULT_DURATION = 5
const LOG_PREFIX = '[generate-scene-plot]'

// ── 类型定义 ───────────────────────────────────────────────
interface ExistingScene {
  title?: string
  plot?: string
  description?: string
  aspectRatio?: string
  [key: string]: unknown
}

interface SceneContext {
  aspectRatio: string
  history: string
}

// ── 工具函数 ───────────────────────────────────────────────

/** 取场景的可读描述，兼容 plot / description 两种字段 */
function describeScene(scene: ExistingScene | null): string {
  if (!scene) return ''
  return scene.plot || (scene.description as string) || 'No description'
}

/** 根据已有场景与目标索引，推导宽高比与上下文文本 */
function extractSceneContext(
  existingScenes: ExistingScene[],
  newSceneIndex: number,
  fallbackAspectRatio: string,
): SceneContext {
  const previousScene = existingScenes[newSceneIndex - 1] ?? null
  const nextScene = existingScenes[newSceneIndex] ?? null

  // 优先沿用上一场景的宽高比，其次取入参，最后回退默认值
  const aspectRatio =
    (previousScene?.aspectRatio as string) || fallbackAspectRatio || DEFAULT_ASPECT_RATIO

  let history = ''
  if (previousScene) {
    history += `Previous scene: ${previousScene.title} - ${describeScene(previousScene)}\n`
  }
  if (nextScene) {
    history += `Next scene: ${nextScene.title} - ${describeScene(nextScene)}\n`
  }

  return { aspectRatio, history }
}

/** 组装发送给模型的分镜剧情生成提示词 */
function buildScenePlotPrompt(params: {
  storyTitle?: string
  summary?: string
  existingScenes: ExistingScene[]
  newSceneIndex: number
  targetDuration: number
  aspectRatio: string
  history: string
}): string {
  const { storyTitle, summary, existingScenes, newSceneIndex, targetDuration, aspectRatio, history } = params

  return `You are a creative story assistant. Based on the existing story context, generate a detailed plot description for a new scene.

Story title: ${storyTitle || 'Untitled'}
Story summary: ${summary || 'No summary'}
Target scene index: ${newSceneIndex + 1}

${history}
Existing scenes count: ${existingScenes.length}

Requirements:
1. The new scene must maintain logical coherence with the previous and next scenes
2. If there is a previous scene, it should naturally transition from it
3. If there is a next scene, it should set up for the following scene
4. Duration: ${targetDuration} seconds
5. Aspect ratio: ${aspectRatio}

Return the detailed scene information in JSON format as follows:
{
  "title": "Scene title",
  "description": "Detailed scene description (what happens, camera moves, mood, etc.)",
  "duration": ${targetDuration},
  "aspectRatio": "${aspectRatio}",
  "storyboardPrompt": "Prompt for generating storyboard image (concise, one to two sentences, include camera, composition, lighting, mood, style)",
  "sceneVideoPrompt": "Prompt for generating scene video (describe motion, camera movement, timing, transition effects)",
  "visualElements": ["important visual element 1", "element 2"],
  "narration": "If there is dialogue or narration, write it here",
  "transition": "How this scene transitions to the next scene (e.g., cut, fade, dissolve)",
  "characterIds": [],
  "storyboardCharacterImages": []
}

Important: Return only JSON, no explanatory text. Ensure valid JSON format.`
}

// ── 主流程 ─────────────────────────────────────────────────
// POST: 基于上下文为单个新场景生成剧情
export async function POST(request: Request) {
  try {
    const session = await getAuthedSession()
    if (!session) {
      return jsonError(401, 'Unauthorized')
    }

    const body = await request.json()
    const {
      storyTitle,
      summary,
      existingScenes,
      newSceneIndex,
      aspectRatio = DEFAULT_ASPECT_RATIO,
      targetDuration = DEFAULT_DURATION,
    } = body as {
      storyTitle?: string
      summary?: string
      existingScenes?: ExistingScene[]
      newSceneIndex?: number
      aspectRatio?: string
      targetDuration?: number
    }

    if (!Array.isArray(existingScenes) || existingScenes.length === 0) {
      return jsonError(
        400,
        'Missing existing scenes context. Please provide at least one existing scene.',
      )
    }

    // Creem 内容安全审核：标题/摘要/既有场景的用户文本合并送审（fail-closed）
    const moderation = await moderatePrompt(
      combineTextsForModeration([
        storyTitle,
        summary,
        ...(existingScenes?.flatMap(s =>
          s && typeof s === 'object' ? Object.values(s).filter((v): v is string => typeof v === 'string') : [],
        ) ?? []),
      ]),
      { externalId: `scene-plot:${session.user.id}` },
    )
    if (!moderation.ok) {
      const err = moderationErrorResponse(moderation)
      return jsonError(err.status, err.body.error, { errorKey: err.body.errorKey })
    }

    // 1. 推导场景上下文
    const { aspectRatio: resolvedAspectRatio, history } = extractSceneContext(
      existingScenes,
      newSceneIndex as number,
      aspectRatio,
    )

    // 2. 组装提示词
    const prompt = buildScenePlotPrompt({
      storyTitle,
      summary,
      existingScenes,
      newSceneIndex: newSceneIndex as number,
      targetDuration,
      aspectRatio: resolvedAspectRatio,
      history,
    })

    // 3. 调用模型
    let content: string
    try {
      content = await callChatCompletion({
        model: MODEL,
        system:
          'You are a creative story assistant. Always respond with valid JSON only. If you cannot generate JSON, return an object with an "error" field.',
        user: prompt,
      })
    } catch (apiError) {
      if (apiError instanceof LLMError) {
        console.error(`${LOG_PREFIX} ZenMux API error:`, apiError.details ?? apiError.message)
        return jsonError(
          apiError.status,
          apiError.message,
          apiError.details ? { details: apiError.details } : undefined,
        )
      }
      throw apiError
    }

    if (!content) {
      return jsonError(500, 'Invalid response from AI service')
    }

    // 4. 解析并返回
    try {
      const parsedContent = parseJsonFromContent(content)
      return jsonOk({ success: true, data: parsedContent })
    } catch (parseError) {
      console.error(`${LOG_PREFIX} JSON parse error:`, parseError)
      return jsonError(500, 'Failed to parse AI response as JSON', { rawResponse: content })
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Error:`, error)
    return jsonError(500, 'Internal server error')
  }
}
