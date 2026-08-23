import { describe, it, expect } from "vitest"
import { getAllVideoDurations } from "./video"

// node 环境中 document 不存在，getVideoDuration 会同步 reject，
// 因此可稳定覆盖 getAllVideoDurations 的兜底分支。
const errMsg = {
  cannotReadVideoDuration: "无法读取视频时长",
  videoLoadFailed: "视频加载失败",
  videoLoadTimeout: "视频加载超时",
}

describe("getAllVideoDurations", () => {
  it("空数组返回空", async () => {
    expect(await getAllVideoDurations([], errMsg)).toEqual([])
  })

  it("读取失败且无 API duration 时回退默认 5 秒", async () => {
    const result = await getAllVideoDurations([{ videoUrl: "blob:test" }], errMsg)
    expect(result).toEqual([5])
  })

  it("读取失败时使用 API 返回的秒值（<=100 视为秒）", async () => {
    const result = await getAllVideoDurations(
      [{ videoUrl: "blob:test", duration: 3.5 }],
      errMsg
    )
    expect(result).toEqual([3.5])
  })

  it("读取失败时 API duration >100 视为毫秒并换算为秒", async () => {
    const result = await getAllVideoDurations(
      [{ videoUrl: "blob:test", duration: 2000 }],
      errMsg
    )
    expect(result).toEqual([2])
  })

  it("混合输入：毫秒/秒/无 duration 分别兜底", async () => {
    const result = await getAllVideoDurations(
      [
        { videoUrl: "blob:a", duration: 2000 },
        { videoUrl: "blob:b", duration: 4 },
        { videoUrl: "blob:c" },
      ],
      errMsg
    )
    expect(result).toEqual([2, 4, 5])
  })
})
