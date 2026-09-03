"use client"

import { useCallback, useState } from "react"

/**
 * 素材库选择状态 hook。
 * 从 components/operate.tsx 拆出（拆分 T5），行为与原来一致：
 * 持有素材库弹窗的开关状态与选片回调——选中素材后把 URL 交给调用方注入的
 * 消费回调（附件列表），随后关闭弹窗。本 hook 不持有附件状态本身。
 */
export function useLibrarySelection(onSelectImage: (url: string) => void) {
  const [open, setOpen] = useState(false)

  const openLibrary = useCallback(() => setOpen(true), [])

  const handleSelect = useCallback(
    (url: string) => {
      onSelectImage(url)
      setOpen(false)
    },
    [onSelectImage],
  )

  return { libraryOpen: open, openLibrary, handleSelect, setLibraryOpen: setOpen }
}
