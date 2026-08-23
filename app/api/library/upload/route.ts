import { getAuthedSession, jsonError } from '@/lib/api'
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { userAssets } from "@/lib/schema"
import { eq, sql } from "drizzle-orm"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { nanoid } from "nanoid"

// 存储空间限制定义（字节）
const STORAGE_LIMITS: Record<string, number> = {
  // 未登录/Free: 1GB
  free: 1 * 1024 * 1024 * 1024,
  // Trial: 50GB
  trial: 50 * 1024 * 1024 * 1024,
  // Pro: 100GB
  pro: 100 * 1024 * 1024 * 1024,
  // Annual: 无限制
  annual: -1,
}

// 获取存储空间限制
function getStorageLimit(plan: string | null): number {
  if (!plan) return STORAGE_LIMITS.free
  return STORAGE_LIMITS[plan] ?? STORAGE_LIMITS.free
}

const S3 = new S3Client({
  region: process.env.R2_REGION || "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY || "",
    secretAccessKey: process.env.R2_SECRET_KEY || "",
  },
})

// 上传文件到 R2
async function uploadToR2(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  // Determine subfolder based on content type
  let subfolder = "files"
  if (contentType?.startsWith("image/")) {
    subfolder = "image"
  } else if (contentType?.startsWith("audio/")) {
    subfolder = "audio"
  } else if (contentType?.startsWith("video/")) {
    subfolder = "video"
  }

  const key = `uploads/${subfolder}/${Date.now()}-${nanoid()}-${filename}`

  await S3.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  )

  // Construct candidate public URLs
  const publicBase = process.env.R2_PUBLIC_URL?.replace(/\/$/, "") || ""
  const candidates: string[] = []
  if (publicBase) candidates.push(`${publicBase}/${key}`)
  if (process.env.R2_ENDPOINT && process.env.R2_BUCKET) {
    const endpointClean = process.env.R2_ENDPOINT.replace(/\/$/, "")
    candidates.push(`${endpointClean}/${process.env.R2_BUCKET}/${key}`)
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

  // Pick first candidate that responds to HEAD
  let finalUrl = candidates[0] || ""
  for (const c of candidates) {
    try {
      const res = await fetch(c, { method: "HEAD" })
      if (res.ok) {
        finalUrl = c
        break
      }
    } catch {
      // ignore and try next
    }
  }

  if (!finalUrl) {
    if (publicBase) finalUrl = `${publicBase}/${key}`
    else if (process.env.R2_ENDPOINT && process.env.R2_BUCKET) {
      finalUrl = `${process.env.R2_ENDPOINT.replace(/\/$/, "")}/${process.env.R2_BUCKET}/${key}`
    } else {
      finalUrl = key
    }
  }

  return finalUrl
}

// POST: 上传用户素材
export async function POST(request: NextRequest) {
  try {
    const session = await getAuthedSession()

    if (!session) {
      return jsonError(401, 'Unauthorized')
    }

    //  * 获取用户订阅计划
    const userPlan = session.user.subscriptionPlan || "free"
    const storageLimit = getStorageLimit(userPlan)

    // 如果不是无限制计划，检查存储空间
    if (storageLimit > 0) {
      // 计算当前已用存储空间
      // Neon 返回格式: { rows: [{ total: "12345" }] }，数字是字符串形式
      const usageResult = await db.execute(
        sql`SELECT COALESCE(SUM(${userAssets.fileSize}), 0) as total FROM ${userAssets} WHERE ${userAssets.userId} = ${session.user.id}`
      )

      let usedStorage = 0
      if (usageResult && typeof usageResult === 'object') {
        const rows = (usageResult as { rows?: Array<{ total?: unknown }> }).rows
        if (Array.isArray(rows) && rows.length > 0) {
          const total = rows[0].total
          usedStorage = typeof total === 'string' ? parseInt(total, 10) : Number(total)
        }
      }

      const formData = await request.formData()
      const file = formData.get("file") as File | null

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 })
      }

      // 检查单个文件大小
      if (file.size > storageLimit) {
        return NextResponse.json({
          error: "STORAGE_LIMIT_EXCEEDED",
          code: "FILE_SIZE_EXCEEDS_LIMIT",
          message: "File size exceeds your storage limit",
          usedStorage,
          storageLimit,
          fileSize: file.size,
        }, { status: 413 })
      }

      // 检查总存储空间
      if (usedStorage + file.size > storageLimit) {
        return NextResponse.json({
          error: "STORAGE_LIMIT_EXCEEDED",
          code: "TOTAL_STORAGE_EXCEEDED",
          message: "Total storage would exceed your limit",
          usedStorage,
          storageLimit,
          availableStorage: storageLimit - usedStorage,
          fileSize: file.size,
        }, { status: 413 })
      }

      // Determine file type
      let fileType = "file"
      if (file.type.startsWith("image/")) {
        fileType = "image"
      } else if (file.type.startsWith("audio/")) {
        fileType = "audio"
      } else if (file.type.startsWith("video/")) {
        fileType = "video"
      }

      // Read file as buffer
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      // Upload to R2
      const url = await uploadToR2(buffer, file.name, file.type)
      const name = formData.get("name") as string | null

      // Generate thumbnail URL for video/audio (same as url for now, frontend can handle)
      const thumbnailUrl = url

      // Save to database
      const assetId = nanoid()
      await db.insert(userAssets).values({
        id: assetId,
        userId: session.user.id,
        name: name || file.name,
        type: fileType,
        url,
        thumbnailUrl,
        fileSize: file.size,
        mimeType: file.type,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      return NextResponse.json({
        success: true,
        data: {
          id: assetId,
          name: name || file.name,
          type: fileType,
          url,
          thumbnailUrl,
          fileSize: file.size,
          mimeType: file.type,
          createdAt: new Date().toISOString(),
        },
        storage: {
          usedStorage: usedStorage + file.size,
          storageLimit,
        },
      })
    }

    // 无限制计划，直接上传
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const name = formData.get("name") as string | null

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    // Determine file type
    let fileType = "file"
    if (file.type.startsWith("image/")) {
      fileType = "image"
    } else if (file.type.startsWith("audio/")) {
      fileType = "audio"
    } else if (file.type.startsWith("video/")) {
      fileType = "video"
    }

    // Read file as buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Upload to R2
    const url = await uploadToR2(buffer, file.name, file.type)

    // Generate thumbnail URL for video/audio (same as url for now, frontend can handle)
    const thumbnailUrl = url

    // Save to database
    const assetId = nanoid()
    await db.insert(userAssets).values({
      id: assetId,
      userId: session.user.id,
      name: name || file.name,
      type: fileType,
      url,
      thumbnailUrl,
      fileSize: file.size,
      mimeType: file.type,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    return NextResponse.json({
      success: true,
      data: {
        id: assetId,
        name: name || file.name,
        type: fileType,
        url,
        thumbnailUrl,
        fileSize: file.size,
        mimeType: file.type,
        createdAt: new Date().toISOString(),
      },
      storage: {
        usedStorage: null,
        storageLimit: -1,
      },
    })
  } catch (err) {
    console.error("Upload user asset error:", err)
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}

// GET: 获取用户素材列表
export async function GET(request: Request) {
  try {
    const session = await getAuthedSession()

    if (!session) {
      return jsonError(401, 'Unauthorized')
8516}

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get("page") || "1")
    const limit = parseInt(searchParams.get("limit") || "30")
    const type = searchParams.get("type") || "all" // all, image, audio, video
    const search = searchParams.get("search") || ""
    const offset = (page - 1) * limit

    // Build query conditions
    const conditions = [eq(userAssets.userId, session.user.id)]

    if (type !== "all") {
      conditions.push(eq(userAssets.type, type))
    }

    // Get total count
    const allAssets = await db
      .select()
      .from(userAssets)
      .where(eq(userAssets.userId, session.user.id))

    // Filter by type and search
    let filteredAssets = allAssets
    if (type !== "all") {
      filteredAssets = filteredAssets.filter(a => a.type === type)
    }
    if (search) {
      const searchLower = search.toLowerCase()
      filteredAssets = filteredAssets.filter(a =>
        a.name.toLowerCase().includes(searchLower)
      )
    }

    // Sort by createdAt desc
    filteredAssets.sort((a, b) =>
      new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
    )

    // Paginate
    const total = filteredAssets.length
    const paginatedAssets = filteredAssets.slice(offset, offset + limit)

    return NextResponse.json({
      success: true,
      data: {
        items: paginatedAssets.map(a => ({
          id: a.id,
          name: a.name,
          type: a.type,
          url: a.url,
          thumbnailUrl: a.thumbnailUrl,
          fileSize: a.fileSize,
          mimeType: a.mimeType,
          createdAt: a.createdAt,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    })
  } catch (err) {
    console.error("Get user assets error:", err)
    return NextResponse.json({ error: "Failed to fetch assets" }, { status: 500 })
  }
}
