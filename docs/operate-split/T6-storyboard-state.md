# T6 故事板生成状态块 → hooks/

- status: done 2026-09-03 | batch: 三(状态编排) | blocked-by: T1、T8(均已完成)

## 职责
故事板/分镜生成的请求编排、进度状态、恢复逻辑(注意与 components/operate/storyboard-restore.ts 纯函数的衔接——解析已抽,编排未抽)。

## 抽离目标
`hooks/use-storyboard-generation.ts`。

## 验收
- 全量 GUI 回归:生成→中断→断点续跑(storyboard-restore 有专属测试,续跑判据不得回退)。
- `npm run check` 全绿,原段 warning 清 0。

## 实际落地(2026-09-03)

- 新文件 `hooks/use-storyboard-generation.ts`(1094 行,函数体逐字切片搬移,已 diff 证明与原文件逐字节一致):
  - `generateStoryboardForScene`:单帧分镜图请求引擎(Pusher 等待/积分不足暂停/错误回写),被工作流、单帧重生成、整图重生成、续跑四处共用;
  - `regenerateSingleFrame` / `handleConfirmRegenerateStoryboard`:首尾帧/整图重生成完整流程;
  - `resumeStoryboardGeneration`:断点续跑的分镜图阶段。
- 与 operate 的耦合经 deps 对象注入(约 30 项:共享 refs/当次渲染状态值/setter/工作流回调 waitForWorkflowResume、generateVersionGroupId、generateSceneVideoForScene、composeSceneVideosWithFAL、resumeSceneVideosGeneration、waitForGenerationResult);hook 自持 `useTranslations("operate")` 与 `useToast`。调用点零改动(解构沿用原函数名)。
- **TDZ 规避**:hook 调用点放在最晚声明依赖 `generationMode`(useState)之后;更早定义的闭包(handleSend 等)引用后置解构名,运行期安全。
- 两个详情弹窗一并抽离:`components/operate/ScriptDetailDialog.tsx`(剧情详情,编辑已禁用仅预览)、`components/operate/StoryboardDetailDialog.tsx`(分镜图详情,预览/编辑双态),JSX 逐字搬移+props 注入;夹具页视觉验证(预览态/编辑态/剧本态三截图)全过。
- 状态清理:hook deps 剔除误报的 `videoData`;删 `regenerateSingleFrame` 内死本地变量;`resumeStoryboardGeneration` 未用参数改 `_` 前缀(eslint 新增 `argsIgnorePattern/varsIgnorePattern: "^_"`);引擎内一处 `catch (e)` → `catch`(行为等价,code-review 指出此前漏报,补记)。
- `npm run check` 全绿(161 tests),warning 棘轮 417→415;operate.tsx 9,401→7,972 行。

## GUI 回归(本地 dev 3100,真实登录+真实工作流+真实 Pusher 链路)

- 生成:工作流跑到分镜阶段,异步分镜任务经 hook 引擎订阅(`订阅频道→订阅成功`),注入 success 事件后 `收到事件→收到成功事件→任务完成→Pusher 结果` 全链解析,分镜图入列;
- 中断:分镜阶段中途直接重载页面;
- 断点续跑:我的项目→查看→「继续生成」→恢复解析正确(剧情 3/主角 1 还原,storyboard-restore 契约不回退);判据「有主角缺图」正确命中→先补主角(同步)→进入 hook 的 `resumeStoryboardGeneration`→3 个分镜任务订阅→注入→全部完成→自动推进到剧情视频阶段;续跑重启入口也可从 create 页内「▶ 继续生成」触发,判据一致;
- 弹窗:夹具页渲染三态截图全过(分镜预览/分镜编辑/剧本预览)。

## 发现

1. **「剧情详情预览」弹窗当前不可达**:`setShowScriptPreview(true)` 仅存在于被注释的编辑功能块内(编辑功能整体禁用),该弹窗+`editedScriptData`/`isEditingScript` state 是死 UI。本票原样搬移保留;是否删除属产品决策,留给清理票。
2. **dev 环境噪声警示**:Turbopack HMR/重编译会在工作流运行中触发整页 reload,在途请求变成空响应 → 引擎「未返回有效图片 URL {}」分支(console.error)→ dev overlay 弹窗,极易误判为拆分回归。判定依据:**四个函数体与搬移前逐字节一致**(diff 已存档于提交),同分支在原代码中同样存在。跑长流程 GUI 回归前先确保编译稳定,勿边改码边跑。
3. 分镜「查看」按钮 `disabled={!sb.url || !!sb.error}`——续跑注入的图只进内存不入库(stage 保存时点在注入前),重载后查看按钮回到禁用;属现状行为,非本票引入。
4. 本轮验证成本注记:注入式验证会让真实 Kie 任务在云端照常计费(本地 webhook 不可达,前端不等真实回调);第三分镜提交偶发未完成的原因未深究(页面前后经历多次 HMR 重载,无法归因)。
