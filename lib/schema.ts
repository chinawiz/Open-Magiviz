import { pgTable, text, timestamp, boolean, integer, jsonb, primaryKey, index, unique, uniqueIndex } from 'drizzle-orm/pg-core'
import type { AdapterAccount } from 'next-auth/adapters'
import { relations, sql } from 'drizzle-orm'

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
  password: text('password'),
  resetToken: text('resetToken'),
  resetTokenExpiry: timestamp('resetTokenExpiry', { mode: 'date' }),
  role: text('role').default('user'),
  points: integer('points').default(0), // 用户积分总数
  purchasedPoints: integer('purchasedPoints').default(0), // 购买的积分（永不过期）
  giftedPoints: integer('giftedPoints').default(0), // 赠送的积分（订阅到期清零）
  // 试用订阅标记：用户是否已经订阅（并消费）过一次 Trial
  hasTrialSubscription: boolean('hasTrialSubscription').notNull().default(false),
  // Stripe 相关字段
  stripeCustomerId: text('stripeCustomerId'),
  subscriptionId: text('subscriptionId'),
  subscriptionStatus: text('subscriptionStatus'), // active, cancelled, past_due, etc.
  subscriptionPlan: text('subscriptionPlan'), // pro, enterprise
  subscriptionCurrentPeriodEnd: timestamp('subscriptionCurrentPeriodEnd', { mode: 'date' }),
  // 推荐码相关字段
  referralCode: text('referralCode').unique(), // 用户的推荐码（唯一）
  referralCodeChanged: boolean('referralCodeChanged').default(false), // 是否已经修改过推荐码一次
  referredBy: text('referredBy'), // 邀请者的用户ID
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow(),
})

export const accounts = pgTable('accounts', {
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').$type<AdapterAccount['type']>().notNull(),
  provider: text('provider').notNull(),
  providerAccountId: text('providerAccountId').notNull(),
  refresh_token: text('refresh_token'),
  access_token: text('access_token'),
  expires_at: integer('expires_at'),
  token_type: text('token_type'),
  scope: text('scope'),
  id_token: text('id_token'),
  session_state: text('session_state'),
}, (account) => ({
  compoundKey: primaryKey({
    columns: [account.provider, account.providerAccountId],
  }),
}))

export const sessions = pgTable('sessions', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
})

export const verificationTokens = pgTable('verificationTokens', {
  identifier: text('identifier').notNull(),
  token: text('token').notNull(),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
}, (vt) => ({
  compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
}))

export const emailVerificationTokens = pgTable('emailVerificationTokens', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  token: text('token').notNull().unique(),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
})

export const newsletterSubscriptions = pgTable('newsletterSubscriptions', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  isActive: boolean('isActive').default(true),
  locale: text('locale').notNull().default('zh'), // 用户订阅时的语言偏好
  subscribedAt: timestamp('subscribedAt', { mode: 'date' }).defaultNow(),
  unsubscribedAt: timestamp('unsubscribedAt', { mode: 'date' }),
  unsubscribeToken: text('unsubscribeToken').unique(), // 用于取消订阅的令牌
})

export const pointsHistory = pgTable('pointsHistory', {
  id: text('id').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  points: integer('points').notNull(), // 积分变动数量（正数为增加，负数为扣除）
  pointsType: text('pointsType').notNull().default('purchased'), // 积分类型：purchased(购买), gifted(赠送)
  action: text('action').notNull(), // 操作类型：register, email_verify, daily_login, referral, manual, purchase, subscription_gift, subscription_expired等
  description: text('description'), // 操作描述
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
})

// Stripe支付记录表
export const stripePayments = pgTable('stripePayments', {
  id: text('id').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  stripeCustomerId: text('stripeCustomerId').notNull(),
  paymentIntentId: text('paymentIntentId'),
  checkoutSessionId: text('checkoutSessionId'),
  subscriptionId: text('subscriptionId'),
  invoiceId: text('invoiceId'),
  paymentStatus: text('paymentStatus').notNull(), // succeeded, failed, pending, refunded等
  paymentType: text('paymentType').notNull(), // subscription, points_purchase, one_time等
  amount: integer('amount').notNull(), // 支付金额（分为单位）
  currency: text('currency').notNull().default('usd'),
  productName: text('productName'),
  productDescription: text('productDescription'),
  priceId: text('priceId'),
  pointsAmount: integer('pointsAmount'), // 购买的积分数量
  pointsType: text('pointsType'), // purchased, gifted
  subscriptionPlan: text('subscriptionPlan'), // pro, enterprise
  subscriptionPeriodStart: timestamp('subscriptionPeriodStart', { mode: 'date' }),
  subscriptionPeriodEnd: timestamp('subscriptionPeriodEnd', { mode: 'date' }),
  refundAmount: integer('refundAmount'), // 退款金额（分为单位）
  refundReason: text('refundReason'),
  refundedAt: timestamp('refundedAt', { mode: 'date' }),
  metadata: text('metadata'), // JSON字符串，存储额外信息
  webhookEventId: text('webhookEventId'), // Stripe webhook事件ID
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow(),
}, (table) => ({
  // 幂等最终防线（F10）：webhook 处理器有应用层查重，唯一索引兜底并发窗口
  paymentIntentUnique: uniqueIndex('sp_payment_intent_unique').on(table.paymentIntentId),
  checkoutSessionUnique: uniqueIndex('sp_checkout_session_unique').on(table.checkoutSessionId),
}))

// 邀请关系表 - 追踪邀请者和被邀请者的关系
export const referrals = pgTable('referrals', {
  id: text('id').primaryKey(),
  referrerId: text('referrerId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }), // 邀请者ID
  referredId: text('referredId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }), // 被邀请者ID
  referralCode: text('referralCode').notNull(), // 使用的推荐码
  hasSubscribed: boolean('hasSubscribed').default(false), // 被邀请者是否已订阅
  subscriptionRewarded: boolean('subscriptionRewarded').default(false), // 是否已给邀请者发放订阅奖励
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow(),
})

// 邀请历史记录表 - 记录邀请相关的所有操作
export const referralHistory = pgTable('referralHistory', {
  id: text('id').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }), // 操作相关的用户ID（邀请者或被邀请者）
  referralId: text('referralId')
    .references(() => referrals.id, { onDelete: 'cascade' }), // 关联的邀请关系ID
  action: text('action').notNull(), // 操作类型：register_bonus(注册奖励), subscription_reward(订阅返利)
  description: text('description'), // 操作描述
  pointsAwarded: integer('pointsAwarded'), // 奖励的积分（如果有）
  subscriptionDaysExtended: integer('subscriptionDaysExtended'), // 延长的订阅天数（如果有）
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
})

// ========== 推广返利系统 (Affiliate System) - 完全独立于现有推荐系统 ==========

// 推广人资料表
export const affiliateProfiles = pgTable('affiliate_profiles', {
  id: text('id').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(), // 一个用户只能有一个推广资料
  code: text('code').notNull().unique(), // 推广码（唯一）
  codeChanged: boolean('codeChanged').notNull().default(false), // 推广码是否已修改过（只能修改一次）
  balance: integer('balance').notNull().default(0), // 可用余额（分为单位）
  frozenBalance: integer('frozenBalance').notNull().default(0), // 冻结余额（分为单位）
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow(),
}, (table) => ({
  codeIdx: index('affiliate_code_idx').on(table.code),
  userIdIdx: index('affiliate_user_id_idx').on(table.userId),
}))

// 推广关系表 - 追踪推广人和被推广人的关系
export const affiliateRelations = pgTable('affiliate_relations', {
  id: text('id').primaryKey(),
  referrerId: text('referrerId')
    .notNull()
    .references(() => affiliateProfiles.id, { onDelete: 'cascade' }), // 推广人ID（关联affiliate_profiles）
  inviteeId: text('inviteeId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(), // 被推广人ID（关联users，确保一个用户只被绑定一次）
  expiresAt: timestamp('expiresAt', { mode: 'date' }).notNull(), // 关系过期时间（注册后30天）
  hasConverted: boolean('hasConverted').notNull().default(false), // 是否已转化（首单完成）
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow(),
}, (table) => ({
  referrerIdx: index('affiliate_relation_referrer_idx').on(table.referrerId),
  inviteeIdx: index('affiliate_relation_invitee_idx').on(table.inviteeId),
  inviteeUnique: unique('affiliate_relation_invitee_unique').on(table.inviteeId),
}))

// 推广佣金记录表
export const affiliateEarnings = pgTable('affiliate_earnings', {
  id: text('id').primaryKey(),
  affiliateId: text('affiliateId')
    .notNull()
    .references(() => affiliateProfiles.id, { onDelete: 'cascade' }), // 推广人ID
  amount: integer('amount').notNull(), // 佣金金额（分为单位）
  status: text('status').notNull().default('FROZEN'), // 状态：FROZEN(冻结), RELEASED(已解冻), CANCELLED(已取消)
  releaseDate: timestamp('releaseDate', { mode: 'date' }).notNull(), // 解冻日期（7天后）
  stripeOrderId: text('stripeOrderId'), // Stripe订单ID（用于退款匹配）
  relationId: text('relationId')
    .references(() => affiliateRelations.id, { onDelete: 'set null' }), // 关联的推广关系ID
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow(),
}, (table) => ({
  affiliateIdx: index('affiliate_earning_affiliate_idx').on(table.affiliateId),
  statusIdx: index('affiliate_earning_status_idx').on(table.status),
  releaseDateIdx: index('affiliate_earning_release_date_idx').on(table.releaseDate),
  stripeOrderIdx: index('affiliate_earning_stripe_order_idx').on(table.stripeOrderId),
}))

// ========== Relations 定义 ==========

export const affiliateProfilesRelations = relations(affiliateProfiles, ({ one, many }) => ({
  user: one(users, {
    fields: [affiliateProfiles.userId],
    references: [users.id],
  }),
  relations: many(affiliateRelations),
  earnings: many(affiliateEarnings),
  withdrawals: many(affiliateWithdrawals),
}))

export const affiliateRelationsRelations = relations(affiliateRelations, ({ one, many }) => ({
  referrer: one(affiliateProfiles, {
    fields: [affiliateRelations.referrerId],
    references: [affiliateProfiles.id],
  }),
  invitee: one(users, {
    fields: [affiliateRelations.inviteeId],
    references: [users.id],
  }),
  earnings: many(affiliateEarnings),
}))

export const affiliateEarningsRelations = relations(affiliateEarnings, ({ one }) => ({
  affiliate: one(affiliateProfiles, {
    fields: [affiliateEarnings.affiliateId],
    references: [affiliateProfiles.id],
  }),
  relation: one(affiliateRelations, {
    fields: [affiliateEarnings.relationId],
    references: [affiliateRelations.id],
  }),
}))

// 提现记录表
export const affiliateWithdrawals = pgTable('affiliate_withdrawals', {
  id: text('id').primaryKey(),
  affiliateId: text('affiliateId')
    .notNull()
    .references(() => affiliateProfiles.id, { onDelete: 'cascade' }), // 推广人ID
  amount: integer('amount').notNull(), // 提现金额（美分为单位）
  status: text('status').notNull().default('PENDING'), // 状态：PENDING(待处理), PROCESSING(处理中), COMPLETED(已完成), FAILED(失败), CANCELLED(已取消)
  paymentMethod: text('paymentMethod').notNull(), // 支付方式：alipay, paypal等
  accountName: text('accountName').notNull(), // 账户姓名
  accountInfo: text('accountInfo').notNull(), // 账户信息（支付宝账号、PayPal邮箱等）
  transactionId: text('transactionId'), // 第三方交易ID
  failureReason: text('failureReason'), // 失败原因
  processedAt: timestamp('processedAt', { mode: 'date' }), // 处理完成时间
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow(),
}, (table) => ({
  affiliateIdx: index('affiliate_withdrawal_affiliate_idx').on(table.affiliateId),
  statusIdx: index('affiliate_withdrawal_status_idx').on(table.status),
  createdAtIdx: index('affiliate_withdrawal_created_at_idx').on(table.createdAt),
}))

export const affiliateWithdrawalsRelations = relations(affiliateWithdrawals, ({ one }) => ({
  affiliate: one(affiliateProfiles, {
    fields: [affiliateWithdrawals.affiliateId],
    references: [affiliateProfiles.id],
  }),
}))

// ========== 视频项目系统 ==========

// 项目主表
export const videoProjects = pgTable('video_projects', {
  id: text('id').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),                    // 项目标题
  originalPrompt: text('originalPrompt').notNull(),  // 原始提示词
  aspectRatio: text('aspectRatio').default('16:9'),  // 画面比例
  duration: text('duration').default('auto'),        // 时长
  // 视频风格：auto/anime/hollywood/ads
  videoStyle: text('videoStyle'),
  // 视频模型：auto/veo31Fast/veo31Lite/veo31Quality/seedance2Fast/seedance2Mini/seedance2/kling3/wan27/minimaxH3
  videoModel: text('videoModel').default('auto'),
  // 生成模式：auto/first-last-frame
  generationMode: text('generationMode').default('auto'),
  thumbnailUrl: text('thumbnailUrl'),               // 封面图URL
  status: text('status').notNull().default('draft'),// draft/completed
  currentStep: text('currentStep'),                  // script/character/storyboard/scene_video/final_video
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }),
  completedAt: timestamp('completedAt', { mode: 'date' }),
}, (table) => ({
  userIdIdx: index('vp_user_id_idx').on(table.userId),
  statusIdx: index('vp_status_idx').on(table.status),
  createdAtIdx: index('vp_created_at_idx').on(table.createdAt),
}))

// 项目数据表（存储每一步的数据和版本）
export const projectData = pgTable('project_data', {
  id: text('id').primaryKey(),
  projectId: text('projectId')
    .notNull()
    .references(() => videoProjects.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(1),      // 版本号
  versionGroupId: text('version_group_id'),              // 版本组ID（由第一个 webhook 创建）

  // 剧情数据
  scriptTitle: text('scriptTitle'),                       // 剧情标题
  scriptDescription: text('scriptDescription'),           // 剧情描述
  scriptScenes: jsonb('scriptScenes'),                    // 场景列表JSON

  // 主角数据
  characterData: jsonb('characterData'),                  // 主角数组JSON

  // 分镜图数据
  storyboardData: jsonb('storyboardData'),                // 分镜图数组JSON

  // 剧情视频数据
  sceneVideoData: jsonb('sceneVideoData'),                // 视频数组JSON

  // 最终视频数据
  finalVideoUrl: text('finalVideoUrl'),
  finalVideoThumbnail: text('finalVideoThumbnail'),
  finalVideoDuration: integer('finalVideoDuration'),
  finalVideoSize: text('finalVideoSize'),

  // 资源搬运状态
  migrationStatus: text('migrationStatus').default('pending'), // pending | completed | failed
  migrationCompletedAt: timestamp('migrationCompletedAt'),     // 搬运完成时间

  isActive: boolean('isActive').notNull().default(false), // 是否激活版本
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }), // 版本最后修改时间
}, (table) => ({
  projectIdIdx: index('pd_project_id_idx').on(table.projectId),
  versionIdx: index('pd_version_idx').on(table.version),
  versionGroupIdIdx: index('pd_version_group_id_idx').on(table.versionGroupId),
}))

// Relations 定义
export const videoProjectsRelations = relations(videoProjects, ({ one, many }) => ({
  user: one(users, {
    fields: [videoProjects.userId],
    references: [users.id],
  }),
  data: many(projectData),
}))

export const projectDataRelations = relations(projectData, ({ one }) => ({
  project: one(videoProjects, {
    fields: [projectData.projectId],
    references: [videoProjects.id],
  }),
}))

// ========== AI 生成任务映射表 ==========

// AI 生成任务表 - 用于存储 taskId 和 userId 的映射关系，以便在 webhook 回调时扣除积分
export const aiGenerationTasks = pgTable('ai_generation_tasks', {
  id: text('id').primaryKey(),
  taskId: text('taskId').notNull().unique(), // Kie.ai 返回的 taskId
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  taskType: text('taskType').notNull(), // 任务类型：generate_character, generate_storyboard, generate_video 等
  pointsDeducted: boolean('pointsDeducted').notNull().default(false), // 是否已扣除积分
  pointsAmount: integer('pointsAmount').notNull(), // 需要扣除的积分数量
  status: text('status').notNull().default('pending'), // 任务状态：pending, success, failed
  // 用于 webhook 回调时定位具体项目和资源
  projectId: text('projectId'),        // 所属项目 ID（关联 projectData.projectId）
  versionId: text('versionId'),        // projectData 的主键 ID（精确定位版本）
  itemId: text('itemId'),              // 具体资源 ID（主角 ID 或分镜 sceneId）
  // 版本组相关（用于关联同一批次的重新生成任务）
  versionGroupId: text('version_group_id'),  // 版本组ID（关联同一批次的所有任务）
  newVersionId: text('new_version_id'),      // 新版本ID（由第一个回调创建，后续回调使用）
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow(),
}, (table) => ({
  taskIdIdx: index('ai_task_task_id_idx').on(table.taskId),
  userIdIdx: index('ai_task_user_id_idx').on(table.userId),
  statusIdx: index('ai_task_status_idx').on(table.status),
  projectIdIdx: index('ai_task_project_id_idx').on(table.projectId),
  versionIdIdx: index('ai_task_version_id_idx').on(table.versionId),
  versionGroupIdIdx: index('ai_task_version_group_id_idx').on(table.versionGroupId),
}))

export const aiGenerationTasksRelations = relations(aiGenerationTasks, ({ one }) => ({
  user: one(users, {
    fields: [aiGenerationTasks.userId],
    references: [users.id],
  }),
}))

// ========== 用户素材库系统 ==========

// 用户素材表 - 存储用户上传的素材
export const userAssets = pgTable('user_assets', {
  id: text('id').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),                    // 素材名称
  type: text('type').notNull(),                   // 素材类型：image/audio/video
  url: text('url').notNull(),                     // 素材URL
  thumbnailUrl: text('thumbnailUrl'),              // 缩略图URL（视频/音频用）
  fileSize: integer('fileSize'),                   // 文件大小（字节）
  mimeType: text('mimeType'),                     // MIME类型
  width: integer('width'),                        // 图片/视频宽度
  height: integer('height'),                      // 图片/视频高度
  duration: integer('duration'),                  // 音频/视频时长（秒）
  tags: text('tags').array(),                     // 标签数组
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }),
}, (table) => ({
  userIdIdx: index('ua_user_id_idx').on(table.userId),
  typeIdx: index('ua_type_idx').on(table.type),
  createdAtIdx: index('ua_created_at_idx').on(table.createdAt),
}))

// Relations 定义
export const userAssetsRelations = relations(userAssets, ({ one }) => ({
  user: one(users, {
    fields: [userAssets.userId],
    references: [users.id],
  }),
}))

// ========== 资源迁移记录表 ==========
// 用于防止重复迁移：记录每个 URL 的迁移状态

export const assetMigrations = pgTable('asset_migrations', {
  id: text('id').primaryKey(),
  projectId: text('projectId')
    .notNull()
    .references(() => videoProjects.id, { onDelete: 'cascade' }),
  resourceType: text('resourceType').notNull(),  // character | storyboard | storyboard-first | storyboard-last | scene-video | final-video | final-thumbnail
  sourceUrl: text('sourceUrl').notNull(),         // 原始临时 URL
  permanentUrl: text('permanentUrl'),              // 迁移后的永久 URL
  r2Key: text('r2Key'),                           // R2 存储 key
  status: text('status').notNull().default('pending'),  // pending | completed | failed
  errorMessage: text('errorMessage'),              // 错误信息
  retryCount: integer('retryCount').default(0),   // 重试次数
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }),
}, (table) => ({
  // 唯一索引：同一 projectId + resourceType + sourceUrl 组合只迁移一次
  uniqueMigrationIdx: uniqueIndex('am_unique_migration_idx').on(table.projectId, table.resourceType, table.sourceUrl),
  projectIdIdx: index('am_project_id_idx').on(table.projectId),
  statusIdx: index('am_status_idx').on(table.status),
}))

// Relations
export const assetMigrationsRelations = relations(assetMigrations, ({ one }) => ({
  project: one(videoProjects, {
    fields: [assetMigrations.projectId],
    references: [videoProjects.id],
  }),
})) 

// ========== AI 供应商适配层（F2/M2）==========
// 按 capability 分组的有序供应商路由表（设计 §4.2.9 修正版：text UUID 主键、
// camelCase 列名、无 tenant_id；region 为 IC-01 预留插拔位，当前仅 overseas，
// 'local' 预留给自托管推理节点）。priority=0 为 primary，降级按 priority 升序。
export const providerRoutes = pgTable('provider_routes', {
  id: text('id').primaryKey(),
  capability: text('capability').notNull(),          // script | image | video | compose
  provider: text('provider').notNull(),              // kieai | zenmux | fal | local
  modelKey: text('modelKey'),                        // 具体模型键；NULL 表示该供应商任意/由调用方决定
  region: text('region').notNull().default('overseas'),
  priority: integer('priority').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
  configVersion: text('configVersion').notNull().default('v1'),
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow(),
}, (table) => ({
  // 启用行内 (capability, region, priority) 唯一，保证降级顺序无并列；禁用行不受限
  capRegionPriUnique: uniqueIndex('provider_routes_cap_region_pri')
    .on(table.capability, table.region, table.priority)
    .where(sql`enabled = true`),
  capRegionIdx: index('provider_routes_cap_region').on(table.capability, table.region),
}))

// ========== N1 漏斗埋点 ==========
// 创意→成片六阶段事件（lib/observability/track.ts 写入）：
// 支撑 V1 降级成功率（provider/model/fallbackApplied）与 V4 漏斗转化度量。
export const funnelEvents = pgTable('funnel_events', {
  id: text('id').primaryKey(),
  userId: text('userId'),
  projectId: text('projectId'),
  stage: text('stage').notNull(),              // idea|script|character|storyboard|video|final
  success: boolean('success').notNull().default(true),
  durationMs: integer('durationMs'),
  provider: text('provider'),                  // kieai/zenmux/fal/local
  model: text('model'),                        // veo31Lite/nano-banana-2 等
  fallbackApplied: boolean('fallbackApplied').notNull().default(false),
  taskId: text('taskId'),
  error: text('error'),
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
}, (table) => ({
  stageCreatedIdx: index('fe_stage_created_idx').on(table.stage, table.createdAt),
  projectIdx: index('fe_project_idx').on(table.projectId),
  userCreatedIdx: index('fe_user_created_idx').on(table.userId, table.createdAt),
}))
