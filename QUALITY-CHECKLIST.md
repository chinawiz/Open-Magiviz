# QUALITY-CHECKLIST — 代码质量检查流程

> 与运维 runbook `DEPLOY-CHECKLIST.md` 呼应:那份管「上线」,这份管「代码合入前」。
> 建立时间:2026-09-03(此前质量防线全靠手动自觉,详见 `.agents/skills/magiviz-playbook/references/methods.md`)。

## 自动化门禁

| 命令 | 内容 |
|---|---|
| `npm run check` | typecheck(`tsc --noEmit`)+ lint(`eslint .`)+ 单测(vitest)一条命令 |
| `npm run build` | next build(隐含全量类型检查 + 路由校验) |
| CI(push main / PR) | `.github/workflows/ci.yml`:check 四件 + build,env 全占位 |

## 五层检查

### 1. 改动中
- 改面向用户文案 → **必须**同步 grep `messages/zh.json` 与 `messages/en.json` 双语对账(tsc/vitest/build 对缺键全盲,lessons:methods §6/§11)。
- 改计费/积分/供应商提交路径 → 保持 `lib/video-pricing.ts`、`lib/providers/submit.ts` 与各自测试的**双向一致性**,不许只改一边(methods §3a/§3b)。
- 调用了带 provider/挂载点的 UI 设施(toast/theme/session)→ 记住「调用 API ≠ UI 生效」,验收走真实流程。

### 2. 提交前
- 跑 `npm run check`,必须全绿。
- 涉及定价/积分 → 加跑 `npx vitest run lib/video-pricing.test.ts`(月度成本对账同款,DEPLOY-CHECKLIST §8)。
- **warning 棘轮**:lint script 带 `--max-warnings 419`(2026-09-03 基准,随 T1 抽离自 430 下调)——新增任何 warning 直接红。清偿后**必须手动把该数字调低到新的实测值**,只降不升。

## 童子军军规(带牙齿,2026-09-03 共识)

每个 feature/修复顺手把碰过的文件带到标准内,可验收条款:
1. **碰过的文件,该文件的 warning 清到 0**(棘轮按文件收紧,不是全库一起还)。
2. **新抽的纯逻辑必须带 vitest**(抽函数不给测试 = 没抽)。
3. 新文件单文件不超过 ~500 行的压力线,超过就想想能不能再拆。
4. 不为达标大改业务逻辑——那是专项拆分的事,不是顺手清的事。

## 进行中的专项:operate.tsx 拆分

单体组件风险升序专项拆分,**完工线:operate.tsx < 1500 行只管编排+布局**。T1-T8(批次一二三)+ T9-T13(批次四·展示与外围)已完工 2026-09-03,operate.tsx 10,037→5,256 行,棘轮 430→381,174 tests;**批次五(状态管线 T14-T18)已领票未开工**,计划与逐块 tickets 见 `docs/operate-split/`;批次五验收=全量 GUI 矩阵,完工即专项收官复验完工线。

### 3. 推送前(较大改动)
- 过一遍 `/code-review`(Standards + Spec 两轴)。实证:它抓到过「计费同源只做一半」的二轮漂移(methods §3b)。

### 4. UI / 文案改动(GUI 回归铁律)
- 静态检查全绿之后,**仍必须**在真实浏览器过:亮暗 × 中英 × 桌面/移动 矩阵(methods §13)。
- 代码审查和类型检查抓不到:颜色对比、文案漏改、toast 不渲染。
- 内嵌浏览器不可交互时,退化路径:curl 完整流程 + psql 对账,浏览器只验渲染。

### 5. 部署前
- 资源的正、反两条路径都真实连通过才算完成(infra-gotchas #13)。
- 按 `DEPLOY-CHECKLIST.md` 冒烟顺序执行,部署后 48h 观察 Sentry / Better Stack / healthchecks.io。

## 已知「全绿盲区」(静态检查抓不到的)

| 盲区 | 守卫 |
|---|---|
| i18n 键缺漏 | 改文案时 grep `messages/*.json`(见 §1) |
| 批量替换数字字面量残留 | 模式化 grep `'^\s*[0-9]+\}'`(methods §12) |
| 金钱路径两边口径漂移 | pricing/submit 双向一致性测试(methods §3b) |
| 颜色对比 / 渲染失效 | GUI 回归矩阵(见 §4) |

## Lint 规则口径(2026-09-03 分诊)

- 拦门禁:error 级全部。
- 降为 warn(存量债,419 条,由 `--max-warnings 419` 棘轮冻结):`@typescript-eslint/no-explicit-any`、`react-hooks/set-state-in-effect`、`react-hooks/immutability`、`react-hooks/purity`、未用变量、`no-img-element` 等。
- 工具版本注意:**ESLint 必须用 9.x**——eslint-plugin-react 7.37 只支持到 eslint ^9.7,装 10 会在 react 规则上崩溃。
- Next 16 已移除 `next lint` 命令,lint script 是 `eslint .`(flat config `eslint.config.mjs`,原生 extends `eslint-config-next/core-web-vitals` + `/typescript`,无需 FlatCompat)。
