import { getAuthedSession, jsonError } from '@/lib/api'
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { userAssets } from "@/lib/schema"
import { eq } from "drizzle-orm"

// DELETE: 删除用户素材
export async function DELETE(request: NextRequest) {
  try {
    const session = await getAuthedSession()

    if (!session) {
      return jsonError(401, 'Unauthorized')
433}

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "Asset ID required" }, { status: 400 })
    }

    // Verify ownership
    const asset = await db
      .select()
      .from(userAssets)
      .where(eq(userAssets.id, id))
      .limit(1)

    if (!asset.length) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 })
    }

    if (asset[0].userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    await db.delete(userAssets).where(eq(userAssets.id, id))

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Delete user asset error:", err)
    return NextResponse.json({ error: "Delete failed" }, { status: 500 })
  }
}

// PATCH: 更新用户素材（名称）
export async function PATCH(request: NextRequest) {
  try {
    const session = await getAuthedSession()

    if (!session) {
      return jsonError(401, 'Unauthorized')
1503}

    const body = await request.json()
    const { id, name } = body

    if (!id) {
      return NextResponse.json({ error: "Asset ID required" }, { status: 400 })
    }

    // Verify ownership
    const asset = await db
      .select()
      .from(userAssets)
      .where(eq(userAssets.id, id))
      .limit(1)

    if (!asset.length) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 })
    }

    if (asset[0].userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Build update object
    const updateData: Record<string, any> = { updatedAt: new Date() }
    if (name !== undefined) updateData.name = name

    await db.update(userAssets).set(updateData).where(eq(userAssets.id, id))

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Update user asset error:", err)
    return NextResponse.json({ error: "Update failed" }, { status: 500 })
  }
}
