/**
 * 版本映射工具 - 用于处理重新生成时的版本创建逻辑
 * 
 * 核心思路：
 * 1. 重新生成主角时，前端生成 versionGroupId
 * 2. 所有相关任务（主角、分镜图、剧情视频、完整视频）使用同一个 versionGroupId
 * 3. generate-story-details 已创建带 versionGroupId 的新版本 record
 * 4. 后续 webhook 回调使用已有的 record（不再重复创建）
 * 5. 第一个需要写入的 webhook 回调才存储 newVersionId（用于后续任务共享）
 */

import { db } from './db'
import { aiGenerationTasks, projectData } from './schema'
import { eq, and, desc, isNotNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'

/**
 * 获取当前活跃的新版本ID（通过 versionGroupId 查找）
 * 
 * @param projectId 项目ID
 * @param versionGroupId 版本组ID
 * @returns newVersionId 或 null（不存在）
 */
/** 模块内部使用：按 versionGroupId 查找已登记的新版本ID */
async function getActiveVersionId(
  projectId: string,
  versionGroupId: string
): Promise<string | null> {
  // 通过 versionGroupId 查找第一个任务记录
  const [task] = await db
    .select({ newVersionId: aiGenerationTasks.newVersionId })
    .from(aiGenerationTasks)
    .where(
      and(
        eq(aiGenerationTasks.projectId, projectId),
        eq(aiGenerationTasks.versionGroupId, versionGroupId)
      )
    )
    .limit(1)

  return task?.newVersionId ?? null
}

/**
 * 获取目标版本ID（用于失败处理）
 * 优先使用 newVersionId，如果没有则使用传入的 versionId
 */
export async function getActiveVersionIdForFail(
  projectId: string,
  versionGroupId: string | undefined,
  fallbackVersionId: string | null | undefined
): Promise<string | null> {
  if (versionGroupId) {
    return await getActiveVersionId(projectId, versionGroupId)
  }
  return fallbackVersionId ?? null
}

/**
 * 设置新版本ID（由第一个回调调用）
 * 更新同一个 versionGroupId 下的所有任务记录
 * 
 * @param projectId 项目ID
 * @param versionGroupId 版本组ID
 * @param newVersionId 新版本ID
 */
/** 模块内部使用：由第一个回调把 newVersionId 写入同组所有任务记录 */
async function setNewVersionId(
  projectId: string,
  versionGroupId: string,
  newVersionId: string
): Promise<void> {
  // 更新同一个 versionGroupId 下的所有任务记录
  await db
    .update(aiGenerationTasks)
    .set({ newVersionId })
    .where(
      and(
        eq(aiGenerationTasks.projectId, projectId),
        eq(aiGenerationTasks.versionGroupId, versionGroupId)
      )
    )
}

/**
 * 创建新版本并复制数据
 * 
 * @param projectId 项目ID
 * @param oldVersionId 旧版本ID（可选，用于复制数据）
 * @param versionGroupId 版本组ID（可选，用于关联同一批次的任务）
 * @param currentStep 当前步骤（可选，用于决定复制哪些数据）
 *   - script: 只复制脚本数据
 *   - character: 复制脚本和主角数据
 *   - storyboard: 复制脚本、主角和分镜图数据
 *   - scene_video: 复制脚本、主角、分镜图和剧情视频数据
 *   - final_video: 复制所有数据
 * @returns 新版本ID 和版本号
 */
/** 模块内部使用：创建新版本并按步骤复制数据 */
async function createNewVersion(
  projectId: string,
  oldVersionId?: string,
  versionGroupId?: string | null,
  currentStep?: 'script' | 'character' | 'storyboard' | 'scene_video' | 'final_video'
): Promise<{ newVersionId: string; newVersionNumber: number }> {
  // 查找当前项目的最新版本（用于计算版本号）
  const [latestRecord] = await db
    .select()
    .from(projectData)
    .where(eq(projectData.projectId, projectId))
    .orderBy(desc(projectData.version))
    .limit(1)

  const currentMaxVersion = latestRecord?.version ?? 0

  // 查找用于复制数据的旧版本（优先使用传入的 oldVersionId，否则使用最新版本）
  let dataSourceRecord = latestRecord
  if (oldVersionId && oldVersionId !== latestRecord?.id) {
    const [specifiedRecord] = await db
      .select()
      .from(projectData)
      .where(eq(projectData.id, oldVersionId))
      .limit(1)
    if (specifiedRecord) {
      dataSourceRecord = specifiedRecord
    }
  }

  // 新版本号 = 当前最大版本号 + 1
  const newVersionNumber = currentMaxVersion + 1
  const newRecordId = nanoid()

  // 根据当前步骤决定复制哪些数据
  // 脚本数据始终复制（最早的步骤）
  const scriptTitle = dataSourceRecord?.scriptTitle ?? null
  const scriptDescription = dataSourceRecord?.scriptDescription ?? null
  const scriptScenes = dataSourceRecord?.scriptScenes ?? null

  // 根据步骤决定是否复制后续数据
  const stepOrder = ['script', 'character', 'storyboard', 'scene_video', 'final_video']
  const currentStepIndex = currentStep ? stepOrder.indexOf(currentStep) : stepOrder.length

  // 主角数据：character 步骤及之后才复制
  const characterData = currentStepIndex >= 1 ? (dataSourceRecord?.characterData ?? null) : null

  // 分镜图数据：storyboard 步骤及之后才复制
  const storyboardData = currentStepIndex >= 2 ? (dataSourceRecord?.storyboardData ?? null) : null

  // 剧情视频数据：scene_video 步骤及之后才复制
  const sceneVideoData = currentStepIndex >= 3 ? (dataSourceRecord?.sceneVideoData ?? null) : null

  // 完整视频数据：final_video 步骤才复制（完整视频是最后一步）
  const finalVideoUrl = currentStepIndex >= 4 ? (dataSourceRecord?.finalVideoUrl ?? null) : null
  const finalVideoThumbnail = currentStepIndex >= 4 ? (dataSourceRecord?.finalVideoThumbnail ?? null) : null
  const finalVideoDuration = currentStepIndex >= 4 ? (dataSourceRecord?.finalVideoDuration ?? null) : null
  const finalVideoSize = currentStepIndex >= 4 ? (dataSourceRecord?.finalVideoSize ?? null) : null

  await db.insert(projectData).values({
    id: newRecordId,
    projectId: projectId,
    version: newVersionNumber,
    versionGroupId: versionGroupId ?? null, // 保存版本组 ID，便于后续回调查找
    scriptTitle,
    scriptDescription,
    scriptScenes,
    characterData,
    storyboardData,
    sceneVideoData,
    finalVideoUrl,
    finalVideoThumbnail,
    finalVideoDuration,
    finalVideoSize,
    migrationStatus: dataSourceRecord?.migrationStatus ?? 'pending',
    migrationCompletedAt: dataSourceRecord?.migrationCompletedAt ?? null,
    isActive: false, // 新版本默认不激活
    createdAt: new Date(),
  })

  console.log(`[createNewVersion] 创建新版本: projectId=${projectId}, version=${newVersionNumber}, currentStep=${currentStep ?? 'all'}, 复制数据: script=${scriptScenes ? '✓' : '✗'}, character=${characterData ? '✓' : '✗'}, storyboard=${storyboardData ? '✓' : '✗'}, sceneVideo=${sceneVideoData ? '✓' : '✗'}, finalVideo=${finalVideoUrl ? '✓' : '✗'}`)

  return { newVersionId: newRecordId, newVersionNumber }
}

/**
 * 清理版本组（所有步骤完成后调用）
 * 清除 versionGroupId 和 newVersionId 字段
 */
export async function clearVersionGroup(
  projectId: string,
  versionGroupId: string
): Promise<void> {
  await db
    .update(aiGenerationTasks)
    .set({ 
      versionGroupId: null,
      newVersionId: null 
    })
    .where(
      and(
        eq(aiGenerationTasks.projectId, projectId),
        eq(aiGenerationTasks.versionGroupId, versionGroupId)
      )
    )
}

/**
 * 确定目标版本ID
 * 
 * @param projectId 项目ID
 * @param versionGroupId 版本组ID（可选）
 * @param taskVersionId 任务关联的版本ID
 * @param currentStep 当前步骤（可选，用于决定复制哪些数据）
 * @returns 目标版本ID 和版本号
 */
export async function resolveTargetVersion(
  projectId: string,
  versionGroupId: string | null | undefined,
  taskVersionId: string | null | undefined,
  currentStep?: 'script' | 'character' | 'storyboard' | 'scene_video' | 'final_video'
): Promise<{ targetVersionId: string; newVersion: number; isNewVersion: boolean }> {
  // 如果有 versionGroupId，检查 projectData 是否已有该 versionGroupId 的记录（generate-story-details 已创建）
  if (versionGroupId) {
    const [existingRecord] = await db
      .select({ id: projectData.id, version: projectData.version })
      .from(projectData)
      .where(
        and(
          eq(projectData.projectId, projectId),
          eq(projectData.versionGroupId, versionGroupId),
          isNotNull(projectData.versionGroupId)
        )
      )
      .limit(1)

    if (existingRecord) {
      // projectData 已有该 versionGroupId 的记录，直接使用（generate-story-details 已创建）
      return {
        targetVersionId: existingRecord.id,
        newVersion: existingRecord.version,
        isNewVersion: false,
      }
    }

    // 检查 aiGenerationTasks 是否已有 newVersionId（后续回调）
    const activeVersionId = await getActiveVersionId(projectId, versionGroupId)
    if (activeVersionId) {
      const [record] = await db
        .select({ version: projectData.version })
        .from(projectData)
        .where(eq(projectData.id, activeVersionId))
        .limit(1)

      return {
        targetVersionId: activeVersionId,
        newVersion: record?.version ?? 1,
        isNewVersion: false,
      }
    }

    // 第一个 webhook 回调：创建新版本
    // 版本号现在基于当前最新版本计算，同时保存 versionGroupId 到 projectData
    const result = await createNewVersion(projectId, taskVersionId ?? undefined, versionGroupId, currentStep)

    // 存入任务表
    await setNewVersionId(projectId, versionGroupId, result.newVersionId)

    return {
      targetVersionId: result.newVersionId,
      newVersion: result.newVersionNumber,
      isNewVersion: true,
    }
  }

  // 没有 versionGroupId：使用传入的 versionId（兼容旧逻辑）
  if (taskVersionId) {
    const [record] = await db
      .select({ version: projectData.version })
      .from(projectData)
      .where(eq(projectData.id, taskVersionId))
      .limit(1)

    return {
      targetVersionId: taskVersionId,
      newVersion: record?.version ?? 1,
      isNewVersion: false,
    }
  }

  // 降级查找最新版本
  const [latestRecord] = await db
    .select()
    .from(projectData)
    .where(eq(projectData.projectId, projectId))
    .orderBy(desc(projectData.version))
    .limit(1)

  if (!latestRecord) {
    throw new Error(`未找到任何版本: projectId=${projectId}`)
  }

  return {
    targetVersionId: latestRecord.id,
    newVersion: latestRecord.version,
    isNewVersion: false,
  }
}
