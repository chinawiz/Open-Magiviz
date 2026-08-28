# Methods —— 制作方法：这次验证有效的做事套路

按适用面排序，每条附本项目证据。这些是从单个事件里抽象出的可迁移规律——引用实例是为了证明有效，不是只适用这一次。

## 1. 地基先行

功能批次开工前，先用专门的 commit 收敛地基：类型系统、API/LLM 公共层、巨型组件拆解（`39636f4`、`e80d312`，2026-08-22~24）。结果：随后 11 个 feature 高密度落地期间几乎没有结构性返工。
**判断时机**：当你准备第三次拷贝相似逻辑时，停下来先收敛。地基债的功能越往上叠，利息越高。

## 2. POC 先于实现

高风险外部依赖（付费 API、新技术栈）先用 throwaway 脚本端到端打通，再开工正式实现（`c157148`，184 秒从一句话产出 8 秒成片后才开工相关 feature）。POC 带 `--mock` 开关，之后永远留着零成本回归。对应工具见 `references/providers-and-costs.md` POC 纪律。

## 3. 金钱路径一律 claim-first 原子化

支付记录认领（`claimPaymentRecord`/`completePaymentRecord`，`579484c`）、webhook 积分发放原子认领、积分分支事务化（`19836d8`）。原则：**并发下的正确性靠「谁先原子地 claim 到谁说话」，不靠调用方自觉幂等**。凡是「同一笔东西可能到达两次」的场景（webhook 重试、并发回调）都用这个模式。

### 3a. 金额与数量只能来自服务端事实源（2026-08-28 事故审计）

- 场景：定价审计发现积分购买结账金额 `amount` 由客户端请求体传入（客户端 priceId 恒为空 → 必走动态价格分支），且 webhook 发积分只认 metadata、不校验实付金额——任何人可 $0.01 买 1000 积分。
- 教训（通用规律）：**凡是「服务端事后按客户端给过的数字发货」的路径，那个数字必须在服务端能重新推导出来**。客户端只能传「选择器」（套餐 ID/planType），金额、数量、价格一律服务端查表。订阅路由早就做对了（`getActualPriceIds` 按 planType 服务端映射），同仓库另一条路径却踩坑——好的模式要主动推广到所有同构路径，不能等出事。
- 附带发现：同族 bug 还有「轮询扣费硬编码模型」（Veo 路径三档模型一律按 Fast 扣，应读任务创建时写入的 `pointsAmount`）和「计价不取整撞 integer 列」。共同根因：**同一事实存在多份手工拷贝**，解法是唯一事实源模块（`lib/video-pricing.ts` 导出成本依据 + 单价表 + `minUnitPoints` 底线公式，测试守卫两边不许只改一边）。
- 解法（已验证）：`create-checkout-session` 改为按 packageId 服务端查 `POINTS_PRODUCTS`；订阅路由无条件忽略客户端 priceId；Veo 轮询读任务表 `pointsAmount`；47 测试全绿。
- 锚点：`app/api/stripe/create-checkout-session/route.ts`、`app/api/stripe/checkout/route.ts`、`app/api/ai/generate-story-video/route.ts`（轮询扣费）、`lib/video-pricing.ts`

## 4. 可靠性做成套兜底，不打散点补丁

验签 fail-closed + 健康检查 + 时长红线（`19836d8`）→ 漏回调补偿任务轮询供应商终态（`caad415`）→ 供应商适配层统一轮询语义 + 显式降级链并把 provider/model/fallbackApplied 记入埋点（`6a34072`、`42a63bf`）。
原则：外部依赖的每种失效模式（丢消息、挂起、降级、坏数据）各有一个对应的兜底件，且兜底件自己要有可观测性。单点兜底总有它罩不住的那一天。

## 5. 部署批次前先写一页纸 runbook

`69bd76b` 的 DEPLOY-CHECKLIST.md：前置准备 / 冒烟步骤 / 回退路径压在一页里，然后照着执行。冒烟细节有讲究：登录后**先跑 story-details**、`sceneIndex` 传数字类型——这类细节不预先写下来就会在现场反复试错。

## 6. GUI 回归是文案/界面修复的验收手段

F11 清理折扣宣称时修了 README 却漏了 `messages/zh.json` + `en.json` 里的同款文案，代码审查和 43 个单测都没抓到，最后是在 live 域名上走真实 UI 流程才发现的（`dd15776`）。
**规则**：凡改面向用户的文案，必须同时 grep `messages/*.json`（zh/en 双语两份）；凡宣称功能行为的地方（README/i18n/页面），以代码实况为准逐一对账。

## 7. 测试当门槛，容忍基建混乱

整个部署折腾期（锁文件、CI 网络、OOM、签名头）43 个 vitest 始终全绿。原则：基建层的反复折腾不代表可以破业务逻辑的红线；反过来，测试绿也不代表基建没问题（见 methods #6 的盲区）——两者互补而非互替。

## 8. 平台之争用原型裁决，不用辩论

Vercel vs CF Workers 各有道理，争不出结果；做完 6 个 commit 的全链路原型（OpenNext on workerd，验证清单明确列出：健康检查/Neon HTTP/i18n 页面/NextAuth 登录/R2 presign/Trigger 触发）后，一个 3MiB 上限让结论一分钟落定。
**方法论**：架构争议 → 列出各自的可证伪判据 → 最便宜的原型去撞那个判据 → 裁决**必须附带复活条件**（本例：升级 Paid + 重跑现有 workflow），否则将来环境一变又得从头研究。

## 9. 观测先行，字段带全

漏斗六阶段事件（funnel_events）从第一天起就在视频事件里携带 provider/model/fallbackApplied（N1，`42a63bf`）。后来的成本核算（`references/providers-and-costs.md`）、降级链复盘全都直接受益。
**法则**：埋点晚加一个月，历史数据就永久缺一个月；不确定要不要的字段，宁多勿少。

## 10. 安全卫生内建到流程里

token 按任务最小授权、一事一发、用完撤；撤销后必须用真实请求验证死透并记台账；生产始终留一个专用冒烟账号。具体操作细则在 `references/providers-and-costs.md`。

## 11. 死代码清扫：i18n 键与 state 的"假活"要用多形态证据拆穿

2026-08-28 全库清扫（删 7 个零消费者组件 + 约 750 行死 i18n 键）验证的套路：i18n 键先做**命名空间普查**（`useTranslations`/`getTranslations` 的 namespace 全集），再对候选键跑多形态 grep（键全名、尾段、`t.raw`、模板串）；**只删静态证明零消费者的键，zh/en 两份必须同一批路径同步删**。另一个坑：`useState` 的"读取"可能全在 JSX 注释块里（operate.tsx 的 pointsCost 读点全在 `{/* */}` 内），判定死 state 必须 grep 到行再肉眼看上下文，不能只数出现次数。
**规则**：删键=删契约，宁可漏删不可错删；删完 `tsc --noEmit --incremental false` + `npm test` 双门槛验证（行为零变化是硬约束）。

## 12. 批量编辑工具的"数字字面量残留"要留守卫

2026-08-28 全库清扫发现 18 处同一模式的历史编辑事故：`if (!session) { return jsonError(...) }` 块的收尾 `}` 被某次批量替换吃掉，残留成 `<数字>}`（数字是不可达表达式，tsc/测试/build 全都抓不到——它合法）。分布在 4 个域 9 个文件（app/api/projects、user/points-detail、ai、library 路由），全部存活了多个版本周期。
**守卫**：CI 或本地加一条 `grep -rnE '^\s*[0-9]+\}' app/ lib/`——命中即为该模式残留；另外它证明"全绿"不等于"无伤"，静态不可达代码是所有验证门的盲区，只能靠模式化 grep 扫。
