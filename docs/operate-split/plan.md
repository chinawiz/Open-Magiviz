# operate.tsx 专项拆分计划

> 立项:2026-09-03 可维护性共识(grilling 会话,QUALITY-CHECKLIST「进行中的专项」条目)。
> 载体:本目录 plan.md + 逐块 ticket(T*.md),跨 session 恢复时先读本文件,再领一张 ticket 干活。

## 现状(2026-09-03 实测)

- `components/operate.tsx`:**10,037 行 / 82 个 useState / 9 个 useEffect**,全库第二大文件的 9 倍。
- 至少 8 类职责混居:故事板生成、图片生成、多模型视频生成(7 模型分辨率表内联)、音频/上传校验、素材库选择、积分/计费/订阅展示、登录弹窗、Pusher 实时进度。
- 已有抽离先例(风险最低的路径已被验证):`components/operate/` 下 4 个 Dialog + format/storyboard-restore/video 三个带测试纯模块。

## 完工线

**operate.tsx < 1,500 行,只负责编排(useState 装配 + 事件分发)与页面布局**;每块职责一个模块,纯逻辑必须带 vitest。

## 三批验收(回归策略,经验库铁律的批量化)

| 批次 | 内容 | 验收 |
|---|---|---|
| 一·纯数据/纯函数 | T1 T2 | vitest 全绿 + build(不碰 UI,无需 GUI 回归) |
| 二·展示组件 | T3 T4 | 精简 GUI:操作页亮暗×中英核心流 |
| 三·状态编排 | T5 T6 T7 T8 | **全量 GUI 回归矩阵**:亮暗×中英×桌面/移动,从创建到生成全流程 |

每张 ticket 额外执行童子军军规:抽离后 operate.tsx 中该段代码的 lint warning 清到 0;新抽纯逻辑必须带 vitest;新文件 ~500 行压力线。

## 顺序与阻塞

风险升序:纯数据 → 展示 → 状态。T1/T2 无阻塞;T3/T4 已完成(2026-09-03);T6/T7 执行时吸收对应详情预览弹窗;T5-T8 依赖 T1(状态块要引用新注册表)且 T6/T8 有相互依赖(见各自 ticket 的 blocked-by)。**钱权安全网已就位**:points/points-manager/webhook-security/payments 四模块单测已补(2026-09-03,150 tests)。

## 给执行 AI 的纪律

1. 一次只领一张 ticket;开拆前读 QUALITY-CHECKLIST.md 与本文件。
2. 只移动代码不改行为——发现疑似 bug 记进该 ticket 的「发现」节,不在拆分 ticket 里顺手修。
3. 每张 ticket 完成后:`npm run check` 全绿 + 对应批次回归,更新 ticket 状态与 plan 本节的进度行。

## 进度

- [x] T1 视频模型注册表 → lib/providers(**done 2026-09-03**:operate.tsx 10,037→10,009 行,warning 棘轮 430→419,154 tests)
- [x] T2 音频/上传校验 → components/operate/(**done 2026-09-03**:seedance-media.ts+7 用例,operate.tsx →9,908 行,161 tests)。**批次一(纯数据/纯函数)完工**,验收=vitest+build 全绿,无需 GUI 回归。
- [x] T3 剩余 Dialog → components/operate/(**done 2026-09-03**:LibraryDialog+六确认弹窗;4 个详情预览/编辑大弹窗**并入 T5-T8 状态块**——与编辑状态深耦合,避免重复搬移)
- [x] T4 积分/计费/订阅展示段(**done 2026-09-03**:实际形态为 PurchaseDialog 三态购买弹窗;发现并移除不可达的 showPricingInline 死分支)。**批次二(展示组件)完工**:夹具页 GUI 回归 亮暗×中英 30 项断言+3 截图全过,operate.tsx →9,404 行,161 tests。
- [x] T5 素材库选择状态块(**done 2026-09-03**:hooks/use-library-selection.ts 23 行;T3 抽壳后实际残留仅 1 state+1 回调,见 ticket 发现节;GUI 选片→带入→重选→去重全过,operate.tsx →9,401 行,棘轮 419→418)
- [x] T6 故事板生成状态块(**done 2026-09-03**:hooks/use-storyboard-generation.ts 1094 行,4 函数逐字搬移且 diff 证明与原文一致;剧本/分镜图详情弹窗抽至 components/operate/;真实链路 GUI:生成→重载中断→续跑判据→hook 分镜 3/3→自动推进,夹具页三态弹窗截图全过;发现「剧情详情预览」弹窗本身不可达,见 ticket;棘轮 417→415)
- [x] T7 图片生成状态块(**done 2026-09-03**:实际落地为 hooks/use-character-generation.ts 1362 行(主角引擎+重生成+编辑族+换图三入口,逐字切片),分镜图部分已在 T6;CharacterDetailDialog 抽出;真实链路 GUI:主角重生成→同步直返→分镜推进→注入→暂停拦截视频段,夹具页两态截图全过;棘轮 415→414,见 ticket 发现节)
- [x] T8 Pusher 实时进度 → hooks/(**done 2026-09-03**:hooks/use-task-events.ts;真实 Pusher 链路验证=订阅→注入事件→解析→resolve→暂停放行→卸载清理全通;发现本地缺 NEXT_PUBLIC_PUSHER_* 时订阅静默失效,关联线上推送未达调查,见 ticket 发现节;棘轮 418→417。剧情视频详情预览弹窗仍随 T6/T7 就近处理)

## 批次三(状态编排)完工 2026-09-03

T5/T6/T7/T8 四票全部落地,operate.tsx 9,404→6,679 行,warning 棘轮 419→414,161 tests 全绿。批次验收=全量 GUI 回归矩阵,**已执行**(亮暗×中英×桌面/移动×新钩子与弹窗组合点检+从创建到生成全流程 4 轮真实链路:两次完整生成+注入推进、两次中断→续跑闭环、暂停拦截、卸载清理;明细见各 ticket「GUI 回归」节)。验证基建沉淀:本地 Pusher 注入法(服务端 SDK 向 task-<id> 发 status 事件)+真实登录+本地库种子,详见 methods §17 补充。

**专项收尾说明**:完工线「<1500 行」未达成(6,679 行)——T5-T8 覆盖的是状态编排块;剩余主体为 4000+ 行 JSX 布局与 handleSend 内联工作流 stages,超出 T1-T8 票面范围。→ **已立项批次四/五(2026-09-03),见下节 T9–T18。**

---

## 批次四/五立项(2026-09-03,承接 T1-T8 未竟完工线)

用户决策:继续拆到完工线。**完工线不变:operate.tsx < 1,500 行,只负责编排(useState 装配 + 事件分发)与页面布局**。

### 立项日盘点快照(2026-09-03 实测)

operate.tsx **6,657 行 / 76 个 useState / 7 个 useEffect**,棘轮 410,164 tests(151a5c3)。剩余构成:

| 段落(立项日行号) | 行数 | 归属 |
|---|---|---|
| 1265–1694 handleSend 内联管线(步骤1剧情→3分镜图→4视频) | ~430 | 批次五 T16 |
| 1695–2211 剧情/分镜/场景视频再生族 | ~517 | 批次五 T14 |
| 2212–2443 恢复三函数+暂停恢复 | ~231 | 批次五 T17 |
| 2444–2556 下载 + 4083–4166 文件类型/存储用量 | ~297 | 批次四 T10 |
| 2557–3214 自动再生+续跑生成 | ~658 | 批次五 T17 |
| 3215–3904 分镜编辑族+联动场景视频再生 | ~690 | 批次五 T15(+T14) |
| 3905–4311 分镜图上传粘贴+上传清单管理 | ~407 | 批次五 T15 / 批次四 T11 |
| 4316–4339 模型/分辨率/模式 state+积分预估 | ~24 | 批次四 T11 |
| 4663–5219 JSX 创作输入区(上传/输入/参数面板/生成按钮) | ~557 | 批次四 T12 |
| 5220–5348 JSX 工作流指示器 + 5349–5438 步骤1剧情 + 6146–6241 步骤5成片 | ~315 | 批次四 T13 |
| 5439–6145 JSX 结果展示区(主角/分镜轮播/场景视频) | ~707 | 批次五 T18 |
| 6242–6657 JSX 弹窗挂载区 | ~416 | 批次四 T9 |

**预估**:两批落地后 operate.tsx ≈ 1,200–1,450 行,压线达标;若 state 装配+props 透传仍超线,余量用「相关 state 合并入 hook 自持」收敛,不另开票面。

### 两批划分与验收(延续风险升序+批次升压)

| 批次 | 票 | 验收 |
|---|---|---|
| 四·展示与外围 | T9 T10 T11 T12 T13 | 精简 GUI:亮暗×中英×桌面/移动,输入区/各展示段/弹窗开合核心流;新抽纯逻辑带 vitest |
| 五·状态管线 | T14 T15 T16 T17 T18 | **全量 GUI 回归矩阵**+真实链路(完整生成、中断→续跑闭环、暂停拦截贵价段、卸载清理),批次级统一执行;票内做真实链路点检 |

批次五完工即专项收官:复验完工线 <1,500,更新 QUALITY-CHECKLIST「进行中的专项」为已完成。

### 顺序与阻塞

T9–T13 无硬阻塞;T14/T15/T16 无硬阻塞(T14 内 await handleSend 走 deps 注入,建议 T16 先行避免二次接线);**T17 建议在 T16 后**(resume 族多处 await handleSend);**T18 blocked-by T14、T15**(编辑/再生状态入 hook 后 props 面才稳定,否则白接一轮线)。

### 批次四(展示与外围)完工 2026-09-03

T9-T13 五票全部落地,operate.tsx 6,657→**5,256 行**(−1,401),warning 棘轮 410→**381**(清偿后下调),174 tests 全绿(164→174,+10)。新增模块:`components/operate/{operate-dialogs,SceneVideoDetailDialog,create-panel,create-settings,workflow-steps}.tsx`、`hooks/{use-file-storage,use-upload-items}.ts`、`lib/points-estimate.{ts,test.ts}`(+getFileType 入 format.ts)。每票逐字切片+diff 证明;**精简 GUI 回归已执行**:亮暗×中英×桌面/移动 6 组合截图+断言全过,素材库/链接输入弹窗开合抽查通过,模型切换→分辨率回落→预估价 48 积分实时联动验证。批次四验收达成。发现存档:死代码 getFileSizeExceededMessage/VIDEO_STYLE_MAP(待清理票)、T6/T7 遗留兄弟组件 4 warning。剩余:批次五(状态管线 T14-T18)→ 完工线 <1,500。

### 方法纪律(承接批次三沉淀,methods §17)

1. **领票先盘点实际残留**:本节行号是立项日快照,会随后续票漂移;按职责落刀,不为凑票面硬拆。
2. **搬移类一律逐字切片+diff 证明**(切前校验大括号平衡),tsc 兜底漏搬依赖;跨组件耦合走**宽 deps 注入**,解构沿用原函数/变量名使调用点与 JSX 零改动;hook 调用点置于最晚声明的依赖之后(TDZ 规避)。
3. **新抽纯逻辑必须带 vitest**;碰过的文件 warning 清 0(军规);新文件 ~500 行压力线。
4. **金钱路径**:T11 积分预估自述「与路由预检同源」,抽离时与 submit seam 双向核对口径(§3b),发现漂移记「发现」节不顺手修。
5. **storyboard-restore.ts 与续跑判据「有主角缺图」是历史事故固化(resume-checkpoint),不得顺手动**;续跑回归必须走真实中断→重载→续跑闭环。
6. GUI 前环境两坑:先 `drizzle-kit push` 对齐本地 schema;.env.local 补 `NEXT_PUBLIC_PUSHER_KEY/CLUSTER`;贵价段用「先暂停挂起、再注入放行」+服务端 Pusher SDK 注入 status 事件控制成本。
