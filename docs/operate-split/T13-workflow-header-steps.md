# T13 工作流指示器+步骤1剧情+步骤5成片 JSX → components/operate/

- status: done 2026-09-03 | batch: 四(展示与外围) | blocked-by: 无

## 实际落地(2026-09-03)

- 新文件 `components/operate/workflow-steps.tsx`(403 行)三个组件:`WorkflowHeader`(步骤指示器+暂停/继续控制按钮+继续生成按钮+生成中提示)、`ScriptStep`(步骤1 剧情卡)、`FinalVideoStep`(步骤5 成片/生成中骨架+错误提示)。JSX 逐字搬移,props 与原绑定同名;i18n 组件内自持(operate + operate.workflow 双命名空间)。
- operate.tsx 5,525→5,256 行;**diff 证明**:指示器段 105/106、步骤1段 75/76(唯一失配=文档化的 `index`→`_index` lint 前缀)、步骤5段 78 行一致+1 行切片边界差——零行为变更。
- 新文件 0 warning(一处存量 `scene: any` 以 disable 注释留痕;期间踩坑:**裸 `//` 注释放 JSX children 会成为文本节点**——react/jsx-no-comment-textnodes 报 error,必须用 `{/* */}` 容器包裹 disable 注释)。
- `npm run check` 全绿 174 tests;棘轮 410→381(全库余量,清偿后手动下调)。
- **发现**:①`resume.continueButton` 的显示条件含 `resumeProjectId && !isGenerating && !workflowPaused && !restoredVersionHasVideo && !restoredProjectCompleted` 五重判断,与批次三续跑判据联动——T17 拆恢复族时此条件随迁;②暂停按钮 onClick 内有调试用 `console.log('暂停按钮被点击')`(存量),随迁保留。

## 职责
JSX 三段低耦合展示(立项日快照):
- 工作流步骤展示区(5220–5348):步骤指示器、工作流控制按钮(暂停/继续)、继续生成按钮(仅恢复项目显示)。
- 步骤1 剧情展示(5349–5438):标题信息、场景列表、操作按钮(再生剧情入口)。
- 步骤5 完整视频展示(6146–6241):成片播放/下载。

## 抽离目标
`components/operate/workflow-header.tsx` + `script-step.tsx` + `final-video-step.tsx`(或按压力线合并裁量);props 进事件出。

## 验收
- 精简 GUI(亮暗×中英):生成中指示器随步骤点亮、剧情卡渲染与再生入口可点、成片区播放/下载。
- `npm run check` 全绿;原段 warning 清 0。
