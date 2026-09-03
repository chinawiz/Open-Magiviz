# T17 恢复/续跑族 → hooks/

- status: todo | batch: 五(状态管线) | blocked-by: T16(建议先行:resume 族多处 `await handleSend`,T16 落地后接线一次到位)

## 职责
断点恢复与续跑全族(立项日快照 ~1,490 行,批次五最大一票):
- `createProject`(630)/`handleResumeContinue`(472)。
- 恢复三函数(2212–2382):resumeWorkflow / resumeSceneVideosGeneration / resumeVideoSynthesis。
- `handlePauseResumeWorkflow`(2383–2443):暂停挂起(等 pending 任务)与恢复。
- `handleAutoRegenerateAfterSave`(2557–2752)/ `handleResumeContinueGeneration`(2753–3214,~460 行)。
- 恢复挂载 useEffect(约 4452 起)与 restore refs(currentProjectIdRef / versionGroupIdRef / resumeCheckTimersRef 等)——**领票时重新盘点**,部分恢复逻辑可能与 T8 use-task-events 已有交叠。

## 抽离目标
`hooks/use-workflow-resume.ts`;盘点后超 ~500 行压力线则按 恢复挂载(use-project-restore)与 续跑编排(use-workflow-resume)两 hook 拆。

## 风险红线
- **storyboard-restore.ts 解析器与续跑判据「有主角缺图」是 2026-09-02 线上事故的固化修复(resume-checkpoint-bugs),只引用不顺手动**;未来改分镜存储形状必须同步改解析器——本票不是那个时机。
- 续跑回归必须走真实中断→重载→续跑→完成闭环(d971e5f 修复的回归场景),暂停挂起拦截贵价段控成本。

## 验收
- 票内真实链路点检:中断→重载→恢复判据正确→续跑闭环;暂停→恢复;无重复扣积分。
- `npm run check` 全绿;原段 warning 清 0;批次五完工时统一过全量矩阵。
