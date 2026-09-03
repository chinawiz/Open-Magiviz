# T3 剩余 Dialog → components/operate/

- status: todo | batch: 二(展示) | blocked-by: 无(建议在 T1/T2 后)

## 职责
仍留在 operate.tsx 内的弹窗类 UI(已有 FileSizeLimitDialog/LinkInputDialog/MediaValidationDialog/StorageLimitDialog 四个先例,把同类的剩余者抽完,含登录相关弹窗若未抽)。

## 抽离目标
`components/operate/*.Dialog.tsx`,props 传入数据与回调,不持有业务状态。

## 验收
- 精简 GUI 回归:操作页亮暗×中英,弹窗开合、文案渲染正常。
- `npm run check` 全绿,原段 warning 清 0。

## 发现
