# Providers & Costs —— 供应商矩阵、成本模型、安全卫生、POC 纪律

## 平台矩阵与整合终局（2026-08-27 裁决）

- 最终栈 10 家、固定月费 $0：Vercel（Hobby 宿主）+ Neon（free PG）+ Cloudflare（R2 两桶 + DNS）+ Trigger.dev + Resend + Pusher + Stripe + ZenMux + Kie.ai + GitHub Actions。FAL 已移出 active set（账号保留，作 F2 跨供应商视频路由的首选候选，其上有 Wan 2.2/LTX-2 等 pay-per-use 模型）。
- 任何平台上都替换不掉的环节：ZenMux/Kie（AI 能力）、Stripe（支付）、Resend（邮件，等 CF Email GA——私测中，值得关注）、Trigger.dev（ffmpeg 合成）。
- **监控三件套（2026-08-31 接入，$0）**：Sentry（错误追踪，无 DSN 时代码 no-op）+ Better Stack（uptime+状态页，指向已有 `/api/healthz`/`/api/readyz`）+ healthchecks.io（Trigger 定时任务心跳，读 `HEALTHCHECKS_PING_URL`）。定位是**填补零供应商空白，不动 10 家终局**；激活步骤在 `DEPLOY-CHECKLIST.md` §9。选型来自 free-for.dev 清单审计（`docs/free-for-dev-audit-2026-08.md`）。同日 DNS 审计发现 mhhao.com 唯一邮件链路缺口是 **DMARC 记录缺失**（SPF/DKIM 均在），待在 CF DNS 补 `_dmarc` TXT。
- **分析与回放（2026-08-31 第二批，$0）**：PostHog（1M 事件/月，转化漏斗+自动采集，同源 `/ingest` 代理防广告拦截器，middleware matcher 已排除 `ingest`）+ MS Clarity（会话回放无上限）。同样 no-op 接线直至 env（`NEXT_PUBLIC_POSTHOG_KEY`/`NEXT_PUBLIC_CLARITY_ID`），见 §10。**Axiom 搁置**：Vercel 日志 drain 集成需 Vercel Pro，违反 $0 底线。
- 复活路径（需求变化才启用）：升级 CF Workers Paid → 重跑 `cf-deploy.yml`。此前不必重议。
- 供应商出清要连带 SDK 出清：换掉/弃用供应商时，`package.json` 里的 SDK 是化石高发区——2026-08-28 依赖审计一次性卸下 33 个零引用包（tencentcloud-sdk、cos-nodejs-sdk-v5、openai、ws/postgres、15 个 radix、8 个 shadcn 生态件等，全是历史 POC/模板遗产）。注意区分两件事：**FAL 是"账号保留、SDK 继续用"**（`@fal-ai/client` 仍是 compose 的回退路径），不能看记忆里的"移出 active set"就删 SDK；反过来 SDK 零 import 也不代表供应商决策变了。判据只有一条：全仓精确 import 图谱。

## 支付通道与 MoR 选型（2026-09）

- **Creem 终拒（2026-09-04，不可申诉）**：2026-09-02 返修 6 项（页脚法务链接、support 邮箱统一、ToS NSFW 禁令、Moderation API 强制集成、店名对齐 MeiHao）全部落地上线后复审，仍被判「unacceptable level of risk」终拒；「established 产品流水证明」一项以诚实回信 + 主动风控缓解（rolling reserve/低额度/长放款期）回应，未救回。
- 可迁移教训：**MoR 风控的裁决变量是「主体画像」，不是「合规整改」**。AIGC 品类欺诈高发 + 零流水新店 + 大陆个人主体（Alipay KYC）构成高风险画像；页脚、条款、审核集成这类整改只影响内容合规维度，对主体风险维度权重≈0。正确顺序是**先用最小提交探「主体资格」这道存在性门槛，确认能过再投入技术整改**——本次反了：先做完 5 项整改 + 1 次全量审核集成，才撞上终拒。
- 去路（2026-09-04 状态）：repo checkout 本就是 Stripe（`app/api/stripe/`，含验卡 setup 模式），切轨道几乎零代码，但无真实 Stripe 账号（占位 key，Stripe 不收大陆个人）。主路径 = 注册港主体 → 港银行账户 → Stripe HK（确定性最高，2–4 周）；Paddle/Lemon Squeezy/Polar 同为 MoR，对同款画像大概率同判，可零成本并行申请但不作指望。

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
- **Kie 同一端点按模型返回不同响应形状**（2026-09-02 实证，`kie.ts`）：`jobs/get` 多数模型返回 `taskStatus`/`result.resultUrls`，但 MiniMax H3 返回 Veo 式 `successFlag`/`response.videoUrl`——补偿任务最初按 taskStatus 解析，读不到 minimax 终态，只能等 24h 僵尸关闭；HappyHorse 还会返回 `completed` 状态与单值 `result.videoUrl`。归一层要按「响应字段存在性」分支，不能按端点假设形状。
- **Kie 分辨率档位按模型而异**（2026-09-02 官方文档口径）：360P 无任何模型提供；Seedance 系（2.5/2/2-fast/2-mini）最低 **480p**（2.5 另有 1080p）；Veo 系/Wan 2.7/HappyHorse 1.1 为 720p/1080p；Kling 3.0 分辨率跟模式走（std=720p/pro=1080p）；MiniMax H3 为 768p/1080p；GeminiOmni 固定 1080p。Veo 有官方 **get-1080p-video / get-4k-video 升级端点**（对已生成视频做真超分）。我们的两维定价实现：`lib/video-pricing.ts` getVideoUnitPointsFor（720p=现行默认价，480p=0.6×，1080p=≥像素比 2.25×成本底线，estimated 待账单校准可下调）+ submit 注册表 supportedResolutions + 合成输出跟随档位（不再一律假放大 1080p）。
- **Creem Moderation API（2026-09-02 集成 → 2026-09-04 随终拒整体出清；考古走 git log -- lib/content-moderation.ts）**：曾以 fail-closed 前置闸挂在全部 5 个 prompt 生成入口（flag=deny 同待遇、超时/5xx/缺 key 拒绝生成），2026-09-04 随 Creem 出局连同 7 处接线一并删除，内容安全政策执法回到 ToS NSFW 禁令 + 上游供应商（Kie/Veo）自带过滤。可迁移教训保留：**为供应商过审而接入的该供应商私有服务，过审失败即从「加分项」变成「人质」**——fail-closed 语义下 key 被禁 = 生成全断，且越「合规」的集成绑得越死。未来若新支付方再要求内容审核，重建时选平台无关实现（如 OpenAI moderation 免费接口），不绑任何单一 MoR 的私有 API。
- 各模型 webhook 优先级历史上不一致（Kling/Seedance/Wan 环境变量优先；minimaxH3/geminiOmni/happyHorse 调用方优先）——生产客户端从不传 webhookUrl，行为等价；2026-09-02 统一为**环境变量优先**（`lib/providers/submit.ts`），happyHorse 保留 `NEXT_PUBLIC_APP_URL` self-URL 兜底（带 projectId 场景定位参数）。

## 密钥与安全卫生（流程，不是一次性事实）

- 泄露响应三步走：**撤销 → 用真实请求验证死透（期待 401/403）→ 记台账**。已处理：Resend 全权 key 撤销并验证 ✅；CF API token #1 撤销并验证 ✅。仍活跃的轮换候选：CF token #2（现为 GitHub secret）、Neon 密码（用户明确暂缓）、Trigger PAT/SecretKey、Kie/R2 key。
- Token 发放原则：**一事一 token、最小授权、用完即撤**，不复用全能 token（这次的教训：为建域名临时发的全权 Resend key 用完立即撤，是对的）。
- 生产冒烟用专门测试账号 `deploy-smoke@test.local`（points=100 由直插 Neon 创建），绝不用真实邮箱/真实账户。

## POC 纪律

- 动供应商相关路由代码之前，先用 `poc/one-sentence-video.mjs` 打通全链路：`--mock` 模式离线零成本回归编排形状；真跑用最小参数 `--scenes 1 --duration 4`。视频是成本大头，Kie 免费额度只够一次最小真跑——**没有 mock 开关的 POC 很快会变得不敢跑**。
- 最小可行管线只需要 2–3 个平台（脚本 + 视频 + 对象存储）；现已接通 11 个服务端平台才是成品态。扩展平台顺序应由成本/风险决定，不由「看起来完整」驱动。

## 自建模型接入一期（2026-09-04 落地，本地提交未部署）

- **架构定型（ADR-0001，七条裁决）**：运营全局无感（后台切生效模型，用户侧 UI/计费同价不变）；统一契约（文本/图像=OpenAI 兼容 chat completions + images generations，视频二期=submit/poll 异步任务契约）；自动云端回退（自建失败/超时/形状不符→该步云端默认模型，funnel 事件 `fallbackApplied` 标记），**不做 fail-closed**——moderation 人质教训的镜像应用；key 存 DB 掩码返回；一期只做手动「测试连接」；全量切不灰度；两期走（一期文本两步+图像，合成步本就自托管）。
- **接缝事实**：`provider_routes` 的 `provider='local'`+`region='local'` 是建库时（迁移0011注释）就预留的自托管插拔位，一期真正用上。`self_hosted_endpoints` 启用行是「该步自建生效」的**唯一事实源**，provider_routes 的 local 行（id=`local_<capability>`）由 `lib/providers/endpoints.ts` sync 函数派生维护，任何变更以 `invalidateRouteCache()` 收尾（60s 缓存热更新，绕过缓存靠测试里的「预热+双 modelId」守卫）。capability 新增 `storyboard_text`（分镜剧情文本）——剧本与分镜可指不同自建端点。
- **key 制度**：`toPublicEndpoint` 单点掩码映射（只露末4位）+ 审计 `SENSITIVE_KEYS` 增 apiKey 双保险 + 路由级契约测试守「任何响应字节不含完整 key」。admin 敏感列泄漏 P0 的制度性回应。改 key 即时生效不重部署。
- **补偿安全用法（可复用模式）**：自建同步调用落任务行用 `generate_character_local`/`generate_storyboard_local` 后缀 taskType——**故意不登记 TASK_PROVIDER**，复用补偿任务「未知 taskType 跳过」语义（settleStaleTask 首行短路已核实）避免同步任务被异步补偿误结算。
- **图像自建链路特有**：端点产出 b64/局域网 URL 必须经 R2 转存公网直链（`lib/r2-upload.ts`，下游图生视频要公网可达），转存失败视同自建失败回退；img2img（参考图/角色一致性图）与 webhook 模式一期保留云端。超时口径：文本 60s、图像 120s。
- **遗留与后继**：迁移 0016 未上生产（部署时先跑）；DGX 生产暴露方式未定（家宽→Cloudflare Tunnel 候选，base_url 可配不阻塞）；GUI 亮暗×中英×桌面/移动全矩阵待 admin 凭据补跑；**视频二期动工前**：重读本文件「供应商怪癖」三条（响应形状/分辨率档位/webhook 优先级）+ 解决时长/分辨率计费口径在自建契约下的映射（video-pricing 唯一事实源不许旁路）+ DGX 单机并发=全站容量上限（回退率是容量观察指标）。锚点：`docs/adr/0001-self-hosted-models.md`、`.scratch/self-hosted-models/`（spec+T1-T5 票）、`lib/providers/{local,chat-active,image-active,endpoints,route-cache}.ts`、`app/api/admin/models/`。
