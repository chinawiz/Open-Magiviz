# T2 音频/上传校验 → components/operate/

- status: **done(2026-09-03)** | batch: 一(纯函数) | blocked-by: 无

## 职责
音频/上传文件的类型、大小、时长校验逻辑(与 MediaValidationDialog 配套的那部分判定函数)。

## 抽离目标
`components/operate/seedance-media.ts` + `seedance-media.test.ts`(照 format.ts 先例:纯函数,边界值测试)。

## 验收
- 纯函数全部带测试:合法/非法类型、大小边界(恰好等于/超限)、正反两条路径都要测(infra-gotchas #13)。
- `npm run check` 全绿,原段 warning 清 0。

## 交付记录(2026-09-03)
- `components/operate/seedance-media.ts`:`validateSeedanceMedia(items, t)` 原样搬移(~95 行),i18n 的 t 仍以参数注入;`SeedanceMediaItem` 结构类型与 operate.tsx 的 UploadingItem 兼容,调用点(发送前校验)零改动。
- operate.tsx:删除原函数与 5 个随之失效的 media-validation 导入;10,009 → 9,908 行。
- `seedance-media.test.ts`:7 用例——合规正路径、视频/音频数量超限、视频/音频总时长超限、探测失败、单文件超限、探测抛错;probeMediaUrl 作 mock 边界,数量/时长/单文件规则用真实实现。
- 验收实测:check 全绿(0 error,warning 恰好 419 不增);161 tests 全过;占位 env build 成功。

## 发现
- 校验器是**分层顺序契约**:数量上限 → 总时长上限 → 逐文件元数据。测深层规则时夹具必须只违反目标层(首版夹具 30s 单文件同时撞了总时长层、1080×1920 像素超上限,都被更早的层拦截——不是 bug,是顺序本身)。
- seedance-media.ts 里 2 条 `any` warning 系从 operate.tsx 原样搬移的遗留 t 签名契约(净增为零);测试桩已按军规用 `unknown` 写,零新增。
