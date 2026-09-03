# T16 handleSend 工作流管线 → hooks/

- status: todo | batch: 五(状态管线) | blocked-by: 无

## 职责
`handleSend` 全体(立项日快照 1265–1694,~430 行):send 触发的串行编排层——登录/媒体约束前置校验 → 步骤1 剧情生成 → 步骤2 主角(随剧本返回处理)→ 步骤3 分镜图 → 步骤4 剧情视频,含积分不足中断→PurchaseDialog 接线与 `consolePrefix: '[handleSend]'` 诊断日志。

## 抽离目标
`hooks/use-workflow-pipeline.ts`。**领票先盘点与 T6 `use-storyboard-generation` / T7 `use-character-generation` 的接缝**:两 hook 已持有各步生成实现,本票抽的是「send 触发的串行编排与中断处理层」,不重复搬生成实现;接缝函数走 deps 注入。宽 deps 注入 + 逐字切片 + diff 证明,TDZ 规避(hook 调用点置于最晚声明依赖之后)。

## 验收
- 票内真实链路点检:创建→完整生成到暂停点;积分不足分支用测试号控余额复现(不真跑购买)。
- 成本控制:剧情视频贵价段前「先暂停挂起、再注入放行」(methods §17)。
- `npm run check` 全绿;原段 warning 清 0;批次五完工时统一过全量矩阵。
