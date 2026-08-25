import { NextRequest, NextResponse } from "next/server"
import { and, eq, or } from "drizzle-orm"
import { getAuthedSession } from '@/lib/api'
import { db } from '@/lib/db'
import { assetMigrations, userAssets, videoProjects } from '@/lib/schema'
import { deriveR2KeyFromUrl, createPresignedGetUrl } from '@/lib/r2-presign'

/**
 * POST /api/ai/kie/download-url
 *
 * 资产下载 URL 签发（T-05/T-07 加固后行为）：
 * 1. 要求登录（原路由无鉴权）；
 * 2. 自有 R2 资产（upload/migrate 产出的公开直链）→ 校验归属后返回
 *    预签名 URL（300 秒，桶可转私有）；
 *    - 项目资产：asset_migrations 定位 projectId → 校验 videoProjects.userId
 *    - 用户素材：userAssets.url 且 userId 匹配
 * 3. 其他 URL（Kie.ai 生成的临时资源）→ 保留原代理行为（20 分钟临时 URL）。
 */

const KIE_API_URL = "https://api.kie.ai/api/v1/common/download-url"
const KIE_API_KEY = process.env.KIE_API_KEY!
const PRESIGN_EXPIRES_SEC = 300

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthedSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const body = await request.json()
    const { url } = body

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: "URL is required" }, { status: 400 })
    }

    // ===== 自有 R2 资产：归属校验 + 预签名（T-05）=====
    const r2Key = deriveR2KeyFromUrl(url)
    if (r2Key) {
      // 项目资产（角色/分镜/场景视频/成片的迁移记录）
      const [migration] = await db
        .select({ projectId: assetMigrations.projectId })
        .from(assetMigrations)
        .where(or(
          eq(assetMigrations.r2Key, r2Key),
          eq(assetMigrations.permanentUrl, url),
        ))
        .limit(1)

      if (migration) {
        const [project] = await db
          .select({ userId: videoProjects.userId })
          .from(videoProjects)
          .where(eq(videoProjects.id, migration.projectId))
          .limit(1)

        if (!project || project.userId !== userId) {
          console.warn('[download-url] 项目资产归属校验失败:', { userId, projectId: migration.projectId })
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
      } else {
        // 用户上传素材（uploads/ 前缀，无项目归属）
        const [asset] = await db
          .select({ id: userAssets.id })
          .from(userAssets)
          .where(and(
            eq(userAssets.url, url),
            eq(userAssets.userId, userId),
          ))
          .limit(1)

        if (!asset) {
          console.warn('[download-url] R2 资产无归属记录或不属于当前用户:', { userId, r2Key })
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
      }

      const downloadUrl = await createPresignedGetUrl(r2Key, PRESIGN_EXPIRES_SEC)
      return NextResponse.json({
        success: true,
        downloadUrl,
        expiresIn: PRESIGN_EXPIRES_SEC,
        source: 'r2-presigned',
      })
    }

    // ===== Kie.ai 临时资源：保留原代理行为 =====
    if (!KIE_API_KEY) {
      return NextResponse.json({ error: "KIE_API_KEY is not configured" }, { status: 500 })
    }

    const response = await fetch(KIE_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KIE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url })
    })

    const data = await response.json()

    if (data.code !== 200) {
      console.error('Kie.ai download URL error:', data)
      return NextResponse.json({
        error: data.msg || "Failed to get download URL",
        code: data.code
      }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      downloadUrl: data.data,
      expiresIn: 20 * 60 // 20 分钟
    })

  } catch (error) {
    console.error("Download URL Error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
