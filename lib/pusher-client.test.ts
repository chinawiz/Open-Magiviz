import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock("@sentry/nextjs", () => ({ captureException }))

import { subscribeToTask } from "./pusher-client"

/**
 * 订阅失败 fail-soft 契约（拆分 T8 发现 #1 的修复锚点）：
 * 缺 NEXT_PUBLIC_PUSHER_KEY/CLUSTER 时 getPusherClient 会 throw，
 * subscribeToTask 必须吞掉异常返回空取消订阅函数（不拖垮页面），
 * 同时失败必须可观测（console.error + Sentry.captureException）——
 * 否则表现为「事件永远不来」的静默失效，正是线上「推送未达」调查的同族问题。
 */
describe("subscribeToTask（缺配置 fail-soft 契约）", () => {
  beforeEach(() => {
    captureException.mockClear()
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubEnv("NEXT_PUBLIC_PUSHER_KEY", "")
    vi.stubEnv("NEXT_PUBLIC_PUSHER_CLUSTER", "")
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("缺配置时不抛错，返回可安全调用的空取消订阅函数", () => {
    const unsubscribe = subscribeToTask({ taskId: "task-test-1" })
    expect(typeof unsubscribe).toBe("function")
    expect(() => unsubscribe()).not.toThrow()
    expect(captureException).not.toHaveBeenCalledTimes(0)
  })

  it("缺配置时失败可观测：console.error 与 Sentry.captureException 各至少一次", () => {
    subscribeToTask({ taskId: "task-test-2" })
    expect(console.error).toHaveBeenCalled()
    expect(captureException).toHaveBeenCalledTimes(1)
  })

  it("Sentry 捕获带 component/action 定位标签", () => {
    subscribeToTask({ taskId: "task-test-3" })
    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { component: "pusher-client", action: "subscribe" } })
    )
  })
})
