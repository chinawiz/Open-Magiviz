import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import type {
  CharacterItem,
  ComposedVideoResult,
  SceneVideoItem,
  ScriptData,
  StoryScene,
  StoryboardItem,
} from "@/lib/types"

type WorkflowStep = 'idle' | 'script' | 'character' | 'storyboard' | 'scenes' | 'video'

/**
 * 工作流生成 hook 的共享 deps（拆分 T6/T7 清理票）。
 * use-storyboard-generation 与 use-character-generation 的公共接缝：
 * 共享编排 refs、两 hook 都要读写的状态值与 setter、共用的工作流回调。
 * 各 hook 自身的专属依赖在各自接口中 extends 本接口补充。
 */
export interface WorkflowGenerationDeps {
  // 共享编排 refs（与 operate 同源）
  abortControllerRef: MutableRefObject<AbortController | null>
  versionGroupIdRef: MutableRefObject<string | null>
  currentProjectIdRef: MutableRefObject<string | null>
  currentEditVersionId: MutableRefObject<string | null>
  workflowPausedRef: MutableRefObject<boolean>
  workflowInterruptedRef: MutableRefObject<boolean>
  // 共享状态值（每渲染传入，函数闭包捕获当次渲染值）
  aspectRatio: string
  characterData: CharacterItem[]
  scriptData: ScriptData | null
  sceneVideos: SceneVideoItem[]
  storyboardImages: StoryboardItem[]
  currentProjectId: string | null
  // 共享 setter
  setCurrentPoints: (v: number | null) => void
  setPurchaseDialogType: (v: 'points' | 'subscription' | 'card_verify') => void
  setShowPurchaseDialog: (v: boolean) => void
  setWorkflowPaused: (v: boolean) => void
  setStoryboardImages: Dispatch<SetStateAction<StoryboardItem[]>>
  setSceneVideos: Dispatch<SetStateAction<SceneVideoItem[]>>
  setVideoData: Dispatch<SetStateAction<ComposedVideoResult | null>>
  setWorkflowError: Dispatch<SetStateAction<string | null>>
  setWorkflowLoading: Dispatch<SetStateAction<boolean>>
  setWorkflowStep: Dispatch<SetStateAction<WorkflowStep>>
  // 共享工作流回调
  waitForGenerationResult: (params: {
    taskId: string
    type: 'character' | 'storyboard' | 'video' | 'compose'
    timeoutMs?: number
  }) => Promise<ComposedVideoResult>
  waitForWorkflowResume: () => Promise<void>
  generateVersionGroupId: () => string
  generateSceneVideoForScene: (params: {
    scene: StoryScene
    sceneIndex: number
    storyboardImage?: StoryboardItem
    aspectRatio: string
    consolePrefix: string
    versionId?: string
    versionGroupId?: string
  }) => Promise<SceneVideoItem>
  composeSceneVideosWithFAL: (
    sceneVideosToCompose: SceneVideoItem[],
    scriptDataForCompose?: ScriptData | null,
    abortSignal?: AbortSignal,
    projectId?: string,
    versionId?: string,
    versionGroupId?: string
  ) => Promise<ComposedVideoResult | null>
}
