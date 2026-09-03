# T10 下载/文件类型/存储用量外围 → hooks/

- status: done 2026-09-03 | batch: 四(展示与外围) | blocked-by: 无

## 实际落地(2026-09-03)

- 新文件 `hooks/use-file-storage.ts`(216 行):handleDownloadFile / handleFileSizeExceeded / fetchStorageInfo / checkStorageAvailable / handleStorageLimitExceeded 函数体逐字搬移;deps 注入 subscriptionPlan + 5 个 setter,i18n(operate)与 toast hook 内自持;hook 装配点置于 downloadingKey 声明之后(TDZ 规避)。
- `getFileType` 纯函数移入 `components/operate/format.ts`(与 formatBytes/computeFileSizeLimit 同域),+2 vitest 用例(format.test.ts 7→9)。
- **diff 证明**:HEAD 锚点提取 vs 新文件,归一后 handleDownloadFile 99/99、handleFileSizeExceeded 13/13、fetchStorageInfo 16/16 零失配;仅 3 处文档化替换(checkStorageAvailable/handleStorageLimitExceeded 的内联类型→`StorageUsageInfo` 别名、getFileType 的 const 箭头→export function)。
- lint 清偿(沿用 T8「行为不变惯用法」先例):进度未接线变量 `_total/_received` 前缀、`new Blob(chunks)` 去 `as any`(类型本可过)、两处 `catch (err)` 未用参数改 optional catch binding。
- operate.tsx 6,336→6,175 行;166 tests 全绿。
- **发现**:`getFileSizeExceededMessage`(operate.tsx)定义后**零调用点=死代码**(与 T8 的 cleanupTaskSubscription 同族),按纪律不搬不删,留待清理票;`handleDownloadFile` 的流式下载读了 `content-length` 与增量 `_received` 但从未向上暴露进度——「显示进度」注释与实际能力不符,属存量未完成特性,修复不在本票。

## 职责
三类外围处理器(立项日快照):
- `handleDownloadFile`(2444–2556,~113 行):R2 下载/命名/下载态 state。
- `getFileType` / `getFileSizeExceededMessage` / `handleFileSizeExceeded`(4083–4124):文件类型判定与超限文案。
- `fetchStorageInfo` / `checkStorageAvailable` / `handleStorageLimitExceeded`(4125–4166):存储用量查询与超限拦截。

## 抽离目标
`hooks/use-file-storage.ts`(下载+存储用量);`getFileType`/`getFileSizeExceededMessage` 是纯函数——**领票时先盘点 T2 的 `components/operate/seedance-media.ts` 是否已有等价判定,重复字面集合一律收敛单源**(methods §17/T1 经验),纯函数补 vitest。

## 验收
- 精简 GUI(亮暗×中英):下载按钮真实触发下载、超限弹窗路径(伪造超限文件)、存储用量条渲染。
- `npm run check` 全绿;原段 warning 清 0;新纯函数带 vitest。
