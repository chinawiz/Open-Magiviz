# T3 剩余 Dialog → components/operate/

- status: **done(2026-09-03)** | batch: 二(展示) | blocked-by: 无

## 职责
仍留在 operate.tsx 内的弹窗类 UI(已有 FileSizeLimitDialog/LinkInputDialog/MediaValidationDialog/StorageLimitDialog 四个先例,把同类的剩余者抽完,含登录相关弹窗若未抽)。

## 抽离目标
`components/operate/*.Dialog.tsx`,props 传入数据与回调,不持有业务状态。

## 验收
- 精简 GUI 回归:操作页亮暗×中英,弹窗开合、文案渲染正常。
- `npm run check` 全绿,原段 warning 清 0。

## 交付记录(2026-09-03)
- `components/operate/LibraryDialog.tsx`(42 行):素材库选择弹窗,onSelect 交回父级。
- `components/operate/confirm-dialogs.tsx`(539 行):六个「重新生成/保存编辑」确认弹窗(主角×2、分镜图×2、全部剧情、剧情视频×2 中的视频两个),共享 ConfirmButtons;变更判定逻辑逐行等价搬移。
- operate.tsx:9,908 → 9,404 行(与 T4 合计);弹窗 JSX 换成组件调用,state 全部留在父级(归 T5-T8)。
- **精简 GUI 回归通过**:临时夹具页(app/[locale]/zz-dev-dialog-harness,验收后已删)逐个渲染 8 个弹窗——中文亮色 10/10 文案断言过、中文暗色截图 ×2、英文暗色 10/10 断言过、英文亮色截图 ×1;积分值插值、「剧情 N/Scene N」序号、有变更/无变更判定按钮态全部正确。
- `npm run check` 全绿(0 error,warning 419 不增),161 tests。

## 发现
- **4 个「详情预览/编辑」大弹窗(~780 行:剧本/主角/分镜图/剧情视频)本票不做**——它们与 T5-T8 要重构的编辑状态深度耦合,这轮抽了状态块来了还得再动一遍;并入对应状态块 ticket(T6 故事板/T7 图片/剧情视频)执行。计划已同步。
- confirm-dialogs.tsx 539 行,超 ~500 行压力线 8%:六个弹窗是同族+共享 ConfirmButtons,强行拆两半反而碎片化;若 T5-T8 再往里加弹窗,届时按域拆分。
- 原「编辑主角保存确认弹窗」内计算了 `affectedScenes`(扫剧情找提及主角的场景)但渲染从未使用——纯死代码,搬移时删除(行为零变化)。
