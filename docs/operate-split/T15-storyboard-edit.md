# T15 分镜编辑族 → hooks/

- status: todo | batch: 五(状态管线) | blocked-by: 无

## 职责
分镜编辑全链(立项日快照 ~730 行):
- 编辑态 state 族(`isEditingStoryboard`/`editedStoryboardData`/`storyboardEditMode` 等,661–679 段相关项)。
- 编辑生命周期(3215–3655):handleStartEditStoryboard / handleShowSaveEditStoryboardDialog / handleConfirmSaveEditedStoryboard / handleCancelEditStoryboard。
- 换图两入口(3905–4082):handleStoryboardImageUpload / handleStoryboardImagePaste。

## 抽离目标
`hooks/use-storyboard-edit.ts`(编辑态 states 随迁 hook 自持)。**hook 返回解构沿用原名——结果展示区 JSX(T18 之前的 5439–6145 段)零改动**。`handleConfirmSaveEditedStoryboard` 调用 `regenerateCorrespondingSceneVideo`(T14)走 deps 注入。搬移按逐字切片+diff 证明;T2 的 seedance-media 校验、storyboard-restore 纯函数(历史事故固化)不得顺手动。

## 验收
- 票内真实链路点检:进入编辑→改文→保存→联动场景视频再生(拦截在贵价段前);换图上传与粘贴两路径。
- `npm run check` 全绿;原段 warning 清 0;批次五完工时统一过全量矩阵。
