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
- [ ] T6 故事板生成状态块(含剧本/分镜图详情预览弹窗一并抽离)
- [ ] T7 图片生成状态块(主角详情预览弹窗一并抽离)
- [x] T8 Pusher 实时进度 → hooks/(**done 2026-09-03**:hooks/use-task-events.ts;真实 Pusher 链路验证=订阅→注入事件→解析→resolve→暂停放行→卸载清理全通;发现本地缺 NEXT_PUBLIC_PUSHER_* 时订阅静默失效,关联线上推送未达调查,见 ticket 发现节;棘轮 418→417。剧情视频详情预览弹窗仍随 T6/T7 就近处理)
