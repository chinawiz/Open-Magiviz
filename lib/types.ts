/**
 * 项目共享类型集中定义。
 * 目标：收敛散落在各路由/组件中的 `any`，提供可复用的领域类型与数据库行类型。
 */

import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'
import type { users, videoProjects, projectData, aiGenerationTasks, affiliateWithdrawals, stripePayments, affiliateRelations, affiliateEarnings, affiliateProfiles, referrals, referralHistory } from './schema'

/** 用户表行（数据库读取结果） */
export type UserRow = InferSelectModel<typeof users>
/** 用户表写入参数（插入/更新） */
export type NewUser = InferInsertModel<typeof users>

/** 视频项目行 */
export type VideoProjectRow = InferSelectModel<typeof videoProjects>
/** 视频项目写入参数 */
export type NewVideoProject = InferInsertModel<typeof videoProjects>

/** 项目数据行（含脚本/分镜/视频等 JSON 字段） */
export type ProjectDataRow = InferSelectModel<typeof projectData>
/** 项目数据写入参数 */
export type NewProjectData = InferInsertModel<typeof projectData>

/** AI 生成任务映射行 */
export type AiGenerationTaskRow = InferSelectModel<typeof aiGenerationTasks>

/** 推广提现记录写入参数 */
export type NewAffiliateWithdrawal = InferInsertModel<typeof affiliateWithdrawals>

/** 推广资料行（数据库读取结果） */
export type AffiliateProfileRow = InferSelectModel<typeof affiliateProfiles>
/** 推广关系行（数据库读取结果） */
export type AffiliateRelationRow = InferSelectModel<typeof affiliateRelations>
/** 推广关系写入参数 */
export type NewAffiliateRelation = InferInsertModel<typeof affiliateRelations>

/** 推广佣金记录行（数据库读取结果） */
export type AffiliateEarningRow = InferSelectModel<typeof affiliateEarnings>
/** 推广佣金记录写入参数 */
export type NewAffiliateEarning = InferInsertModel<typeof affiliateEarnings>

/** 推荐关系记录行（数据库读取结果） */
export type ReferralRow = InferSelectModel<typeof referrals>
/** 推荐历史记录行（数据库读取结果） */
export type ReferralHistoryRow = InferSelectModel<typeof referralHistory>

/** 推荐奖励页（referral/rewards）返回的前端 DTO */
export type ReferralRewardItem = ReferralHistoryRow & {
  referralCode?: string | null
  referredId?: string | null
  referredUserEmail?: string | null
  referredUserName?: string | null
}

/** 支付记录写入参数 */
export type NewStripePayment = InferInsertModel<typeof stripePayments>

/**
 * 推广后台（admin/affiliates）与推广页（affiliate/*）返回的前端 DTO。
 * 后端在 DB 行之外拼装了关联的用户名/邮箱等展示字段，故单独定义，避免再回退到 any。
 */
export type AdminAffiliateProfile = AffiliateProfileRow & {
  userName?: string | null
  userEmail?: string | null
}
export type AdminAffiliateRelation = {
  id: string
  referrerId: string
  inviteeId: string
  expiresAt: Date
  hasConverted: boolean
  createdAt: Date | null
  referrerName?: string | null
  referrerEmail?: string | null
  inviteeName?: string | null
  inviteeEmail?: string | null
}
export type AdminAffiliateEarning = {
  id: string
  affiliateId: string
  amount: number
  status: string
  releaseDate: Date
  stripeOrderId: string | null
  relationId: string | null
  createdAt: Date | null
  affiliateUserName?: string | null
  affiliateUserEmail?: string | null
  inviteeUserName?: string | null
  inviteeUserEmail?: string | null
}
export type AdminAffiliateWithdrawal = {
  id: string
  affiliateId: string
  amount: number
  status: string
  paymentMethod: string
  accountName: string
  accountInfo: string
  transactionId: string | null
  failureReason: string | null
  processedAt: Date | null
  createdAt: Date | null
  userName?: string | null
  userEmail?: string | null
}

/** 用户侧推广页（affiliate/*）返回的前端 DTO */
export interface AffiliateRelationItem {
  id: string
  expiresAt: Date
  hasConverted: boolean
  createdAt: Date | null
  isExpired: boolean
  invitee: {
    id: string
    name?: string | null
    email?: string | null
    image?: string | null
    createdAt?: Date | null
  } | null
}
export interface AffiliateEarningItem {
  id: string
  amount: number
  status: string
  releaseDate: Date
  stripeOrderId: string | null
  createdAt: Date | null
  updatedAt: Date | null
  invitee: {
    id: string
    name?: string | null
    email?: string | null
  } | null
}
export interface AffiliateWithdrawalItem {
  id: string
  amount: number
  status: string
  paymentMethod: string
  accountName: string
  accountInfo: string
  transactionId: string | null
  failureReason: string | null
  processedAt: Date | null
  createdAt: Date | null
  updatedAt: Date | null
}

/**
 * NextAuth Session 中 user 的业务字段（subscriptionPlan/role 等）统一在
 * lib/auth.ts 的 `declare module "next-auth"` 模块增强中声明，
 * 各路由/组件直接访问 session.user.subscriptionPlan，无需类型断言。
 */

/** 单条分镜场景（脚本阶段） */
export interface StoryScene {
  id?: string
  title?: string
  content?: string
  description?: string
  plot?: string
  plotText?: string
  duration?: string | number
  imagePrompt?: string
  characterIds?: string[]
  [key: string]: unknown
}

/** 单条分镜图 */
export interface StoryboardItem {
  id?: string
  url?: string
  prompt?: string
  title?: string
  description?: string
  plot?: string
  sceneId?: string
  sceneIndex?: number
  imageUrl?: string
  thumbnailUrl?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  firstFramePrompt?: string
  lastFramePrompt?: string
  images?: {
    firstFrame?: { url?: string }
    lastFrame?: { url?: string }
  }
  aspectRatio?: string
  generatedAt?: string
  isFrameOnly?: boolean
  frameType?: 'first' | 'last' | string
  baseSceneIndex?: number
  isGenerating?: boolean
  isTemporary?: boolean
  isEditingFirstFrame?: boolean
  isEditingLastFrame?: boolean
  localUrl?: string
  error?: string
  generationError?: string
  [key: string]: unknown
}

/** 单条剧情视频 */
export interface SceneVideoItem {
  id?: string
  url?: string
  thumbnail?: string
  thumbnailUrl?: string
  videoUrl?: string | null
  sceneId?: string | number | undefined
  sceneIndex?: number
  isGenerating?: boolean
  error?: string
  generationError?: string
  duration?: number | string
  prompt?: string
  [key: string]: unknown
}

/** 主角数据 */
export interface CharacterItem {
  id?: string
  name?: string
  imageUrl?: string | null
  url?: string
  thumbnailUrl?: string | null
  description?: string
  generationPrompt?: string
  generationError?: string
  [key: string]: unknown
}

/** 分镜图生成时传入的角色引用（前端组装后透传，保持原有对象结构） */
export interface CharacterImageRef {
  characterId?: string | number
  imageUrl?: string | null
  imagePrompt?: string
  [key: string]: unknown
}

/** 统一 API 成功/失败响应形状（配合 lib/api.ts 的 jsonOk / jsonError） */
export interface ApiErrorBody {
  error: string
  [key: string]: unknown
}

/**
 * 合成视频结果（FAL 合成 / 单段视频结果）。
 * 字段以实际返回为准，保留 index signature 以兼容运行时附加字段。
 */
export interface ComposedVideoResult {
  url?: string
  thumbnailUrl?: string
  resultUrls?: string[]
  duration?: number | string
  aspectRatio?: string
  fileSize?: number | string
  sceneId?: string | number
  sceneIndex?: number
  prompt?: string
  error?: string
  code?: string
  storyboardImage?: unknown
  [key: string]: unknown
}

/**
 * 创作页脚本数据（脚本/剧情详情）。
 * 用于 operate.tsx 的 scriptData / editedScriptData。字段宽松扩展。
 */
export interface ScriptData {
  title?: string
  summary?: string
  description?: string
  aspectRatio?: string
  totalDuration?: number
  scenes?: StoryScene[]
  characters?: CharacterItem[]
  [key: string]: unknown
}

/**
 * 素材库列表项（library/* 路由构造的统一素材对象）。
 * 覆盖 characters / storyboards / videos / all 四种来源的归一化结构。
 */
export interface LibraryMaterialItem {
  id: string
  projectId?: string | null
  projectTitle?: string
  name?: string
  prompt?: string
  imageUrl?: string
  videoUrl?: string
  thumbnailUrl?: string
  url?: string
  audioUrl?: string
  type?: 'character' | 'storyboard' | 'video' | 'audio' | string
  createdAt?: Date | string | null
  sceneIndex?: number
  duration?: number
  isUserAsset?: boolean
}
