# Providers & Costs —— 供应商矩阵、成本模型、安全卫生、POC 纪律

## 平台矩阵与整合终局（2026-08-27 裁决）

- 最终栈 10 家、固定月费 $0：Vercel（Hobby 宿主）+ Neon（free PG）+ Cloudflare（R2 两桶 + DNS）+ Trigger.dev + Resend + Pusher + Stripe + ZenMux + Kie.ai + GitHub Actions。FAL 已移出 active set（账号保留，作 F2 跨供应商视频路由的首选候选，其上有 Wan 2.2/LTX-2 等 pay-per-use 模型）。
- 任何平台上都替换不掉的环节：ZenMux/Kie（AI 能力）、Stripe（支付）、Resend（邮件，等 CF Email GA——私测中，值得关注）、Trigger.dev（ffmpeg 合成）。
- 复活路径（需求变化才启用）：升级 CF Workers Paid → 重跑 `cf-deploy.yml`。此前不必重议。

## 免费层硬事实（2026-08-26/27 核实）

- Supabase 免费项目**闲置 7 天自动暂停**——作为唯一平台直接出局。
- CF 没有免费 Postgres：D1 是 SQLite（schema 重写高风险）；PlanetScale 合作 PG 无免费档；Hyperdrive 免费但只能前置外部 PG。
- AWS 自建 $25–50/月 + 运维负担，与 $0 目标冲突；重型推理用户自有 DGX Spark 承接。

## 成本模型（2026-08-26 口径，Kie 后台校准后应刷新）

- 单部典型片 ≈ $0.18–0.23：脚本（ZenMux ~$0.002）+ 3 张图（nano-banana-2 ~$0.005–0.01/张）+ 8s veo3_lite（~$0.02–0.025/s）+ 自托管合成（~$0.001）。**视频生成 ≈85% 总成本——优化只动视频选型，别的省不出水花。**
- 每 video-second 成本 ≈ $0.023–0.029。参照系：Kie credit = $0.005；Google 官方 Veo3.1 Fast $0.10/s（720p）。
- 内部定价（credit = $0.10）毛利：veo31Lite 1cr/s → ~78% ✅；veo31Fast 2cr/s → ~75–81% ✅；**veo31Quality 3cr/s → 仅 ~17% ⚠️ 严重低估**——要么把 `lib/video-pricing.ts` 提到 4–5 cr/s，要么给降级链加成本约束（Lite→Fast 降级意味着成本翻倍）。定价改动后必须回到本节复算毛利。
- 元教训：**上线前做一次单位经济学审计远比事后调价容易**；多档定价中最贵的一档最容易亏（高档用法占比高、价格未随成本等比放大时）。

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
