# T16 handleSend 工作流管线 → hooks/

- status: done 2026-09-03 | batch: 五(状态管线) | blocked-by: 无

## 实际落地(2026-09-03)

- 新文件 `hooks/use-workflow-pipeline.ts`(624 行):handleSend 完整管线(登录/媒体约束前置校验→剧情→主角→分镜图→剧情视频→完整视频,积分不足中断→购买弹窗)+ 容错 JSON 解析工具 `tryParsePossiblyMalformedJson` 随迁(全库唯一调用方即 handleSend)。deps extends WorkflowGenerationDeps + 管线专属;`resumeWorkflow`/`createProject`(时属 T17 现成员)经 deps 注入,接线一次到位。
- session status 由 hook 内自持(useSession);ref 写入按 T14 同款惯用法收敛为注入 `setCurrentEditVersionId` 回调。
- **diff 证明**:handleSend 315/315 行,唯一失配=文档化 setter 替换;tryParse 53/53 零失配。
- 接线点在 useStoryboardEdit 块之后(此时 resumeWorkflow/createProject/videoModel 等全部已声明,TDZ 安全);resumeWorkflow 内 `await handleSend()` 为前向闭包引用(运行期安全,既有先例)。operate.tsx 4,192→3,756 行;174 tests 全绿;新文件 0 warning(文件级 any disable 同 T14/T15)。
- **发现**:①步骤2/3/4/5 均有「已有数据则跳过」守卫(characterData/storyboardImages/sceneVideos/videoData 非空跳步)——这是「从积分不足中断处继续」与 resumeWorkflow 复用的关键契约,T17 拆恢复族时依赖它;②步骤5 composeSceneVideosWithFAL 传的是 `scriptResult.data`(API 原始数据)而非 scriptData state——与 T14 再生族传 state 不同,系两处历史口径差异,随迁保留待后续统一评估。

## 职责
`handleSend` 全体(立项日快照 1265–1694,~430 行):send 触发的串行编排层——登录/媒体约束前置校验 → 步骤1 剧情生成 → 步骤2 主角(随剧本返回处理)→ 步骤3 分镜图 → 步骤4 剧情视频,含积分不足中断→PurchaseDialog 接线与 `consolePrefix: '[handleSend]'` 诊断日志。

## 抽离目标
`hooks/use-workflow-pipeline.ts`。**领票先盘点与 T6 `use-storyboard-generation` / T7 `use-character-generation` 的接缝**:两 hook 已持有各步生成实现,本票抽的是「send 触发的串行编排与中断处理层」,不重复搬生成实现;接缝函数走 deps 注入。宽 deps 注入 + 逐字切片 + diff 证明,TDZ 规避(hook 调用点置于最晚声明依赖之后)。

## 验收
- 票内真实链路点检:创建→完整生成到暂停点;积分不足分支用测试号控余额复现(不真跑购买)。
- 成本控制:剧情视频贵价段前「先暂停挂起、再注入放行」(methods §17)。
- `npm run check` 全绿;原段 warning 清 0;批次五完工时统一过全量矩阵。
