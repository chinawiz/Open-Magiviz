# Providers & Costs —— 供应商矩阵、成本模型、安全卫生、POC 纪律

## 平台矩阵与整合终局（2026-08-27 裁决）

- 最终栈 10 家、固定月费 $0：Vercel（Hobby 宿主）+ Neon（free PG）+ Cloudflare（R2 两桶 + DNS）+ Trigger.dev + Resend + Pusher + Stripe + ZenMux + Kie.ai + GitHub Actions。FAL 已移出 active set（账号保留，作 F2 跨供应商视频路由的首选候选，其上有 Wan 2.2/LTX-2 等 pay-per-use 模型）。
- 任何平台上都替换不掉的环节：ZenMux/Kie（AI 能力）、Stripe（支付）、Resend（邮件，等 CF Email GA——私测中，值得关注）、Trigger.dev（ffmpeg 合成）。
- 复活路径（需求变化才启用）：升级 CF Workers Paid → 重跑 `cf-deploy.yml`。此前不必重议。
- 供应商出清要连带 SDK 出清：换掉/弃用供应商时，`package.json` 里的 SDK 是化石高发区——2026-08-28 依赖审计一次性卸下 33 个零引用包（tencentcloud-sdk、cos-nodejs-sdk-v5、openai、ws/postgres、15 个 radix、8 个 shadcn 生态件等，全是历史 POC/模板遗产）。注意区分两件事：**FAL 是"账号保留、SDK 继续用"**（`@fal-ai/client` 仍是 compose 的回退路径），不能看记忆里的"移出 active set"就删 SDK；反过来 SDK 零 import 也不代表供应商决策变了。判据只有一条：全仓精确 import 图谱。

## 免费层硬事实（2026-08-26/27 核实）

- Supabase 免费项目**闲置 7 天自动暂停**——作为唯一平台直接出局。
- CF 没有免费 Postgres：D1 是 SQLite（schema 重写高风险）；PlanetScale 合作 PG 无免费档；Hyperdrive 免费但只能前置外部 PG。
- AWS 自建 $25–50/月 + 运维负担，与 $0 目标冲突；重型推理用户自有 DGX Spark 承接。

## 成本模型（2026-08-26 口径，Kie 后台校准后应刷新）

- 单部典型片 ≈ $0.18–0.23：脚本（ZenMux ~$0.002）+ 3 张图（nano-banana-2 ~$0.005–0.01/张）+ 8s veo3_lite（~$0.02–0.025/s）+ 自托管合成（~$0.001）。**视频生成 ≈85% 总成本——优化只动视频选型，别的省不出水花。**
- 每 video-second 成本 ≈ $0.023–0.029。参照系：Kie credit = $0.005；Google 官方 Veo3.1 Fast $0.10/s（720p）。
- 内部定价（点数包 $0.10/点，订阅摊薄后最差 $0.0756/点；2026-08-28 按「利润率 ≥100%」规则重订）：veo31Lite 1.5cr/s、veo31Fast 2cr/s、veo31Quality **9cr/s**（官方 $2/条 = $0.25/s，3cr/s 旧价在失败损耗下为负毛利，已按底线公式从 3 提到 9）、seedance25 9cr/s、seedance2 3.5cr/s、kling3/happyHorse/geminiOmni/minimaxH3 2.5cr/s、wan27/seedance2Fast 2cr/s、seedance2Mini 1.5cr/s；图片（nano-banana-2）1.5 分/张按次取整（单张 2 分、首尾帧两张 3 分）；剧本 1 分。
- 底线公式（已代码化）：`unit ≥ ceil0.5( cost × 3.5 ÷ 0.10 )`，3.5 = 失败损耗 1.7 × 目标利润 2 × 支付缓冲 1.04。成本依据与单价同置于 `lib/video-pricing.ts`（MODEL_COST_BASIS_USD_PER_SECOND，verified 标注实测/估计），`video-pricing.test.ts` 守卫两表不许只改一边。**定价改动后必须回到本节复算毛利。**
- 尾部风险提示：年费档（$0.0756/点）用户若把全部点数烧在最贵档，毛利会低于 100% 规则（按 Quality 算约 +60%）；极端场景，接受，但若 Kie 实测 Quality 成本低于 $0.25/s 应优先下调其售价。12 个模型中仅 veo31Lite 与图片为账单实测（verified），其余为估计——Kie 账单 xlsx 实测后回填。
- 对账制度（2026-08-28 落地）：账单校准脚本 `scripts/kie_cost_audit.py`（桶表 + 干净 $/s + 底线对照）；线上失败率/毛利看 `/api/admin/pricing-health?days=30`（lib/pricing-health.ts 纯函数，任务表 model 列由迁移 0013 支持，失败损耗 >1.7× 或毛利 <100% 自动 warning）；runbook 见 `DEPLOY-CHECKLIST.md` §8。教训：**成本数据不会自己变准——没有一键工具的对账制度约等于没有制度**；另外媒体上传的强制模型默认档别指向最贵档（曾强制 seedance25 9分/秒，已改 seedance2Fast）。
- 元教训：**上线前做一次单位经济学审计远比事后调价容易**；多档定价中最贵的一档最容易亏（高档用法占比高、价格未随成本等比放大时）。
- 订阅档位级定价的速算口径（2026-08-30 提炼）：按底线公式定价后，**所有模型的含损耗每点成本都收敛在 $0.042–0.048**，因此任意订阅/折扣方案的实际净利率 ≈ `1 − 0.045 ÷ 有效单点售价`，不用逐模型重算；45% 净利率带对应的单点售价下限 ≈ $0.082。订阅重设计方案全文见 `docs/pricing-redesign-2026-08.md`（尚未实施，等 owner 拍板 + Stripe 建价）。

## 供应商怪癖

- ZenMux 免费/余额为 0 的账户请求 `google/gemini-3-flash-preview` 返回 HTTP 402 `reject_no_credit`（防滥用策略：余额须 >0，实际扣费分文而已）。代码已有降级：step1 自动退到本地模板脚本。
- Kie 无余额查询 API，精确对账只能人工读 Dashboard 扣费记录。
- `.env.local` 里 key 带着引号粘贴会导致 401/403——出现过两次的用户习惯性坑，录入 key 时留意 strip 引号。

## 密钥与安全卫生（流程，不是一次性事实）

- 泄露响应三步走：**撤销 → 用真实请求验证死透（期待 401/403）→ 记台账**。已处理：Resend 全权 key 撤销并验证 ✅；CF API token #1 撤销并验证 ✅。仍活跃的轮换候选：CF token #2（现为 GitHub secret）、Neon 密码（用户明确暂缓）、Trigger PAT/SecretKey、Kie/R2 key。
- Token 发放原则：**一事一 token、最小授权、用完即撤**，不复用全能 token（这次的教训：为建域名临时发的全权 Resend key 用完立即撤，是对的）。
- 生产冒烟用专门测试账号 `deploy-smoke@test.local`（points=100 由直插 Neon 创建），绝不用真实邮箱/真实账户。

## POC 纪律

- 动供应商相关路由代码之前，先用 `poc/one-sentence-video.mjs` 打通全链路：`--mock` 模式离线零成本回归编排形状；真跑用最小参数 `--scenes 1 --duration 4`。视频是成本大头，Kie 免费额度只够一次最小真跑——**没有 mock 开关的 POC 很快会变得不敢跑**。
- 最小可行管线只需要 2–3 个平台（脚本 + 视频 + 对象存储）；现已接通 11 个服务端平台才是成品态。扩展平台顺序应由成本/风险决定，不由「看起来完整」驱动。
