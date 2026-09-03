# T6 故事板生成状态块 → hooks/

- status: todo | batch: 三(状态编排) | blocked-by: T1、T8(依赖实时进度事件)

## 职责
故事板/分镜生成的请求编排、进度状态、恢复逻辑(注意与 components/operate/storyboard-restore.ts 纯函数的衔接——解析已抽,编排未抽)。

## 抽离目标
`hooks/use-storyboard-generation.ts`。

## 验收
- 全量 GUI 回归:生成→中断→断点续跑(storyboard-restore 有专属测试,续跑判据不得回退)。
- `npm run check` 全绿,原段 warning 清 0。

## 发现
