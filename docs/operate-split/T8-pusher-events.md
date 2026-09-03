# T8 Pusher 实时进度 → hooks/

- status: done 2026-09-03 | batch: 三(状态编排) | blocked-by: 无(T6 声明依赖本票,建议先做本票)

## 职责
Pusher 订阅、事件解析、进度写回 state 的实时通道逻辑(infra-gotchas 有「Pusher 实时推送未达页面」调查史,抽离时保持订阅参数与清理逻辑原样)。

## 抽离目标
`hooks/use-task-events.ts`(自定义 hook)。

## 验收
- 全量 GUI 回归:生成期间进度实时到达、卸载后无泄漏订阅。
- `npm run check` 全绿,原段 warning 清 0。

## 实际落地(2026-09-03)

- 新文件 `hooks/use-task-events.ts`(~150 行,原样搬移):持有 pusherUnsubscribeRef/pendingTasksRef/私有 isMountedRef + 卸载清理 effect + `waitForGenerationResult` + `cleanupTaskSubscription`;返回三者(pendingTasksRef 原样暴露)。
- operate.tsx 保留:resumeCheckTimersRef + 自己的 isMountedRef + 自己的卸载 effect(原混合 effect 拆成两个,各自清理互不相交的资源,行为等价);`/api/projects` 起的 7 个 `waitForGenerationResult` 调用点零改动。
- GUI 回归(本地 dev 3100,真实登录+真实工作流+真实 Pusher 链路):
  - 客户端真实订阅:客户端实例创建→`订阅频道 task-<id>`→`订阅成功` 全链日志在案;
  - 事件到达:用服务端 SDK 向 `task-<taskId>` 发布 `status=success` 事件(本地 webhook 不可达,以注入替代生产 webhook 投递),前端 `收到事件→收到成功事件→任务完成` 全链解析并 resolve,3 个异步分镜任务全部走通;
  - 暂停交互:暂停按钮读 pendingTasksRef 检查到 1 个 pending→等待→放行后 `所有任务完成,继续暂停流程→取消新请求`,剧情视频阶段零提交(成本受控);
  - 卸载清理:SPA 导航离开触发 `组件卸载,清理订阅→取消订阅→disconnectPusher`,回首页无崩溃。
- `npm run check` 全绿(161 tests),warning 棘轮 418→417(原段的 exhaustive-deps ref-in-cleanup 误报在 hook 内用「effect 体内捕获 Map 引用」惯用法消除,行为不变)。

## 发现

1. **本地 dev 缺 `NEXT_PUBLIC_PUSHER_KEY/CLUSTER` 时,Pusher 订阅会静默失效**:`getPusherClient()` throw→`subscribeToTask` 捕获后返回 no-op unsubscribe,页面无任何可见异常,只有 `等待超时` 兜底。这正是线上「Pusher 实时推送未达页面」调查的同族失效模式(线上 6 env 成对齐全故未命中,但任何一侧 env 拼写/注入失误都会复刻)。已在本地 .env.local 补上两个 NEXT_PUBLIC 变量完成验证。**建议后续给 subscribeToTask 的 catch 加 console.error(当前疑似只 warn 或静默),或在初始化失败时 toast 一次**——是否做属独立修复票,不在本票顺手改。
2. **暂停流程直接伸手进 pendingTasksRef**(读 keys、包装 task.resolve 实现「等已发请求完成再暂停」)——本票按纪律原样暴露 ref 保行为;T6 拆暂停/工作流编排时可考虑收敛成 hook API(如 `whenPendingSettled()`),属深化非必改。
3. `cleanupTaskSubscription` 定义后零调用点(死代码),已原样随迁进 hook 并返回;留给后续清理票删除。
4. 原「挂载标记」isMountedRef 一份同时护卫 Pusher 回调与续跑轮询;拆分后 hook/operate 各持一份私有副本,各自只在自家作用域读写,挂载/卸载翻转时序等价。
5. 环境注记(本地 dev 库 schema 漂移,延续 T5 发现#5):本轮依次补了 `video_projects.videoStyle/videoModel/generationMode`、`project_data.version_group_id(注意 snake_case)/migrationStatus/migrationCompletedAt/updatedAt`,并给本地 .env.local 充了测试积分。**本地跑全流程前建议先 `drizzle-kit push` 同步 schema**,别按票直接开跑。
6. generate-character-image 当前对本地配置走同步返回(响应带 `images` 数组,无 requestId),Pusher 等待只在异步任务路径触发——验证 Pusher 必须跑到分镜/视频阶段。
