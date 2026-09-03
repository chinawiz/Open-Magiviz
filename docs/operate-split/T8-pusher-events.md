# T8 Pusher 实时进度 → hooks/

- status: todo | batch: 三(状态编排) | blocked-by: 无(T6 声明依赖本票,建议先做本票)

## 职责
Pusher 订阅、事件解析、进度写回 state 的实时通道逻辑(infra-gotchas 有「Pusher 实时推送未达页面」调查史,抽离时保持订阅参数与清理逻辑原样)。

## 抽离目标
`hooks/use-task-events.ts`(自定义 hook)。

## 验收
- 全量 GUI 回归:生成期间进度实时到达、卸载后无泄漏订阅。
- `npm run check` 全绿,原段 warning 清 0。

## 发现
