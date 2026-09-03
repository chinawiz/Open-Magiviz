# T17 恢复/续跑族 → hooks/

- status: done 2026-09-03 | batch: 五(状态管线) | blocked-by: T16(实际接线顺序:T16 先行,resume 族经前向桥引用 handleSend)

## 实际落地(2026-09-03)

- **按职责落刀拆为两 hook**(票面预留的拆分点):
  - `hooks/use-workflow-resume.ts`(811 行):createProject、resumeWorkflow/resumeSceneVideosGeneration/resumeVideoSynthesis、handlePauseResumeWorkflow、handleAutoRegenerateAfterSave、handleResumeContinueGeneration。
  - `hooks/use-project-restore.ts`(459 行):restoreProjectData、handleResumeContinue、resumeProjectId 监听 effect、恢复后步骤判定 effect;restoreProjectRef 随迁。
- **红线遵守**:storyboard-restore.ts 解析器与「有主角缺图」判据只引用未动;续跑判据逻辑(handleResumeContinue 的五级步骤判定)逐字随迁。
- **按职责修正票面两处**:①`waitForWorkflowResume`/`resumeCheckTimersRef`/`generateVersionGroupId` 是被 T6/T7/T14/T15/T16 五个 hook 共享的等待与 ID 原语,留 operate(迁走会造成循环依赖),非「恢复族私有」;②restoredVersionHasVideo/restoredProjectCompleted state 留 operate(WorkflowHeader T13 组件与续跑族两侧消费)。
- **循环依赖断环**:`resumeSceneVideosGeneration`(T6 需要其作 dep)与 `resumeWorkflow`/`createProject`(T16 需要)采用「前向桥」模式——operate 声明 let 桥变量→T6/T16 接线传转发闭包→resume hook 接线后回填实现;运行期于渲染完成前赋值,行为等价。
- ref 写入按惯用法收敛为注入回调:`setCurrentProjectIdRefValue`/`setVersionGroupIdRefValue`/`setCurrentEditVersionIdRefValue`(react-compiler hook 参数不可变)。
- **diff 证明**:9 函数对 HEAD 逐字——handleAutoRegenerateAfterSave 337/337、handleResumeContinueGeneration 204/204、handlePauseResumeWorkflow 44/44 等全 OK;唯一差异=ref 写入回调化 5 处+`_mergedChars` lint 前缀。
- operate.tsx 3,756→2,803 行;174 tests 全绿;新文件 0 warning(两 effect 的 exhaustive-deps 用 disable 注释保原 dep 数组=保触发时机)。
- **发现**:①暂停流程伸手 pendingTasksRef(T8 发现#2 的兑现点)随迁进 resume hook 依赖,收敢单源留后续深化票;②恢复监听 effect 与恢复判定 effect 的 dep 数组刻意保真,code-review 时勿按「缺依赖」误修;③`_mergedChars`:resumeWorkflow 主角步骤的合并结果在旧代码即未被消费(步骤3 用的是各自闭包内局部),存量死赋值留清理票。

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
