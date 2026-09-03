# T12 创作输入区 JSX → components/operate/

- status: done 2026-09-03 | batch: 四(展示与外围) | blocked-by: 无

## 实际落地(2026-09-03)

- 新文件 `components/operate/create-panel.tsx`(508 行)+ `components/operate/create-settings.tsx`(281 行):创作输入区 551 行 JSX 逐字搬移;超 ~500 压力线后按票面把参数设置面板再拆为 CreateSettingsPanel(嵌在原位渲染,props 与原绑定同名)。
- 随迁:MAX_CHARACTERS(模块常量,operate 侧 isNearLimit 派生一并迁入组件)、videoStyleMap(组件级映射);characterCount/isNearLimit 改为组件内由 message 派生。
- **diff 证明**(三段对齐):前段 261/261、设置面板段 181/181(7 处失配全部是文档化的 `as any` 强转移除——用类型化 t 别名实现,运行期同一函数)、按钮组段 36/37 零失配;另加 2 处 `<img>` 存量债务 disable 注释(T7/T9 先例)。
- operate.tsx 6,037→5,525 行;搬走段带走其自带告警+死导入清偿(Select 族/Popover 族/Progress/9 个图标/formatBytes/getFileType/videoModelMap/getVideoDuration);174 tests 全绿;全库棘轮余量 410→381(已下调 lint script)。【勘误:本票初稿曾记「operate.tsx warning 清至 0」,实为误读单文件瞬时输出——保留段存量告警仍在,全库口径以棘轮数为准】
- **发现**:①`VIDEO_STYLE_MAP` 模块级常量定义后零引用(与组件级 `videoStyleMap` 重复且从未被使用)——死代码,与 getFileSizeExceededMessage 同留清理票;②积分显示两段被注释的「测试阶段暂时注释」JSX 随迁保留(产品决策记录,不删);③CharacterDetailDialog/StoryboardDetailDialog/confirm-dialogs 存在 4 个存量 warning(T6/T7 遗留),非本票范围。

## 职责
JSX 创作输入区(立项日快照 4663–5219,~557 行):上传缩略图四态(上传中/远端/视频/音频)、输入框、冷启动示例、上传按钮、存储空间用量、参数设置面板(视频模型/分辨率/生成模式/画面比例/时长/风格/当前选择)、右侧按钮组、生成按钮(含积分预估展示)。

## 抽离目标
`components/operate/create-panel.tsx`(props 进事件出);参数设置面板体量大,拆 `create-settings.ts` 子组件(两文件各自压 ~500 行压力线内)。

## 验收
- 精简 GUI(亮暗×中英×桌面/移动):输入区全要素点检(缩略图四态、参数面板每控件、冷启动示例一键填充、生成按钮可用态)。
- `npm run check` 全绿;原段 warning 清 0。
