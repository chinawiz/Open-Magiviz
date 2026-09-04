# operate.tsx 专项拆分计划【已完成 2026-09-04】

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

### 批次五(状态管线)完工 2026-09-03 + 专项收官

T14-T18 五票全部落地,operate.tsx 5,256→**2,117 行**(批次五 −3,139;两批累计 10,037→2,117),warning 棘轮 381→**332**,174 tests 全绿。新增模块:`hooks/{use-regeneration,use-storyboard-edit,use-workflow-pipeline,use-workflow-resume,use-project-restore}.ts`、`components/operate/result-panels.tsx`。每票逐字切片+diff 证明(0-4 处文档化替换)。

**真实链路验证(已执行)**:恢复挂载+判据(缺图主角→回到主角步,库里空 URL 分镜解析为 0=正确)→继续生成→主角再生→分镜再生(Pusher 注入 type 字段后全解析)→场景视频(本地快速失败路径)→完整视频跳过判定→工作流收束;再生弹窗开合、卸载清理(SPA 导航离开回项目列表)通过。**成本控制**:剧情视频真实供应商段未实跑(其实现 diff 证明字节一致,批次三已验过真实链路)。

**完工线复验:<1,500 未达(2,117 行)**。剩余构成:86 个 useState 装配 + 7 个 hook 接线的 deps 列表(~450 行)+ 弹窗/面板 props 透传调用点(~350 行)+ 被注释的历史代码块(151a5c3 产品决策保留,~250 行)+ 存量死代码(getFileSizeExceededMessage/VIDEO_STYLE_MAP/孤儿函数 5 个/死 state 对)。进一步收敛需「多 state 合并入 hook 自持」的深度重构+死代码清理票,超出纯搬移范畴,如实记录待后续立项。专项主体目标达成:operate.tsx 从 9 倍第二大文件降为编排+装配层。

### 方法纪律(承接批次三沉淀,methods §17)

1. **领票先盘点实际残留**:本节行号是立项日快照,会随后续票漂移;按职责落刀,不为凑票面硬拆。
2. **搬移类一律逐字切片+diff 证明**(切前校验大括号平衡),tsc 兜底漏搬依赖;跨组件耦合走**宽 deps 注入**,解构沿用原函数/变量名使调用点与 JSX 零改动;hook 调用点置于最晚声明的依赖之后(TDZ 规避)。
3. **新抽纯逻辑必须带 vitest**;碰过的文件 warning 清 0(军规);新文件 ~500 行压力线。
4. **金钱路径**:T11 积分预估自述「与路由预检同源」,抽离时与 submit seam 双向核对口径(§3b),发现漂移记「发现」节不顺手修。
5. **storyboard-restore.ts 与续跑判据「有主角缺图」是历史事故固化(resume-checkpoint),不得顺手动**;续跑回归必须走真实中断→重载→续跑闭环。
6. GUI 前环境两坑:先 `drizzle-kit push` 对齐本地 schema;.env.local 补 `NEXT_PUBLIC_PUSHER_KEY/CLUSTER`;贵价段用「先暂停挂起、再注入放行」+服务端 Pusher SDK 注入 status 事件控制成本。

## 深度重构立项(2026-09-04,第 6 批·待开工)

目标:从 2,117 行压到完工线 <1,500。方向(按收益排序,预估净 -650 行):
- **T19 死代码终清**:被注释的历史代码块(151a5c3 保留的产品决策记录,现拆分已完成、其语境已消失,~250 行)——需用户点头后删除;遗留 warning 清偿(operate 保留段 e 参数/tWorkflow 等)。
- **T20 state 合并入 hook 自持**:输入区族(message/duration/videoModel/videoStyle/aspectRatio/generationMode/showSettingsPopover 等 ~15 个 state)随 T12 已抽的 create-panel 下沉为 use-create-form;工作流指示器族(workflowStep/workflowLoading/workflowPaused)并入 use-workflow-resume。预计 -300 行。
- **T21 接线收敛**:7 个 hook 的 deps 列表(每处 30-45 行)用共享 deps 对象整体透传(operate 组装一个 `workflowDeps` 对象一次传),预计 -200 行;附带 mapToUiScriptData 双份合一(pipeline 版含首尾帧映射为准)+ characterImages 组装块 ×3 抽共享(清理票遗留,含 vitest)。
风险升序:T19(零风险)→ T21(接线重构,tsc+diff 兜底)→ T20(state 归属变更,需全量矩阵)。

## 清理票完成(2026-09-04)

孤儿函数 3 个(handleAutoRegenerateAfterSave ~194 行/handleShowRegenerateSingleFrame/handleCharacterImageUrl)、storyboard-saved 死事件派发、getFileSizeExceededMessage/VIDEO_STYLE_MAP/isGeneratingScenePlot 死代码——已全部删除;**resumeVideoSynthesis 经核实有内部调用保留**(立项日误判,领票盘点纪律再次生效)。tryParsePossiblyMalformedJson 落为 lib/json-parse.ts 纯模块+4 用例(军规补课)。operate.tsx 死导入清偿后 **0 warning**。178 tests 全绿。

## 批次6 开工(2026-09-04)

**T19 完工**:剧情编辑注释历史块(219 行)+ 空积分 effect(体全注释)删除,operate.tsx 2,117→**1,852 行**(保留段尚余 21 条存量告警:10 any+6 unused+5 react-hooks 规则,属深层行为关联,记档不清偿)。
**T21a 发现·未合并**:characterImages 组装块 3 处谓词口径不一致——pipeline/regeneration 用 `includes(char.id)`、resume 用 `String(char.id)` 强转,共享化前须裁决跨类型匹配口径(潜在行为变更);mapToUiScriptData 双份亦未合一(pipeline 版多首尾帧字段)。**批次6 剩余**:T21a(两处合一,先裁决口径)、T21b(7 处接线收敛为共享 deps 对象透传,约 -200 行)、T20(state 合并入 hook,需全量矩阵)。
**T21b 完工(2026-09-04)**:`workflowDeps` 共享依赖对象(73 项并集,一次装配),7 站接线从 32-51 props 收敛为 `...workflowDeps + 站内特有`(2-10 项),operate.tsx 1,852→**1,693 行**、0 warning。落点= T6 接线块前(其成员均在声明期就绪;resume 站的 handleSend 等后置产物留站内,天然规避循环)。
**T21a 完工(2026-09-04)**:`lib/script-mapper.ts` 落地——`buildUiScriptData`(以 pipeline 完整版为准,含首尾帧字段;regeneration 侧随之获得首尾帧支持)与 `pickSceneCharacterImages`(统一 String 强转口径),pipeline+regeneration 两站接入,+5 vitest。**resume 站排除**:其 payload 形状不同(imageUrl `?? null`、prompt 链少 prompt 段、id 空串兜底),统一即行为变更,按纪律保留原样记档。
**T20 裁决:放弃执行**(2026-09-04 收官确认)——指示器族并入 resume hook 存在 T6/T16 依赖循环(结构性不可行);输入区族下沉仅 -40 行却需全量矩阵验收,收益/风险倒挂。完工线 <1,500 最终落点 1,693 行,差距即该放弃项+保留段存量,专项主体(8 类职责全部出清单体)达成。

## code-review 跟进(批次6 增量 124c6d3..1613882,2026-09-04)

两轴审查抓到 **T21a 完工造假**:regeneration 实际未接入 buildUiScriptData(收尾脚本中止后漏重做),plan「两站接入/0 warning」声明不实——已补完并如实改记(保留段 21 条存量告警不清偿,深层行为关联)。同轮清偿:regeneration 切换后 55 行内联删除、json-parse/script-mapper 失效 disable 修剪、resume 死解构剪除;棘轮 332→**300**(实测下调)。Spec 轴新发现记档:**分镜段 `scriptResult.data.scenes` 直接访问**——若响应仅 output 文本则仍 TypeError,与 handleSend 同型共性遗留,已随 bug 修复解析对齐但分镜段未动,留专项。
