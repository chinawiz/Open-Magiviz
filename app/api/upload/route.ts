import { NextRequest, NextResponse } from "next/server"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { getAuthedSession } from "@/lib/api"
import { db } from "@/lib/db"
import { userAssets } from "@/lib/schema"
import { getStorageLimit } from "@/lib/plan-limits"
import { sql } from "drizzle-orm"
import { nanoid } from "nanoid"

const S3 = new S3Client({
  region: process.env.R2_REGION || "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY || "",
    secretAccessKey: process.env.R2_SECRET_KEY || "",
  },
})

// 存储空间限制统一引用 lib/plan-limits.ts（配额唯一事实源）

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { filename, contentType, data, name, assetType } = body
    if (!filename || !data) {
      return NextResponse.json({ error: "Missing file data" }, { status: 400 })
    }

    // 获取当前用户 session（未登录也允许匿名上传，仅不保存素材库）
    const session = await getAuthedSession()
    const userId = session?.user?.id

    // 如果有用户，保存到素材库
    if (userId) {
      const userPlan = session!.user.subscriptionPlan || "free"
      const storageLimit = getStorageLimit(userPlan)

      // 如果不是无限制计划，检查存储空间
      if (storageLimit > 0) {
        const usageResult = await db.execute(
          sql`SELECT COALESCE(SUM(${userAssets.fileSize}), 0) as total FROM ${userAssets} WHERE ${userAssets.userId} = ${userId}`
        )
        const result = usageResult as unknown as Array<{ total: bigint | number | null }>
        const usedStorage = Number(result[0]?.total ?? 0)

        const buffer = Buffer.from(data, "base64")
        const fileSize = buffer.length

        // 检查单个文件大小
        if (fileSize > storageLimit) {
          return NextResponse.json({
            error: "STORAGE_LIMIT_EXCEEDED",
            code: "FILE_SIZE_EXCEEDS_LIMIT",
            message: "File size exceeds your storage limit",
            usedStorage,
            storageLimit,
          }, { status: 413 })
        }

        // 检查总存储空间
        if (usedStorage + fileSize > storageLimit) {
          return NextResponse.json({
            error: "STORAGE_LIMIT_EXCEEDED",
            code: "TOTAL_STORAGE_EXCEEDED",
            message: "Total storage would exceed your limit",
            usedStorage,
            storageLimit,
            availableStorage: storageLimit - usedStorage,
          }, { status: 413 })
        }
      }
    }

    // Determine subfolder based on content type
    let subfolder = "files"
    if (contentType?.startsWith("image/")) {
      subfolder = "image"
    } else if (contentType?.startsWith("audio/")) {
      subfolder = "audio"
    } else if (contentType?.startsWith("video/")) {
      subfolder = "video"
    }

    const buffer = Buffer.from(data, "base64")
    const key = `uploads/${subfolder}/${Date.now()}-${nanoid()}-${filename}`

    await S3.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    )

    // Construct candidate public URLs (try multiple patterns and pick the first reachable)
    const publicBase = process.env.R2_PUBLIC_URL?.replace(/\/$/, "") || ""
    const candidates: string[] = []
    if (publicBase) candidates.push(`${publicBase}/${key}`)
    if (process.env.R2_ENDPOINT && process.env.R2_BUCKET) {
      const endpointClean = process.env.R2_ENDPOINT.replace(/\/$/, "")
      candidates.push(`${endpointClean}/${process.env.R2_BUCKET}/${key}`)
      try {
        const epUrl = new URL(process.env.R2_ENDPOINT)
        candidates.push(`https://${process.env.R2_BUCKET}.${epUrl.host}/${key}`)
      } catch {}
    }
    if (process.env.R2_PATH_PREFIX && process.env.R2_ENDPOINT) {
      const prefix = String(process.env.R2_PATH_PREFIX).replace(/^\/|\/$/g, "")
      const endpointClean = process.env.R2_ENDPOINT.replace(/\/$/, "")
      candidates.push(`${endpointClean}/${prefix}/${key}`)
    }
    if (process.env.R2_ENDPOINT) {
      const endpointClean = process.env.R2_ENDPOINT.replace(/\/$/, "")
      candidates.push(`${endpointClean}/editf/${key}`)
    }

    // pick first candidate that responds to HEAD
    let finalUrl = candidates[0] || ""
    for (const c of candidates) {
      try {
        const res = await fetch(c, { method: "HEAD" })
        if (res.ok) {
          finalUrl = c
          break
        }
      } catch (err) {
        // ignore and try next
      }
    }

    // fallback: if none worked but we have publicBase prefer it, else use endpoint/bucket/key
    if (!finalUrl) {
      if (publicBase) finalUrl = `${publicBase}/${key}`
      else if (process.env.R2_ENDPOINT && process.env.R2_BUCKET) {
        finalUrl = `${process.env.R2_ENDPOINT.replace(/\/$/, "")}/${process.env.R2_BUCKET}/${key}`
      } else {
        finalUrl = key
      }
    }

    // 如果有用户，自动保存到素材库
    if (userId) {
      const fileSize = buffer.length
      let fileType = assetType || "file"
      if (!assetType) {
        if (contentType?.startsWith("image/")) {
          fileType = "image"
        } else if (contentType?.startsWith("audio/")) {
          fileType = "audio"
        } else if (contentType?.startsWith("video/")) {
          fileType = "video"
        }
      }

      const assetId = nanoid()
      await db.insert(userAssets).values({
        id: assetId,
        userId: userId,
        name: name || filename,
        type: fileType,
        url: finalUrl,
        thumbnailUrl: finalUrl,
        fileSize: fileSize,
        mimeType: contentType,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }

    return NextResponse.json({ url: finalUrl, key })
  } catch (err) {
    console.error("Upload API error:", err)
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}
