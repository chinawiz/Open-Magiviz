"use client"

import { useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { subscribeToTask, disconnectPusher } from "@/lib/pusher-client"
import type { ComposedVideoResult } from "@/lib/types"

type PendingTask = {
  type: 'character' | 'storyboard' | 'video' | 'compose'
  resolve: (data: unknown) => void
  reject: (error: unknown) => void
}

/**
 * Pusher 实时进度通道 hook。
 * 从 components/operate.tsx 拆出（拆分 T8），行为与原来一致：
 * 持有活跃的 Pusher 订阅与待处理任务表，waitForGenerationResult 以
 * Promise 形式等待某个 taskId 的成功/失败事件；组件卸载时清理订阅与连接。
 * pendingTasksRef 原样暴露给调用方（暂停流程需要直接检查/包装 pending 任务）。
 */
export function useTaskEvents() {
  const t = useTranslations("operate")

  // 存储活跃的 Pusher 订阅（用于组件卸载时清理）
  const pusherUnsubscribeRef = useRef<(() => void) | null>(null)
  // 存储待处理的生成任务（key: taskId, value: { type, resolve, reject }）
  const pendingTasksRef = useRef<Map<string, PendingTask>>(new Map())
  // 用于跟踪组件是否已挂载
  const isMountedRef = useRef(false)

  useEffect(() => {
    // 组件挂载时标记
    isMountedRef.current = true
    // Map 实例自初始化后不变，此处捕获引用供卸载清理使用
    const pendingTasks = pendingTasksRef.current

    // 组件卸载时清理 Pusher 订阅和待处理任务
    return () => {
      isMountedRef.current = false
      if (pusherUnsubscribeRef.current) {
        console.log('[Pusher] 组件卸载，清理订阅')
        pusherUnsubscribeRef.current()
        pusherUnsubscribeRef.current = null
      }
      disconnectPusher()
      pendingTasks.clear()
    }
  }, [])

  /**
   * 使用 Pusher 实时等待生成结果
   *
   * @param taskId - Kie.ai 返回的任务 ID
   * @param type - 生成类型 ('character' | 'storyboard')
   * @param timeoutMs - 超时时间（默认 480000ms = 8分钟）
   * @returns 生成结果数据
   */
  async function waitForGenerationResult(params: {
    taskId: string
    type: 'character' | 'storyboard' | 'video' | 'compose'
    timeoutMs?: number
  }): Promise<ComposedVideoResult> {
    const { taskId, type, timeoutMs = 480000 } = params

    console.log(`[Pusher] 开始等待生成结果:`, { taskId, type })

    return new Promise((resolve, reject) => {
      // 设置超时
      const timeoutId = setTimeout(() => {
        // 清理pending状态
        pendingTasksRef.current.delete(taskId)
        // 取消订阅
        if (pusherUnsubscribeRef.current) {
          pusherUnsubscribeRef.current()
          pusherUnsubscribeRef.current = null
        }
        console.warn(`[Pusher] 等待超时:`, { taskId })
        reject(new Error(t('waitingGenerationResultTimeout', { seconds: timeoutMs / 1000 })))
      }, timeoutMs)

      // 保存任务到 pendingTasks
      pendingTasksRef.current.set(taskId, {
        type,
        resolve: (data: unknown) => {
          // 检查组件是否已挂载
          if (!isMountedRef.current) {
            console.log(`[Pusher] 组件已卸载，跳过状态更新:`, { taskId })
            return
          }
          clearTimeout(timeoutId)
          pendingTasksRef.current.delete(taskId)
          console.log(`[Pusher] 任务完成:`, { taskId, data })
          resolve(data as ComposedVideoResult)
        },
        reject: (error: unknown) => {
          // 检查组件是否已挂载
          if (!isMountedRef.current) {
            console.log(`[Pusher] 组件已卸载，跳过状态更新:`, { taskId })
            return
          }
          clearTimeout(timeoutId)
          pendingTasksRef.current.delete(taskId)
          reject(error)
        }
      })

      // 订阅 Pusher 频道
      const unsubscribe = subscribeToTask({
        taskId,
        onSuccess: (data) => {
          console.log(`[Pusher] 收到成功事件:`, { taskId, data })
          const pending = pendingTasksRef.current.get(taskId)
          if (pending) {
            pending.resolve(data)
          }
        },
        onFail: (data) => {
          console.log(`[Pusher] 收到失败事件:`, { taskId, data })
          const pending = pendingTasksRef.current.get(taskId)
          if (pending) {
            // 使用 resolve 而不是 reject，避免抛出错误（页面已显示错误信息）
            pending.resolve({
              error: data?.error || t('generationFailed'),
              imageUrl: '',
              videoUrl: '',
              resultUrls: []
            })
          }
        },
        onProgress: (data) => {
          console.log(`[Pusher] 收到进度事件:`, { taskId, data })
          // 可选：更新 UI 显示进度
        },
        onError: (error) => {
          console.error(`[Pusher] Pusher 错误:`, { taskId, error })
          // Pusher 连接错误不一定是任务失败，继续等待
        }
      })

      // 保存取消订阅函数
      pusherUnsubscribeRef.current = unsubscribe
    })
  }

  return { waitForGenerationResult, pendingTasksRef }
}
