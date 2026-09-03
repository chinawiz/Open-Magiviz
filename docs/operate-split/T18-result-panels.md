# T18 结果展示区 JSX(主角/分镜/场景视频)→ components/operate/

- status: todo | batch: 五(状态管线) | blocked-by: T14、T15(编辑/再生状态与处理器入 hook 后,本区读到的绑定名才稳定,避免白接一轮 props)

## 职责
JSX 结果展示区(立项日快照 5439–6145,~707 行,批次五最大展示块):步骤2 主角列表(失败态/重生成按钮/操作按钮)、分镜轮播(first/last 两帧)、场景视频列表(再生入口/预览)。

## 抽离目标
`components/operate/result-panels/` 三文件:`character-panel.tsx` / `storyboard-panel.tsx` / `scene-video-panel.tsx`(各 ~250 行,符合压力线);props 进事件出,事件 handler 用 T14/T15 hook 解构出的原名透传。

## 验收
- 全量矩阵重点对象(批次五收官验收的核心面):轮播切换、失败态展示、再生按钮、编辑表单入口,亮暗×中英×桌面/移动。
- `npm run check` 全绿;原段 warning 清 0。
