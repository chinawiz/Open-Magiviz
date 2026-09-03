# T9 弹窗挂载区 → components/operate/

- status: done 2026-09-03 | batch: 四(展示与外围) | blocked-by: 无

## 实际落地(2026-09-03)

- **盘点修正**:挂载区 JSX 实际分居两个层级(素材库/链接/图片预览在内容层 div 内,其余弹窗在根层),单组件无法横跨而不改 DOM 结构——按票面逃生口拆两组;剧情视频详情弹窗原为 ~160 行内联 JSX,与 Character/StoryboardDetailDialog 不同构,顺势抽成独立组件。
- 新文件:
  - `components/operate/operate-dialogs.tsx`(~470 行):`MediaDialogMounts`(15 props)+ `OverlayDialogMounts`(86 props),props 全部与 operate.tsx 绑定同名透传,零自身逻辑;
  - `components/operate/SceneVideoDetailDialog.tsx`(~160 行):JSX 逐字搬移+兄弟组件同构的抽象 prop 名(isEditing/editedData/editingIndex/onClose…),关闭时的编辑态重置副作用留在挂载点。
- operate.tsx 6,657→6,336 行;两调用点由参数名单机械生成。**diff 证明**:对 HEAD 原段做 JSX 流归一后对比,media 54 行 / overlay 154 行(剧情视频区块双侧折叠为组件调用占位)零失配。
- 顺手清偿(operate.tsx 触碰文件纪律):`Select/SelectContent/SelectItem/SelectTrigger/SelectValue`、`Input`、`Textarea`、`Dialog/DialogContent/DialogHeader/DialogTitle/DialogTrigger`、`PricingDialog` 等死导入及图标 `Zap/Clock/Trash2/Film/Play/CheckCircle2/ImageIcon`——改动前即零引用(存量 warning);operate.tsx 134→124 warnings。
- 新文件 0 warning;预览 `<img>` 存量债务按 T7 先例加 `eslint-disable-next-line` 注释。`npm run check` 全绿(164 tests)。GUI 回归归批次四末统一执行。

## 职责
operate.tsx JSX 末段的所有弹窗挂载(立项日快照 ~6242–6657,~416 行):LibraryDialog / LinkInputDialog / PurchaseDialog / FileSizeLimitDialog / StorageLimitDialog / MediaValidationDialog / 各 confirm 弹窗 / 详情预览弹窗 / SignInDialog 等——弹窗组件本体已在 T3/T6/T7 抽出,本票只搬「挂载+props 透传」段。**领票先盘点实际残留**(T3 抽壳后可能已有变化)。

## 抽离目标
`components/operate/operate-dialogs.tsx`(组合挂载组件,全部 props 透传,零自身逻辑);超 ~500 行压力线则按域拆两组(如 purchase/storage 域 + edit/preview 域)两个文件。

## 验收
- 精简 GUI(亮暗×中英):任抽 3 个弹窗真实开合(建议:PurchaseDialog 三态、FileSizeLimitDialog、一个 confirm 弹窗)。
- `npm run check` 全绿;原段 warning 清 0。
- 机械搬移不涉纯逻辑,无需新增 vitest;弹窗组件本体已有的测试不受影响。
