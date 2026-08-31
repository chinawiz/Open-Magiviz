# free-for.dev 资源审计（2026-08-31）

对照 [ripienaar/free-for-dev](https://github.com/ripienaar/free-for-dev) 全量清单（当日 README，约 55 个章节），逐类审核本项目（MeiHao，已上线 mhhao.com）可用的免费资源。

**审计口径**：平台整合终局已裁决（见 `providers-and-costs.md`）——最终栈 10 家、固定月费 $0，替换不掉的环节不重议。因此本审计只回答三个问题：①清单里有哪些**已经在用**的；②哪些能**填补当前真实空白/痛点**；③其余一律归入观察名单或明确不采用。免费层配额以清单当日记载为准，采用前需现场核实。

---

## A. 已在用（清单同样收录，维持现状）

| 服务 | 清单记载数免费层 | 本项目用法 |
|---|---|---|
| Vercel | Hobby 宿主 | 主站托管 |
| Neon | 0.5GB/项目、100 项目、10 分支 | 生产 Postgres |
| Cloudflare | R2 + DNS | 两个 R2 桶 + 域名 |
| Trigger.dev | 免费层 | ffmpeg 合成任务（经 GH Actions 部署） |
| Resend | 3,000 封/月、100 封/天、1 自定义域 | 交易邮件发送 |
| GitHub | 公共仓库 Actions/Dependabot/CodeQL 免费 | CI、Trigger 部署 |
| OpenRouter | 含 free 模型 | 已知可用（未进 active set） |

Pusher、Stripe、ZenMux、Kie.ai 不在清单内或无免费层争议，不赘述。

## B. 建议采用（对准现有空白与痛点，全部 $0、不动现有栈）

### B1. 可观测性三件套（当前最大空白——已上线收钱的产品，没有任何监控/错误追踪/日志留存）

- **错误追踪 → [Sentry](https://sentry.io)**：免费 5k 错误/月。支付 webhook、合成任务失败这类静默故障现在只能靠用户报障发现。若嫌注册门槛，[GlitchTip](https://glitchtip.com)（1k 事件/月，兼容 Sentry SDK，可自托管无限）或 [honeybadger](https://honeybadger.io)（1.2 万错误/月，小团队免费）是备选。
- **在线监控 + 状态页 → [Better Stack](https://betterstack.com/better-uptime)**：10 个监控、3 分钟间隔、含免费状态页。覆盖 `mhhao.com` 首页、关键 API、支付回调端点。[UptimeRobot](https://uptimerobot.com)（50 个监控、5 分钟间隔）是备选。
- **定时任务心跳 → [healthchecks.io](https://healthchecks.io)**：免费 20 个 check。GH Actions 里的 cron（newsletter/compensation 等）和 Trigger 定时任务一旦静默停跑，现在无从得知——这正是它的用途。[cronitor](https://cronitor.io)（5 个监控）备选。
- **日志留存 → [Axiom](https://axiom.co)**：免费 0.5TB、30 天保留，官方 Vercel 集成。Vercel Hobby 的日志只留 1 小时，线上排障基本靠盲猜，这是性价比最高的一笔补强。

### B2. 产品分析 + 会话回放（定价改版刚上线，转化漏斗无数据）

- **[PostHog](https://posthog.com)**：免费 100 万事件/月，漏斗/留存/Feature Flag/Survey 全家桶。最适合回答「访客→点数→支付」漏斗哪一步在漏人。
- **[Microsoft Clarity](https://clarity.microsoft.com)**：会话录制**无流量上限、无采样、免费**。排查过支付死循环、hover-only 这类交互问题的话，回放比猜快得多。两者可并存：PostHog 看数，Clarity 看行为。

### B3. 邮件链路诊断（当前痛点：support@mhhao.com 收不到信，CF Routing 活动日志为空）

零注册、今天就能用的诊断工具：
- **[mail-tester.com](https://mail-tester.com)**（20 次/月）/ **[SendBridge Mail Tester](https://sendbridge.com/mail-tester)**（无限）/ **[dkimvalidator](https://dkimvalidator.com)**：给 mhhao.com 打分，验证 SPF/DKIM/DMARC/RBL，判断「收不到」是出站配置问题还是入站路由问题。
- **DMARC 监控 → [Suped](https://suped.com)**（1 域免费）或 [Canny Pigeons](https://cannypigeons.com)（首域免费）：CF Routing 日志为空时，DMARC 报告能侧面证明信到底有没有进系统。
- **入站转发备援 → [ImprovMX](https://improvmx.com) / [forwardemail.net](https://forwardemail.net)**：免费自定义域转发。若最终定位是 CF Routing 本身的问题，这是不改邮件供应商就能换入站路径的方案。
- **邮件→Webhook → [Conduit](https://conduit.email)**（完全免费）：把 support@ 来信转成 webhook 打进 API/工单，绕开收件箱依赖。

### B4. 面向中国用户的可达性检查

- **[OntarioNet CN Test](https://cntest.ontarionet.ca)**：免费检测域名是否被 GFW 污染/阻断（对比中美 DNS）。MeiHao 目标用户以中文为主，mhhao.com 挂在 Vercel + CF 上，这件事值得一次性查清，而不是等用户来报。

### B5. AI 侧的零成本备援（不换供应商，只加兜底）

- **脚本生成第二降级**：ZenMux 余额为 0 时 402，现在降级直落本地模板。清单里的免费 LLM——OpenRouter free 模型、Google AI Studio（Gemini Flash 免费 20 请求/天）——可作为模板之前的第二级降级，成本为零。
- **开发/POC 用图 → [Lumenfall](https://lumenfall.ai)**（注册用户 FLUX.1 schnell 免费无限）或 **[Pollinations.AI](https://pollinations.ai)**（无 key 免费 API）：开发调试、占位图走这两家，不再烧 nano-banana 的真金。**只进开发链路，不进生产定价链**（质量与 nano-banana-2 不同档，别混用）。
- **LLM 可观测（可选）→ [Langfuse](https://langfuse.com)**：免费 5 万观测/月，开源。若后续 prompt 调优需求变重再上，当前规模可缓。

## C. 观察名单（条件触发才启用）

| 资源 | 免费层 | 触发条件 |
|---|---|---|
| [Upstash Redis](https://upstash.com) | 50 万命令/月、256MB | 需要限流/缓存层时（防滥用四层若要加速率限制） |
| [exchangerate-api](https://exchangerate-api.com) | 1,500 请求/月 | 定价页需实时 CNY 展示时 |
| [Borgbase](https://borgbase.com) | 10GB 异地备份 | Neon 关键表需要独立异地备份时 |
| [Crowdin](https://crowdin.com) / [Localazy](https://localazy.com) | 开源免费 | i18n 扩第三种语言、键量失控时（repo 是公开仓库，资格符合） |
| [Snyk](https://snyk.io) 等 | 免费层 | 依赖安全扫描（CodeQL 公共仓库已免费，重叠） |
| [cloudinary](https://cloudinary.com)/[imagekit](https://imagekit.io) 图床 CDN | 各有免费层 | R2 之外需要图片变换 CDN 时（当前无痛点） |
| CF 邮件（等 GA） | — | playbook 已记：Resend 的长期替换候选 |

## D. 明确不采用（避免反复重议）

- **换宿主/换库类**：Netlify/Fly/Render、Supabase（闲置 7 天暂停已否决）、Turso/Mongo Atlas/Cockroach 等一切 DB 替代——平台终局已裁决，Neon + Vercel 不动。
- **大云免费层**（AWS/GCP/Azure）：与 $0 固定费 + 零运维目标冲突，`providers-and-costs.md` 已裁决。
- **支付周边**：RevenueCat/Adapty（移动 IAP，无移动端）、VAT 类（不卖欧盟 B2B）、加密货币行情类——支付已定 Stripe + Creem。
- **Newsletter/营销邮件**（Substack/Buttondown/MailerLite/EmailOctopus）：当前无此场景。
- **移动端/Flutter/远程桌面/CMS/低代码**：不适用。

## 风险与纪律

1. **配额时效**：free-for-dev 靠社区 PR 维护，条目配额可能过期，采用前必须到官网核实（本清单为 2026-08-31 快照）。
2. **不为免费加供应商**：每新增一家都要过 playbook 那道「替换不掉吗」的审查。B 类推荐的共同点是**填补空白而非替换现有**——监控/分析/日志目前是零供应商领域，不违反整合终局。
3. **免费层的数据边界**：Sentry/PostHog/Clarity 会经手用户行为数据，注意别把敏感字段（邮箱、支付 ID）打进面包屑或 session 录制里。

## 建议的最小落地顺序（全部零成本，无代码依赖变更）

1. 当天可做：mail-tester 诊断 support@ 链路 + OntarioNet CN Test 查墙。
2. 第一批接入：Sentry → Better Stack（首页/支付回调）→ healthchecks.io（挂到 GH Actions cron）。
3. 第二批：Axiom（Vercel 日志引流）→ PostHog + Clarity（转化漏斗 + 回放）。
4. 代码侧改动仅在 B5-1（脚本降级链加一级免费 LLM），走 `poc/one-sentence-video.mjs` 的 mock 流程先回归。
