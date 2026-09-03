# T4 积分/计费/订阅展示段 → components/operate/

- status: **done(2026-09-03)** | batch: 二(展示) | blocked-by: 无

## 职责
积分余额、计费预估、订阅状态/档位的展示 JSX 与其局部派生计算。**只抽展示**,扣费动作仍在编排层(钱权动作不随 UI 走)。

## 抽离目标
`components/operate/PointsPanel.tsx`(或按实际形态命名),入参为余额/预估/计划数据。

## 交付记录(2026-09-03)
- 实际形态与预设不同:积分/计费在 operate.tsx 的展示面主要是「积分不足购买弹窗」而非独立面板,抽为 `components/operate/PurchaseDialog.tsx`(124 行)——points/subscription/card_verify 三态标题文案、验卡流程(自包含 fetch+toast+locale,isVerifyingCard state 内聚进子组件)、升级动作经 onUpgrade 交回父级(父级触发页内订阅弹窗 trigger)。
- 积分预估派生计算(pointsCost/estimateSceneVideoPoints)留在编排层——它们被多处 UI 共享,属 T5-T8 状态块范畴。
- operate.tsx 同步删除 isVerifyingCard state、PricingSection/CreditCard 导入。
- GUI 回归与验收与 T3 同批:购买弹窗两态(积分不足/验卡)中英亮暗全过(截图存档);check 全绿,161 tests。

## 发现
- **死代码:showPricingInline 永远为 false**——该 state 无任何 setShowPricingInline(true) 调用点,购买弹窗的「内嵌 PricingSection 分支」(13 行)不可达。已连同 state、PricingSection 导入一并移除(行为零变化)。⚠️ 留给用户决策:若「弹窗内直接展示定价」本是规划中的产品行为(现走的是 pricingDialogTriggerRef 触发的独立订阅弹窗),需要时再补;现行链路不变。
