# T14 剧情与分镜再生族 → hooks/

- status: todo | batch: 五(状态管线) | blocked-by: 无(建议 T16 先行:族内 `handleConfirmRegenerateSceneVideo` 会 `await handleSend`,deps 注入可解,先行可避免二次接线)

## 职责
再生确认与执行链(立项日快照 ~790 行):
- 剧情再生族(1695–2048):handleShowRegenerateScriptDialog / handleConfirmRegenerateScript / handleRegenerateScript。
- 分镜/单帧/场景视频再生确认族(2049–2211):三组 show + confirm。
- `regenerateCorrespondingSceneVideo`(3656–3904):分镜图更新后联动再生对应场景视频(~249 行,编辑族与再生族的接缝)。

## 抽离目标
`hooks/use-regeneration.ts`;超 ~500 行压力线则按 剧情再生 / 分镜与场景视频再生 两文件。T3 已抽的 confirm 弹窗壳不动,弹窗 open 态随 hook 自持。搬移按**逐字切片+diff 证明**,跨块耦合走宽 deps 注入(含 T6/T7 hook 的返回绑定,解构沿用原名)。

## 验收
- 票内真实链路点检:剧情再生、单帧再生、场景视频再生三入口各走通一次(贵价段前暂停挂起控成本)。
- `npm run check` 全绿;原段 warning 清 0;批次五完工时统一过全量矩阵。
