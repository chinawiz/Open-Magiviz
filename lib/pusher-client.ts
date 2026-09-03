'use client'

import PusherClient from 'pusher-js'
import * as Sentry from '@sentry/nextjs'

/**
 * Pusher Client-side Configuration
 * 
 * 环境变量要求：
 * - NEXT_PUBLIC_PUSHER_KEY: Pusher Public Key
 * - NEXT_PUBLIC_PUSHER_CLUSTER: Pusher 集群名称
 */

let pusherClientInstance: PusherClient | null = null

// 跟踪已订阅的频道，避免重复订阅
const subscribedChannels = new Set<string>()

/**
 * 获取 Pusher 客户端实例 (单例模式)
 */
export function getPusherClient(): PusherClient {
  if (!pusherClientInstance) {
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER

    if (!key || !cluster) {
      throw new Error('缺少 Pusher 环境变量: NEXT_PUBLIC_PUSHER_KEY 或 NEXT_PUBLIC_PUSHER_CLUSTER')
    }

    pusherClientInstance = new PusherClient(key, {
      cluster,
      forceTLS: true,
      // 禁用 auth endpoint (前端只订阅，不需要认证)
    })

    console.log('[Pusher] 客户端实例已创建:', { cluster })
  }

  return pusherClientInstance
}

/**
 * 订阅任务频道
 *
 * @param taskId - Kie.ai 返回的任务 ID
 * @param callbacks - 事件回调
 * @returns unsubscribe 函数
 */
interface PusherTaskPayload {
  status?: string
  data?: {
    taskId?: string
    imageUrl?: string
    videoUrl?: string
    resultUrls?: string[]
    characterId?: string
    sceneId?: string
    sceneIndex?: number
    type?: string
    progress?: number
    error?: string
    errorCode?: string
  }
}

export function subscribeToTask(params: {
  taskId: string
  onSuccess?: (data: {
    taskId?: string
    imageUrl?: string
    videoUrl?: string
    resultUrls?: string[]
    characterId?: string
    sceneId?: string
    sceneIndex?: number
    type?: string
  }) => void
  onFail?: (data: {
    taskId?: string
    error: string
    errorCode?: string
  }) => void
  onProgress?: (data: {
    taskId?: string
    progress: number
    message?: string
  }) => void
  onError?: (error: unknown) => void
}): () => void {
  const { taskId, onSuccess, onFail, onProgress, onError } = params

  try {
    const pusher = getPusherClient()
    const channelName = `task-${taskId}`

    // 检查是否已经订阅过，避免重复订阅
    if (subscribedChannels.has(channelName)) {
      console.log('[Pusher] 频道已订阅，跳过:', channelName)
      // 返回一个空取消订阅函数
      return () => {}
    }

    console.log('[Pusher] 订阅频道:', channelName)
    subscribedChannels.add(channelName)

    const channel = pusher.subscribe(channelName)

    // 绑定成功事件 - 支持所有类型 (image, storyboard, video)
    if (onSuccess) {
      channel.bind('status', (data: unknown) => {
        const payload = data as PusherTaskPayload
        console.log('[Pusher] 收到事件:', JSON.stringify(data))
        if (payload.status === 'success' && payload.data) {
          const validTypes = ['image', 'storyboard', 'video', 'compose']
          if (validTypes.includes(payload.data.type ?? '')) {
            console.log('[Pusher] 收到成功事件:', payload.data.type, payload.data)
            onSuccess(payload.data)
          }
        }
      })
    }

    // 绑定失败事件
    if (onFail) {
      channel.bind('status', (data: unknown) => {
        const payload = data as PusherTaskPayload
        if (payload.status === 'fail') {
          console.log('[Pusher] 收到失败事件:', data)
          onFail(payload.data as { taskId: string; error: string; errorCode?: string })
        }
      })
    }

    // 绑定进度事件
    if (onProgress) {
      channel.bind('status', (data: unknown) => {
        const payload = data as PusherTaskPayload
        if (payload.status === 'pending' && payload.data?.progress !== undefined) {
          onProgress(payload.data as { taskId: string; progress: number; message?: string })
        }
      })
    }

    // 绑定错误事件
    if (onError) {
      channel.bind('pusher:error', (error: unknown) => {
        console.error('[Pusher] Pusher 错误:', error)
        onError(error)
      })
    }

    // 订阅成功
    channel.bind('pusher:subscription_succeeded', () => {
      console.log('[Pusher] 订阅成功:', channelName)
    })

    // 订阅失败
    channel.bind('pusher:subscription_error', (error: unknown) => {
      console.error('[Pusher] 订阅失败:', error)
      Sentry.captureException(error, { tags: { component: 'pusher-client', action: 'subscription' } })
      if (onError) {
        onError(error)
      }
    })

    // 返回取消订阅函数
    return () => {
      console.log('[Pusher] 取消订阅:', channelName)
      subscribedChannels.delete(channelName)
      channel.unbind_all()
      pusher.unsubscribe(channelName)
    }

  } catch (error) {
    console.error('[Pusher] 订阅失败:', error)
    // 仅 console.error 在生产不可见(如缺 NEXT_PUBLIC_* 时的静默失效),必须进 Sentry
    Sentry.captureException(error, { tags: { component: 'pusher-client', action: 'subscribe' } })
    if (onError) {
      onError(error)
    }
    // 返回空函数
    return () => {}
  }
}

/**
 * 取消所有订阅并断开连接
 */
export function disconnectPusher(): void {
  if (pusherClientInstance) {
    console.log('[Pusher] 断开连接')
    pusherClientInstance.disconnect()
    pusherClientInstance = null
    // 清理所有订阅记录
    subscribedChannels.clear()
  }
}

/**
 * 重新连接 Pusher
 */
export function reconnectPusher(): PusherClient {
  disconnectPusher()
  return getPusherClient()
}

