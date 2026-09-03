/**
 * 视频模型客户端元数据表（UI 展示用）——自 operate.tsx 内联定义抽出（operate 拆分 T1）。
 * 纯数据、零依赖，客户端/服务端两侧均可 import。
 *
 * 权威口径仍在服务端，此处是镜像：
 * - 分辨率档权威在 lib/providers/submit.ts 的 supportedResolutions
 *   （UI 选了不支持的档会被服务端忽略并回落默认档）；
 * - 单位积分权威在 lib/video-pricing.ts 的 VIDEO_MODEL_UNIT_POINTS；
 * - 镜像与权威的一致性由 lib/providers/video-models.test.ts 双向守卫，
 *   两边只许一起改。
 */

/** 各模型可选分辨率档（仅 ≥2 档可选的模型入表；固定档/无档模型不显示分辨率选择器） */
export const VIDEO_MODEL_RESOLUTIONS: Record<string, string[]> = {
  seedance25: ['480p', '720p', '1080p'],
  seedance2Fast: ['480p', '720p'],
  seedance2Mini: ['480p', '720p'],
  seedance2: ['480p', '720p'],
  wan27: ['720p', '1080p'],
  happyHorse: ['720p', '1080p'],
  kling3: ['720p', '1080p'],
}

/** 模型 key → next-intl 文案键（messages/*.json 的 videoModel* 键） */
export const VIDEO_MODEL_I18N_KEYS: Record<string, string> = {
  veo31Fast: 'videoModelVeo31Fast',
  veo31Lite: 'videoModelVeo31Lite',
  veo31Quality: 'videoModelVeo31Quality',
  geminiOmni: 'videoModelGeminiOmni',
  seedance25: 'videoModelSeedance25',
  seedance2Fast: 'videoModelSeedance2Fast',
  seedance2Mini: 'videoModelSeedance2Mini',
  seedance2: 'videoModelSeedance2',
  kling3: 'videoModelKling3',
  happyHorse: 'videoModelHappyHorse',
  wan27: 'videoModelWan27',
  minimaxH3: 'videoModelMinimaxH3',
}

/** 模型选择器展示顺序（'auto' 置首，其余与 VIDEO_SUBMITTERS 同集） */
export const VIDEO_MODEL_OPTION_ORDER: string[] = [
  'auto',
  'veo31Lite',
  'veo31Fast',
  'veo31Quality',
  'geminiOmni',
  'seedance25',
  'seedance2Fast',
  'seedance2Mini',
  'seedance2',
  'kling3',
  'happyHorse',
  'wan27',
  'minimaxH3',
]

/**
 * 上传视频/音频素材时唯一兼容的模型族（Seedance 系）。
 * 前端强制切换，后端提交侧不重复校验——两端若要改口径，先同步这里与路由预检。
 */
export const MEDIA_COMPATIBLE_VIDEO_MODELS: string[] = [
  'seedance2',
  'seedance2Fast',
  'seedance2Mini',
  'seedance25',
]

/** 不支持首尾帧（first-last-frame）生成模式的模型 */
export const FIRST_LAST_FRAME_UNSUPPORTED_MODELS: string[] = ['happyHorse', 'geminiOmni']

/** 'auto' 档的估价回落模型（与路由预检口径一致；路由预检为权威） */
export const AUTO_MODEL_FALLBACK = 'veo31Fast'
