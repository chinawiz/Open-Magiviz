/**
 * 读取视频真实时长（秒）。
 *
 * 通过创建临时 <video> 元素加载元数据读取时长；失败时以传入的
 * 错误消息（由调用方负责翻译）reject。60s 超时兜底，避免挂起。
 * 从 operate.tsx 内嵌函数提取，行为与原来一致。
 */
export function getVideoDuration(
  videoUrl: string,
  errorMessages: {
    cannotReadVideoDuration: string
    videoLoadFailed: string
    videoLoadTimeout: string
  }
): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video")
    video.preload = "metadata"
    video.src = videoUrl

    video.onloadedmetadata = () => {
      window.URL.revokeObjectURL(video.src)
      const duration = video.duration // 单位：秒
      if (isNaN(duration) || duration <= 0) {
        reject(new Error(errorMessages.cannotReadVideoDuration))
      } else {
        resolve(duration)
      }
    }

    video.onerror = () => {
      window.URL.revokeObjectURL(video.src)
      reject(new Error(errorMessages.videoLoadFailed))
    }

    // 设置超时，避免长时间等待
    setTimeout(() => {
      if (video.readyState < 1) {
        window.URL.revokeObjectURL(video.src)
        reject(new Error(errorMessages.videoLoadTimeout))
      }
    }, 60000)
  })
}

export interface VideoDurationErrorMessages {
  cannotReadVideoDuration: string
  videoLoadFailed: string
  videoLoadTimeout: string
}

/**
 * 批量读取视频时长（秒）；单个失败时使用 API 返回的时长兜底，
 * 再失败则使用保守默认值 5s，不中断整个工作流。
 * 从 operate.tsx 内嵌函数提取，行为与原来一致。
 */
export async function getAllVideoDurations(
  sceneVideos: { videoUrl?: string | null; duration?: string | number | null }[],
  errorMessages: VideoDurationErrorMessages
): Promise<number[]> {
  const durations = await Promise.all(
    sceneVideos.map(async (sceneVideo) => {
      try {
        // 先尝试读取视频的实际时长
        return await getVideoDuration(sceneVideo.videoUrl ?? "", errorMessages)
      } catch (error) {
        // 获取失败时使用兜底逻辑，这是正常行为不需要报错
        console.warn("[getAllVideoDurations] 视频时长获取失败，使用兜底逻辑:", {
          videoUrl: sceneVideo?.videoUrl,
          fallbackReason: error instanceof Error ? error.message : "未知原因",
        })

        // 读取失败时，使用 API 返回的时长（秒）
        // sceneVideo.duration 可能是毫秒或秒，需要判断
        const apiDuration = sceneVideo?.duration
        if (typeof apiDuration === "number" && apiDuration > 0) {
          // 如果 duration > 100，可能是毫秒，转换为秒
          // 如果 duration <= 100，可能是秒，直接使用
          return apiDuration > 100 ? apiDuration / 1000 : apiDuration
        }

        // 如果 API 也没有返回时长，使用一个保守的默认时长（秒），避免整个工作流报错中断
        const fallbackDuration = 5
        console.log(
          "[getAllVideoDurations] 使用默认时长:",
          fallbackDuration,
          "秒 (视频:",
          sceneVideo?.videoUrl,
          ")"
        )
        return fallbackDuration
      }
    })
  )
  return durations
}
