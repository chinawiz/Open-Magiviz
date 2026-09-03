# T5 素材库选择状态块 → hooks/

- status: done 2026-09-03 | batch: 三(状态编排) | blocked-by: T1(已完成)

## 职责
素材库选择器(library-selector)相关 state 与选片回调逻辑。

## 抽离目标
`hooks/use-library-selection.ts`(自定义 hook,返回 state + 动作),UI 壳留在 operate 或并入 library-selector。

## 验收
- 全量 GUI 回归:选片→带入生成→重选,全流程正常。
- `npm run check` 全绿,原段 warning 清 0。

## 实际落地(2026-09-03)

- 新文件 `hooks/use-library-selection.ts`(23 行):持有弹窗开关 state + 选片回调(选中 URL 交调用方注入的消费回调后关弹窗);附件状态(imageUrls/addImageUrl)留在 operate——它是上传/链接/素材库三路共用的附件块,不属于选片。
- operate.tsx 5 处接线:死 import 清除、状态块移除、hook 调用挂在 addImageUrl 之后、触发点改 `openLibrary()`、LibraryDialog 改 `open/onOpenChange/onSelect` 三线。
- GUI 回归(本地 dev 3100,真实登录+种子素材):选片→带入(附件条出现、生成按钮解锁)→重选(2 张)→重复选同素材去重(仍 2 张)全过;桌面亮/暗×中英 + 移动视口(弹层+弹窗)渲染截图全过。

## 发现

1. **残留比票面预期极薄**:T3 抽走 LibraryDialog 壳后,T5 在 operate 的实际残留只剩 1 个布尔 state + 1 个触发点 + 1 个 onSelect 回调。教训:前置票会吃掉后票的票面范围,领票时先重新盘点实际残留,按实际形态落刀,不为凑票面硬拆。
2. `LibrarySelectorContent` 在 operate.tsx 是死 import(仅 import 未使用,T3 抽壳时遗留),已随本票清除(warning 棘轮 419→418)。
3. **相邻死代码(未动,记档)**:`operate.tsx` 的 `removeImage`(File 附件删除,~6565 行)定义后零引用,疑似历史重构遗留;不属于本票段落,留给碰到的票顺手清。
4. 相邻观察:library-selector 英文文案「5 (s) total」复数处理生硬(en 文案瑕疵,组件自身 i18n,与本票无关,不顺手修)。
5. 环境注记:本地 dev 库缺 `user_assets` 表(仓库 schema 有、本地库未同步),`/api/library/all` 因此 500;已按 lib/schema.ts 补建表后恢复。后续本地联调素材库/上传前先核对本地库表结构。
