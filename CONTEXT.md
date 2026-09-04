# CONTEXT — MeiHao（Open-Magiviz）领域词汇表

生成/计费链路的共享语言。代码、commit、经验库一律用这些词；新概念先入表再用。

## 任务行（task row）
`ai_generation_tasks` 表的一行。提交生成任务时落库，是供应商 taskId 与本系统业务上下文（user/project/version/scene）的映射，也是扣点的 claim 锚点。13 列语义见 `lib/providers/submit.ts` 的 insert。

## claim（认领扣点）
「谁先原子地把 `pointsDeducted` 从 false 置 true 谁负责扣分」的数据库条件更新模式（`lib/task-points.ts`）。webhook、兜底轮询、补偿任务三方并发结算时的唯一仲裁。见经验库 methods §3。

## settlement（结算）
任务终态对应的积分处置：claim → 按**任务行** `pointsAmount` 扣点（或补扣）→ `markTaskSuccess`/标记失败。当前有三处实现（Kie 三条 webhook、`lib/task-compensate.ts` 补偿、route 兜底轮询），收敛为单一实现是既定后继票。

## taskType
任务行的供应商查询键（如 `generate_story_video_veo`、`wan_2_7_video`），由提交侧写入、`lib/providers` 的 `TASK_PROVIDER` 消费（轮询端点形状映射）。补偿任务对未知 taskType 跳过——新模型必须同步登记。

## provider seam（供应商接缝）
`lib/providers`：提交半边 `submitTask(modelKey, input, meta)`（含落任务行），轮询半边 `pollTask`/`pollTaskUntilVerdict`。供应商端点、请求形状、webhook 环境变量、时长收敛口径全部住在这里；路由与客户端只认 modelKey/taskType。

## 唯一事实源（video-pricing）
`lib/video-pricing.ts`：成本依据 + 单价表 + 底线公式。余额预检、落行 `pointsAmount`、展示文案都从它取值；新增模型先在 `VIDEO_MODEL_UNIT_POINTS` 登记（`submit.test.ts` 的双向一致性测试会拦住只改一边）。计费秒数口径住在 provider seam（`lib/providers/submit.ts` 的 `resolveBillableSeconds`，复用各模型提交用的同一个 `parseDuration`）——「预检与落行同源」由这两处协同保证。

## 降级链（fallback chain）
`getVideoFallbackChain(primary, {hasImage, durationSec})` 给出的提交候选序：主模型失败（供应商报错/校验不符）依序切换。余额预检按链上各候选的最大消耗取上界。

## 自建端点（self-hosted endpoint）
运营在管理后台登记的自部署推理服务（base_url + api_key + model_id + 协议 + 参数）。文本/图像一期走 OpenAI 兼容契约，视频二期走 submit/poll 异步任务契约（决策见 ADR-0001）。配置存 DB、admin API 掩码返回（只露 key 末 4 位），保存即 `invalidateRouteCache()`。

## 生效模型（active model）
某一步当前实际服务的模型来源：云端默认或某个自建端点。运营全局无感切换——用户侧 UI 与计费同价不变；全量切，无灰度百分比。

## 云端回退（cloud fallback）
自建端点调用失败/超时 → 自动改用该步云端默认模型重跑，任务对用户照常成功。回退事件进 trackFunnelEvent，是自建健康度的监控信号。与降级链的区别：降级链是云端模型间的候选序，云端回退是自建→云端的兜底方向。
