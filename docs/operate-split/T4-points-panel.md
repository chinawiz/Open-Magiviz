# T4 积分/计费/订阅展示段 → components/operate/

- status: todo | batch: 二(展示) | blocked-by: 无(建议在 T1/T2 后)

## 职责
积分余额、计费预估、订阅状态/档位的展示 JSX 与其局部派生计算。**只抽展示**,扣费动作仍在编排层(钱权动作不随 UI 走)。

## 抽离目标
`components/operate/PointsPanel.tsx`(或按实际形态命名),入参为余额/预估/计划数据。

## 验收
- 精简 GUI 回归:积分展示与预估数值与抽离前一致(与 lib/video-pricing 的档位口径对齐)。
- `npm run check` 全绿,原段 warning 清 0。

## 发现
