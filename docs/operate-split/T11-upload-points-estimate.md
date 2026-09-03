# T11 上传清单与积分预估 → hooks/ + 纯模块

- status: done 2026-09-03 | batch: 四(展示与外围) | blocked-by: 无

## 实际落地(2026-09-03)

- 新文件 `lib/points-estimate.ts`(48 行,纯模块):`estimateSceneVideoPoints`(场景时长缺省/非法回退 8s)与 `estimateWorkflowPoints`(auto→回落模型、时长 auto→24s)公式逐字参数化;口径事实源不变(lib/video-pricing 的 computeVideoPointsFor/getVideoUnitPointsFor + video-models 注册表)。
- 新文件 `lib/points-estimate.test.ts`(8 用例):**金钱路径对拍**(methods §3b)——注册表内全部模型×分辨率与 `computeVideoPointsFor` 逐值相等、未声明分辨率回退 undefined 档与 seam 缺省一致、全模型集(含固定档)有价可查、auto 回落有单价。operate.tsx 侧仅留 4 行薄适配器(原签名不变,pointsCost IIFE 改直接调用)。
- 新文件 `hooks/use-upload-items.ts`(214 行):自持 `uploadingItems` state + handleFileSelect/addImageUrl/removeImageUrl/handleAddLink 逐字搬移;URL 三族(image/video/audio)状态仍留 operate(跨职责共享);存储检查经 deps 注入(T10 hook 实例)。
- **diff 证明**:handleFileSelect 101/101 行,仅 2 处文档化差异(React.ChangeEvent→具名导入、存量未用的 mediaFiles 加 `_` 前缀)。
- operate.tsx 6,175→6,037 行;174 tests 全绿(166+8);新文件 0 warning。
- **发现**:①守卫测试初版假设「AUTO_MODEL_FALLBACK 必须在分辨率注册表内」被红——**真相是设计如此**:VIDEO_MODEL_RESOLUTIONS 只收 ≥2 档可选模型,veo31 系固定档模型本就不入表,auto 预估走「未声明分辨率→undefined 档」路径,与 seam 缺省一致;测试已改写为正确恒等式(全模型集缺省档有价可查)。**教训:给「缺位」写守卫前先确认缺位是否语义内**。②handleFileSelect 中 `mediaFiles` 分类结果零消费(存量死代码,`_` 前缀留痕)。

## 职责
两块(立项日快照):
- 上传清单:`uploadingItems` 族 state 与 `handleFileSelect`(4167–4290)/`addImageUrl`/`removeImageUrl`/`handleAddLink`(4291–4311)。
- 积分预估:`estimateSceneVideoPoints` / `pointsCost`(4316–4339,含模型/分辨率/时长 state 的预估公式)。注释自述**「与路由预检同源:主模型×所选分辨率」——这是金钱路径口径**。

## 抽离目标
- `hooks/use-upload-items.ts`(上传清单管理)。
- 积分预估抽纯模块(建议 `lib/points-estimate.ts`)+ vitest:纯函数吃(模型,分辨率,时长,场景数),吐积分数。抽离时与 `lib/providers/submit.ts` seam 的预检公式**双向核对**(methods §3b:同源必须同到公式的每个因子);发现漂移记「发现」节,不顺手修。有 submit.test.ts 可参照其口径写对拍用例。

## 验收
- 精简 GUI(亮暗×中英):上传→缩略图→删除→链接添加全路径;预估价随模型/分辨率/时长切换实时变化(与价格页口径目测一致)。
- `npm run check` 全绿;原段 warning 清 0;预估纯模块带 vitest(含与 submit 预检的对拍)。
