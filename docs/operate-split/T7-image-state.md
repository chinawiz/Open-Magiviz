# T7 图片生成状态块 → hooks/

- status: done 2026-09-03 | batch: 三(状态编排) | blocked-by: T1(已完成)

## 职责
分镜图/角色图生成的请求编排与进度状态。

## 抽离目标
`hooks/use-image-generation.ts`。

## 验收
- 全量 GUI 回归:图片生成→进度→重绘,全流程正常。
- `npm run check` 全绿,原段 warning 清 0。

## 实际落地(2026-09-03)

- 实际形态按职责归属落为两块(命名沿用票内既有职责,非票面文件名):
  - `hooks/use-character-generation.ts`(1362 行,函数体逐字切片搬移):主角图片生成块——`generateCharacterForSingle`(单主角请求引擎,Pusher 等待/积分不足暂停/同步直返双模式)、`mergeCharactersFromResults`、单主角重生成(show+confirm)、编辑族(start/saveEdit/cancelEdit + 保存后联动重生成)、换图三入口(upload/url/paste);
  - 分镜图部分已在 T6 落地为 `hooks/use-storyboard-generation.ts`,本票不重复。
- 与 operate 的耦合经 deps 注入(约 45 项,含 T6 hook 的 `generateStoryboardForScene` 与上传限流的 `checkStorageAvailable/handleStorageLimitExceeded/computeFileSizeLimit` 回调);hook 自持 `useTranslations("operate")` 与 `useToast`。
- `components/operate/CharacterDetailDialog.tsx`:主角详情预览/编辑弹窗 JSX 逐字搬移+props 注入,接线同 T6 模式。
- 状态清理:3 处 unused-vars(catch(e)→catch ×2、未用类型导入);1 处搬移 img 债务定向 disable 并注明。
- `npm run check` 全绿(161 tests),warning 棘轮 415→414;operate.tsx 7,972→6,679 行。

## GUI 回归(本地 dev 3100,真实登录+真实工作流+真实 Pusher 链路)

- 夹具页:主角详情预览态/编辑态(提示词模式指示+禁用名称描述+可编辑生成提示词+取消/保存)三处截图全过;
- 真实链路:主角卡「重新生成」→确认弹窗→hook 的 `generateCharacterForSingle` 发起(日志 `[operate] regenerate character - request (via generateCharacterForSingle)`)→同步直返→流程自动推进分镜阶段→hook 引擎订阅分镜任务→注入 success→「任务完成」→暂停拦截剧情视频段(视频 0 提交,成本受控)。

## 发现

1. 票面文件名 `use-image-generation.ts` 与实际职责(主角+分镜图两类图片生成)不匹配:分镜图已在 T6 落地,主角块按实际形态命名 `use-character-generation.ts`。**领票时以职责为准,不以票面文件名为准**。
2. `handleConfirmRegenerateCharacter`/`handleConfirmSaveEditedCharacter` 保存后会级联重生成受影响分镜图+剧情视频+完整视频(真实 Kie 成本链),GUI 验证时用「先暂停挂起、再注入放行」可在分镜阶段后拦住视频段,控制验证成本。
3. 主角重生成确认弹窗的级联警示文案与实际行为一致(清除主角图→重生成分镜图→剧情视频→完整视频),无虚假宣称。
4. 主角编辑态的换图三入口(upload/url/paste)与分镜图编辑的换图入口(upload/paste)是两套相似但不相同的实现,分别归属两个 hook;后续若有清理票可评估合并。
