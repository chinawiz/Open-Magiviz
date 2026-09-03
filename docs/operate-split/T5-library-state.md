# T5 素材库选择状态块 → hooks/

- status: todo | batch: 三(状态编排) | blocked-by: T1

## 职责
素材库选择器(library-selector)相关 state 与选片回调逻辑。

## 抽离目标
`hooks/use-library-selection.ts`(自定义 hook,返回 state + 动作),UI 壳留在 operate 或并入 library-selector。

## 验收
- 全量 GUI 回归:选片→带入生成→重选,全流程正常。
- `npm run check` 全绿,原段 warning 清 0。

## 发现
