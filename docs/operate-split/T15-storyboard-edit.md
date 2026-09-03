# T15 分镜编辑族 → hooks/

- status: done 2026-09-03 | batch: 五(状态管线) | blocked-by: 无

## 实际落地(2026-09-03)

- 新文件 `hooks/use-storyboard-edit.ts`(718 行,由 operate 逐字切片脚本生成):编辑生命周期四函数(含 ~396 行的 handleConfirmSaveEditedStoryboard 大函数)+换图上传/粘贴两入口。**编辑态 6 个 state(isEditingStoryboard/editingStoryboardIndex/editedStoryboardData/storyboardImageFile/storyboardEditMode/isUploadingStoryboardImage)迁入 hook 自持并原样返回**(解构沿用原名,弹窗 props 与调用点零改动);`isRegeneratingStoryboard` 与 T6/T7 hook 共享,按实际职责留调用方(票面「编辑态 states 随迁」按职责修正)。
- deps extends WorkflowGenerationDeps + 10 项专属(generationMode/subscriptionPlan/存储外围三件套/generateStoryboardForScene/T14 的 regenerateCorrespondingSceneVideo/弹窗 setter 等)。
- **diff 证明**:6 函数对 HEAD 全部逐字(309/309、63/63、22/22 等),仅 2 处文档化签名替换(React.ChangeEvent/React.ClipboardEvent → 具名导入)。
- 接线点在 useRegeneration 块之后(依赖其 regenerateCorrespondingSceneVideo + generationMode)。operate.tsx 4,733→4,192 行;174 tests 全绿;新文件 0 warning(文件级 any disable 同 T14 理由)。
- **发现**:①保存流程「上传图片与改 prompt 互斥、两者都无变化不关编辑框」的双守卫(2644-2659)是有意设计,勿当 bug「修」;②`updatedStoryboardsForGenerate[indexToSave] = null as unknown as StoryboardItem`(2856)往数组塞 null 再由下游容忍——脆弱写法但有消费端契约,随迁保留;③window.dispatchEvent('storyboard-saved') 自定义事件仅此一处发出、无监听者(疑似死信令,留清理票核实)。

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
