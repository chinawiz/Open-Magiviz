# T1 视频模型注册表 → lib/providers

- status: **done(2026-09-03)** | batch: 一(纯数据) | blocked-by: 无

## 职责
operate.tsx 内联的 7 个视频模型的元数据与分辨率档位表(模型名、label、时长档、宽高比、supportedResolutions、单位积分展示)。

## 抽离目标
`lib/providers/video-models.ts`(纯数据+类型,零 React 依赖)。

## 验收
- 与 `lib/providers/submit.ts` 的 VIDEO_SUBMITTERS、`lib/video-pricing.ts` 的 VIDEO_MODEL_UNIT_POINTS 做双向一致性测试(照 submit.test.ts 的同源守卫惯例)——模型集合三方一致。
- operate.tsx 改为 import,行为零变化;该段原 warning 清 0。
- `npm run check` 全绿。

## 交付记录(2026-09-03)
- `lib/providers/video-models.ts`:分辨率镜像表(7 模型)、i18n 映射(12 模型)、选项顺序表(13 项含 auto)、素材兼容集、首尾帧排除集、auto 估价回落模型。
- `lib/providers/video-models.test.ts`:4 用例守卫——三方同集、分辨率表与 submit `supportedResolutions`(≥2 档子集)逐值相等、子集约束、auto 回落存在性。
- operate.tsx:10,037 → 10,009 行;3 处重复的素材兼容模型集收敛为 `MEDIA_COMPATIBLE_VIDEO_MODELS`;JSX 选项字面量改由 `VIDEO_MODEL_OPTION_ORDER` 驱动。
- 验收实测:check 全绿(0 error);占位 env build 成功;154 tests 全过;全库 warning 430→419,棘轮已同步下调。

## 发现
- 原 2275 行附近注释写「强制只能使用 seedance2/seedance2Fast/seedance2Mini(3 个)」,实际代码放行 4 个(含 seedance25)——注释与代码漂移,系 seedance25 后补时未同步注释;注释随本次抽离消失,以 `MEDIA_COMPATIBLE_VIDEO_MODELS` 为准。
- 素材兼容集曾在 3 处字面重复(2277 提交前校验、6736 useEffect 自动切换、7270 allowed() 过滤)——任何一处单独改动都会造成三处口径漂移,现已单源。
- 客户端分辨率表与 submit 注册表是「≥2 档子集」的精确镜像关系(veo 系基线 720p、geminiOmni/minimaxH3 固定档,故不入 UI 表)——此关系已固化为测试,后续增删模型测试会强制两端同步。
