# T7 图片生成状态块 → hooks/

- status: todo | batch: 三(状态编排) | blocked-by: T1

## 职责
分镜图/角色图生成的请求编排与进度状态。

## 抽离目标
`hooks/use-image-generation.ts`。

## 验收
- 全量 GUI 回归:图片生成→进度→重绘,全流程正常。
- `npm run check` 全绿,原段 warning 清 0。

## 发现
