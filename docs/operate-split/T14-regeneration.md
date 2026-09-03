# T14 剧情与分镜再生族 → hooks/

- status: done 2026-09-03 | batch: 五(状态管线) | blocked-by: 无(实际未依赖 T16 先行:handleConfirmRegenerateSceneVideo 并未调用 handleSend,立项票面判断有误)

## 实际落地(2026-09-03)

- 新文件 `hooks/use-regeneration.ts`(~730 行):剧情再生完整管线(handleRegenerateScript 及 confirm/show 包装)、分镜/单帧/场景视频再生确认族、`regenerateCorrespondingSceneVideo`(编辑族接缝)。deps 接口 extends `WorkflowGenerationDeps`(单源复用)+ 16 项专属依赖;i18n/toast hook 内自持。
- **diff 证明**:8 函数对 HEAD 全部逐字(238/238、103/103、56/56 等,零失配)。文档化替换仅 3 处:`_frameType` 未用参数前缀、文件级 `no-explicit-any` disable(14 处存量 any,理由:逐处改类型将淹没 diff 证明)、`currentEditVersionId.current` 写入改为注入 `setCurrentEditVersionId` 回调(hook 参数不可变,react-compiler 规则;兄弟 hook 只读 dep refs 故无此问题)。
- 接线点置于 showSettingsPopover 声明后(TDZ:最晚依赖 videoStyle 与 T6/T7 hook 生成器之后)。operate.tsx 5,256→4,733 行;174 tests 全绿;新文件 0 warning。
- **发现(疑似存量 bug,未修)**:`handleRegenerateScript` 内 `const parsedScriptData: any = null` 恒为 null,`mapToUiScriptData(null)` 在 `Array.isArray(data.scenes)` 处抛 TypeError→剧情重新生成疑似**从来都是失败路径**(注释自述「兼容 data 对象或 output 文本」但解析从未接上,疑似历史重构残留)。catch 会优雅展示错误,不影响页面其他功能。**修复属产品决策+行为变更,不在拆分票**;真实链路点检时以「错误路径行为保真」验证。

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
