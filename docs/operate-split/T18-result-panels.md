# T18 结果展示区 JSX(主角/分镜/场景视频)→ components/operate/

- status: done 2026-09-03 | batch: 五(状态管线) | blocked-by: T14、T15(已满足)

## 实际落地(2026-09-03)

- **盘点修正(按职责落刀)**:票面预设「三文件 character/storyboard/scene-video panel」与实际结构不符——该区是「每个剧情一行三栏」的合并展示(剧情详情/分镜图轮播/场景视频同在一行循环闭包内),按栏拆文件是伪分离(肢解循环局部变量,行为风险>收益)。落地为单一 `components/operate/result-panels.tsx`(792 行)单组件 `ResultPanels`,37 props 同名透传。
- **压力线偏差**:792 行超 ~500 压力线,理由记档(合并行强耦合);军规条款是「想想能不能再拆」而非硬上限,本票评估结论=不可拆。
- **diff 证明**:JSX 流 601/601 行,唯一失配=文档化的 `prev` 参数类型注解(prop 为 any 导致隐式 any,补显式注解,运行期无差)。
- operate.tsx 2,803→2,117 行;新文件 0 warning(文件级 any disable 同前);174 tests 全绿;棘轮 381→**332**。
- **发现**:①下载按钮/轮播状态(setStoryboardCarouselPositions)是票面未列的隐藏依赖,盘点补入;②孤儿绑定浮出水面(code-review 勘误后精确口径):`handleShowRegenerateSingleFrame`/`handleCharacterImageUrl`/`resumeVideoSynthesis`/`handleAutoRegenerateAfterSave` 全库零外部调用点(历史调用方随剧本编辑删除/重构消失),函数体已逐字随迁进 hook 并返回,清理留清理票;**注意 `handleRegenerateScript` 不是孤儿**——它被 handleConfirmRegenerateScript 内部调用(剧情再生链路是活的),勿误删。③props 实数 31 个(初稿笔误 37)。

## 职责
JSX 结果展示区(立项日快照 5439–6145,~707 行,批次五最大展示块):步骤2 主角列表(失败态/重生成按钮/操作按钮)、分镜轮播(first/last 两帧)、场景视频列表(再生入口/预览)。

## 抽离目标
`components/operate/result-panels/` 三文件:`character-panel.tsx` / `storyboard-panel.tsx` / `scene-video-panel.tsx`(各 ~250 行,符合压力线);props 进事件出,事件 handler 用 T14/T15 hook 解构出的原名透传。

## 验收
- 全量矩阵重点对象(批次五收官验收的核心面):轮播切换、失败态展示、再生按钮、编辑表单入口,亮暗×中英×桌面/移动。
- `npm run check` 全绿;原段 warning 清 0。
