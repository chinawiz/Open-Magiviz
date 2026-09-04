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

### 3b. 「同源」必须同到金额公式的每个因子；供应商提交走 seam 防漂移（2026-09-02 架构普查+重构）

- 场景：架构普查发现 `generate-story-video` 路由 2394 行里藏 7 个 per-model 提交函数 + 13 处单价手抄，§3a 建的唯一事实源被死代码批量分支绕过（veo31Quality 预检 3 vs 实扣 9 分/秒）；首轮修复单价同源后，code-review 又抓到「同源只做了一半」——**计费秒数**仍是两套口径：route 预检用 `getDurationSeconds`（不按模型收敛），提交侧按各模型 clamp 收敛，minimaxH3 传 3s 时预检按 3s、落行按 6s，预检少算照样能打出负余额；降级链落到更贵候选时预检也不设防。
- 教训（通用规律）：**单价同源 ≠ 金额同源**——金额公式的每个因子（单价、秒数、数量）凡在两处独立解析，漂移只是时间问题。结构性解法是 seam：供应商知识收敛到一个 module（一张「模型键 → 请求构造/taskType/webhook 口径」注册表），让「再抄一份」在物理上不可能；热修 ternary 只是止血。预检要对「所有可能实际发生的扣费」取上界（含降级链候选），而不是只对主模型。
- 解法（已验证）：`lib/providers/submitTask(modelKey, input, meta)` 统一「调供应商 + 落任务行」，`resolveBillableSeconds(modelKey, raw)` 把各模型收敛/默认秒数导出给 route，预检 = 降级链各候选按各自口径的**最大消耗**；注册表 × 价格表双向一致性测试（`submit.test.ts`）守卫两边不许只改一边；route 2394→293 行。已知取舍：任务行 insert 失败仍返回 ok（历史口径——供应商任务已建，报错只会诱发重复提交烧供应商钱），留待 settlement 票收紧。
- 锚点：`lib/providers/submit.ts`、`lib/providers/poll.ts`、`app/api/ai/generate-story-video/route.ts`、commits `0d15741`..`ca1afd4`

## 4. 可靠性做成套兜底，不打散点补丁

验签 fail-closed + 健康检查 + 时长红线（`19836d8`）→ 漏回调补偿任务轮询供应商终态（`caad415`）→ 供应商适配层统一轮询语义 + 显式降级链并把 provider/model/fallbackApplied 记入埋点（`6a34072`、`42a63bf`）。
原则：外部依赖的每种失效模式（丢消息、挂起、降级、坏数据）各有一个对应的兜底件，且兜底件自己要有可观测性。单点兜底总有它罩不住的那一天。

## 5. 部署批次前先写一页纸 runbook

`69bd76b` 的 DEPLOY-CHECKLIST.md：前置准备 / 冒烟步骤 / 回退路径压在一页里，然后照着执行。冒烟细节有讲究：登录后**先跑 story-details**、`sceneIndex` 传数字类型——这类细节不预先写下来就会在现场反复试错。

## 6. GUI 回归是文案/界面修复的验收手段

F11 清理折扣宣称时修了 README 却漏了 `messages/zh.json` + `en.json` 里的同款文案，代码审查和 43 个单测都没抓到，最后是在 live 域名上走真实 UI 流程才发现的（`dd15776`）。
**规则**：凡改面向用户的文案，必须同时 grep `messages/*.json`（zh/en 双语两份）；凡宣称功能行为的地方（README/i18n/页面），以代码实况为准逐一对账。

**补充（2026-09-04 纯 GUI 黑盒冒烟的三条工具局限，断言必须与 DOM 交叉验证）**：① IAB/CDP 截图**捕获不了原生 HTML5 校验气泡**（非 DOM 渲染）——空表单提交/无效邮箱在截图里看似「零反馈」，判据应看 DOM 结构（input `required` + `button[type=submit]` + `noValidate=false` + 焦点跳到首个无效字段），别凭截图下「静默无反馈」结论；② fullPage 截图对 pinned/动画 hero 会拼接出整屏重复内容（实测 hero 连续 8 遍），真实用户滚动完全正常——先逐屏滚动验证再定性，别当 bug 报；③ next-intl 会把全部消息 JSON 内联进 body `<script>`，用 `document.body.textContent` 断言文案会误中未渲染的键——用过滤 SCRIPT/STYLE 的 TreeWalker 查可见文本节点。本次冒烟还抓到 signup 副标题「开启SaaS开发之旅」模板残留（`messages/*.json` auth 节，已同批修复双语）；upgrade/购买文案仍有 `upgrade_benefits_1`/`points_usage_ai_service`/`success_toast*` 四处 SaaS 模版措辞，待产品定稿后清理。

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
**新增键方向同构对账（2026-08-30 管理后台补全）**：批量加键后用 python 脚本做双向核对——正则抽取组件里全部 `t('…')` 静态键拼 namespace 查 zh/en 双文件存在性（本次 464 个），动态模板键（``t(`status_${x}`)``）人工枚举取值逐个核。tsc/vitest/build 对缺键全盲，这是唯一的静态防线；顺带扫 `t('…') || '兜底'` 死代码（infra#20：键缺失时 next-intl 抛错而非返回 falsy，`||` 右侧永不可达——admin 范围就抓到一处存活多版本的）。

## 12. 批量编辑工具的"数字字面量残留"要留守卫

2026-08-28 全库清扫发现 18 处同一模式的历史编辑事故：`if (!session) { return jsonError(...) }` 块的收尾 `}` 被某次批量替换吃掉，残留成 `<数字>}`（数字是不可达表达式，tsc/测试/build 全都抓不到——它合法）。分布在 4 个域 9 个文件（app/api/projects、user/points-detail、ai、library 路由），全部存活了多个版本周期。
**守卫**：CI 或本地加一条 `grep -rnE '^\s*[0-9]+\}' app/ lib/`——命中即为该模式残留；另外它证明"全绿"不等于"无伤"，静态不可达代码是所有验证门的盲区，只能靠模式化 grep 扫。

## 13. UI 批量整改：hover-only 与触屏先行的修法模板（2026-08-30）

- 全库审计（`docs/ui-ux-audit-2026-08.md`）后按三批次修完 40+ 项。两个复用价值最高的模式：
  - **hover-only 控件**（`opacity-0 group-hover:opacity-100`）在触屏上不可见但可误触、键盘用户看不到焦点——统一改成 `opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100`（移动常显、桌面 hover/focus 显示），素材删除按钮和分镜轮播箭头都是这个修法。
  - **动效尊重系统偏好**：CSS 侧把全局 transition 包进 `@media (prefers-reduced-motion: no-preference)`，motion/react 侧用 `useReducedMotion()` 把 initial/animate/whileInView 传播对象置空（`{...(reduceMotion ? {} : {...})}`），landing 五个组件一个工厂函数 `reveal(delay)` 搞定。
- **审计→修复的验收闭环**沿用 GUI 回归铁律：tsc/vitest/build 全绿之后，仍要在真实浏览器里亮暗×中英×桌面/移动各过一遍——本次GUI 回归又抓到一处漏网（非推荐卡的 offer 胶囊 `text-primary` 桃字贴桃底），代码审查和类型检查都发现不了颜色问题。

## 14. 横切拦截收敛唯一入口；无事务驱动上用「审计先行、失败即中止」替代事务（2026-08-30 管理后台 P0/P1）

- **账号级封禁收敛在 `getAuthedSession()` 一处**：46 个消费者路由零改动即全覆盖（封禁=停用，代价每次鉴权多一次主键查询）。凡是「一种横切规则要管住 N 条路径」的需求（封禁、限流、审计），先找唯一必经入口，不要逐路由打补丁——补丁必有漏网。反面对照：set-admin 事故正是因为提权有多个入口。
- **neon-http 驱动不支持事务，金钱/权限写操作的审计用顺序保证**：先 `await recordAdminAudit(...)`（插入失败抛错→业务写不发生），再执行业务写。配合 before/after 白名单脱敏（password/resetToken/cardFingerprint 绝不进审计账本）+「流水+审计双写」作为验收项。锚点：`lib/admin-audit.ts`、`lib/api.ts`（getAuthedSession 封禁拦截）、`app/api/admin/users/[userId]/route.ts`（全部写操作统一模式）、`lib/task-compensate.ts`（补偿结算语义唯一实现，cron 与手动补偿共用）。
## 15. 对账口径：「应发」必须包含后来退款的单（2026-08-30 finance 对账实证）

- 场景：finance 对账视图 v1 把 `pointsAmount` 合计限定在 `succeeded`，一笔单转 `refunded` 后应发骤减、差异变负——但该单的积分实际发过（退款回收走的是手动调减，台账里是负数 manual 行）。
- 教训（通用规律）：**「应发」的口径是「曾经承诺过的数」，退款是事后事件，不应从应发里剔除**——否则每次退款都会制造假差异，掩盖真漏发。回收动作在台账侧（负数流水+审计）单独可见，两侧各记各的事实，不做双向抵消。
- 解法（已验证）：应发 = `paymentStatus IN ('succeeded','refunded')` 的 pointsAmount 合计；实发 = pointsHistory `action='purchase'` 正数合计；差异 ≠ 0 即漏发。锚点：`app/api/admin/finance/recon/route.ts`。

## 16. 存量库接 lint/质量门禁靠「分诊」，不靠「全修」（2026-09-03 质量流程落地实证）

- 场景：仓库 122+ 测试和 strict TS 一直手动跑，lint script 坏死（Next 16 移除 `next lint` + eslint 从未安装），无 push 触发的 CI，全部质量关卡靠自觉。
- 教训（通用规律）：**给存量代码库第一次接 lint，目标不是「零告警」而是「error 归零 + 债务显名」**。全量修 222 个 error 等于大改业务代码，引入回归风险，得不偿失。
- 解法（已验证）三步分诊：① 机械可修的交给 `eslint --fix`（prefer-const 12 处一次清零）+ 手工零星修真错（JSX 未转义引号 2 处、tailwind config 的 require 1 处）；② 大宗且「修了要动业务逻辑」的规则降为 warn 并在 config 里注明分诊日期（no-explicit-any 156 + react-hooks 新规 set-state-in-effect/immutability/purity 51），债显名、拦 CI 的只有 error；③ 验收口径 = `npm run check`（typecheck+lint+test 一条命令）+ 占位 env build 全绿，并搬进 push/PR 触发的 CI workflow（env 全占位照抄 cf-deploy 模式）。
- 附带纪律：warning 不拦门禁但**别新增**——否则债务静默膨胀，门禁名存实亡。
- 锚点：`eslint.config.mjs`（含分诊注释）、`package.json`（typecheck/check scripts）、`.github/workflows/ci.yml`、`QUALITY-CHECKLIST.md`（五层检查 + 已知全绿盲区表）、`AGENTS.md`（提交流程挂链）。
## 17. 可维护性治理的「摸底→棘轮→军规→风险升序拆分」套路（2026-09-03 grilling 共识落地）

- 摸底先行，数字说话：最大文件行数/useState 数、影子文件 diff、测试盲区（钱/权模块）、i18n 键对账——一个后台探查 agent 十分钟出全库底账，不靠感觉定优先级。本次摸出 operate.tsx 10,037 行/82 useState（第二大文件的 9 倍）、钱权 12 模块零测试、6 个死键。
- **warning 用棘轮不用清零**：`--max-warnings <实测数>` 进 lint script（本地=CI 同一命令），存量 430 条冻结、只降不升；清偿后手动调低数字。给存量库第一次接 lint，「error 归零+债务显名」比「零告警」现实得多（承接 §16）。
- **军规要有牙齿才存在**：「童子军军规」落成可验收条款——碰过的文件该文件 warning 清 0、新抽纯逻辑必带 vitest、~500 行压力线；否则永远排在后面。
- **大单体拆分：专项立项 + 风险升序 + 分批回归 + 安全网先行**：先摸清职责块（8 类）与已验证的低风险先例（4 Dialog+3 纯模块）；拆分顺序纯数据→展示→状态编排；回归按批次升压（纯函数批只跑 vitest → 展示批精简 GUI → 状态批全量 GUI 矩阵）；**给计费/支付/验签纯函数补单测作为拆分安全网，先行于第一刀**。载体用 plan+逐块 ticket 声明阻塞边，跨 session 恢复。锚点：`docs/operate-split/`（plan+T1-T8）、`QUALITY-CHECKLIST.md`「童子军军规」节、`lib/{points,points-manager,payments,webhook-security}.test.ts`。
- 拆分纪律：**只移动不改行为**；疑似 bug 记 ticket「发现」节不顺手修。本次即命中一例：`points-manager` 的到期状态翻转只发生在「有赠送积分」的清零分支内，赠送积分为 0 的到期用户会永远停在 active（现状已用测试固化为契约，是否修属产品决策）；另注意用户积分表隐含不变式 `points = purchasedPoints + giftedPoints`，测试夹具违反它会算出负数——实现信任该不变式。
- T1 补充（2026-09-03 首刀实证）：**客户端镜像表的手抄关系本身要固化成测试**——operate.tsx 的分辨率表与 submit 注册表是「≥2 档子集」的精确镜像，抽到 `lib/providers/video-models.ts` 后用 4 用例锁死「三方同集+逐值相等」，后续增删模型任一侧单独漂移立刻红（§3b 双向一致性模式在「服务端权威 vs 客户端镜像」场景的推广）。本次同刀收获：素材兼容模型集曾在 3 处字面重复、注释与代码漂移（注释 3 个模型、代码放行 4 个）——**重复的字面集合就是等待发生的口径漂移**，抽离时一律收敛单源。锚点：`lib/providers/video-models.{ts,test.ts}`、`docs/operate-split/T1-model-registry.md`「发现」节。
- 批次三补充（2026-09-03 状态编排批 T5-T8 完工，operate.tsx 9,404→6,679 行）：**「逐字切片 + diff 证明」是搬移类重构的硬证据**——用脚本按行切片生成新模块（切前校验大括号平衡），搬完后 diff 新旧函数体证明逐字节一致，「只移动不改行为」从口号变成可复核事实；再配合 tsc 兜底（漏搬的依赖名 tsc 立刻红）。**宽 deps 注入换零行为变更**：状态块与组件的耦合全部走 deps 对象（refs/当次渲染状态值/setter/工作流回调，hook 内自持 i18n 与 toast），解构沿用原函数名使调用点零改动；TDZ 规避=hook 调用点放在最晚声明的依赖之后（更早定义的闭包引用后置解构名，运行期安全）。**真实链路注入验证法**：本地 webhook 不可达时，用服务端 Pusher SDK 向 `task-<taskId>` 发布与 webhook 同构的 status 事件，前端订阅→解析→resolve 全链可验证；配合「先暂停挂起（pause 会等 pending 任务）、再注入放行」可拦在贵价阶段（剧情视频）之前控制 Kie 成本。**环境两坑**：①本地缺 `NEXT_PUBLIC_PUSHER_KEY/CLUSTER` 时客户端订阅会静默 no-op（throw 被吞），表现为「事件永远不来」，与线上「推送未达」同族；②本地 dev 库 schema 漂移（缺列/缺表）会让工作流在项目创建步 500——长流程 GUI 回归前先对齐 schema、装好 console.log 拦截器再点按钮。**领票纪律的实证**：前置票会吃掉后票票面范围（T5 抽壳后仅剩 1 state+1 回调）、票面文件名与实际职责可能不符（T7 实为 use-character-generation）——领票先重新盘点实际残留，按职责落刀，不为凑票面硬拆。锚点：`hooks/use-{library-selection,task-events,storyboard-generation,character-generation}.ts`、`components/operate/{Script,Storyboard,Character}DetailDialog.tsx`、`docs/operate-split/T5-T8`「发现」节。
- 批次四补充(2026-09-03 展示与外围批 T9-T13 完工,operate.tsx 6,657→5,256 行,棘轮 410→381):**props 同名透传 + 调用点机械生成**——挂载组组件(86 个 props)的调用点由「解构参数名单循环生成 `name={name}`」,零手误且 diff 证明友好;**挂载区 JSX 分居两个 DOM 层级时单组件无法横跨**(内容层 div 内 vs 根层),按层级拆组,不为「凑一个组件」改 DOM 结构。**领票盘点=死代码探测器**:一票连抓三例(`getFileSizeExceededMessage` 函数、`VIDEO_STYLE_MAP` 模块常量、`mediaFiles` 局部变量全是定义后零消费)——判定死代码必须全库 grep 调用点,警惕子串误报(`<PurchaseDialog` 形态精确匹配 JSX 用法)。**给「缺位」写守卫前先确认缺位是否语义内**:auto 回落模型不在分辨率注册表曾让守卫测试红——真相是注册表只收「≥2 档可选」模型,固定档模型本就不入表;守卫应写真实不变式(如「全模型集缺省档有价可查」)而非结构性假设。**JSX children 里裸 `//` 注释会变成渲染文本节点**(react/jsx-no-comment-textnodes 直接报 error),eslint-disable 注释必须包在 `{/* */}` 容器里。**动态 i18n 键的逐处 `as any` 强转可用「类型化 t 别名」一次性消解**:`useTranslations(ns) as unknown as (key: string, values?) => string`,运行期同一函数,新抽组件零 any 告警。**warning 口径一律以全库棘轮数为准**,单文件 eslint 瞬时输出(尤其管道 tail)会误读成「已清零」。精简 GUI 回归的落地路径:真实登录种子号 + next-themes 用 `localStorage.setItem('theme',…)`+reload 切换 + `setViewportSize` 视口矩阵;「预计消耗 N 积分」按钮文案是积分预估公式的活体探针,凡动计价预估必看它。锚点:`components/operate/{operate-dialogs,create-panel,create-settings,workflow-steps,SceneVideoDetailDialog}.tsx`、`hooks/{use-file-storage,use-upload-items}.ts`、`lib/points-estimate.{ts,test.ts}`、`docs/operate-split/T9-T13`「发现」节。
- 批次五补充(2026-09-03 状态管线批 T14-T18 完工,operate.tsx 5,256→2,117 行,棘轮 381→332):**前向桥断环**——hook 互供依赖(resume hook 要 T16 的 handleSend、T6 要 resume hook 的 resumeSceneVideosGeneration)时,用 `let xxxImpl = async () => {}` 桥变量+接线处传转发闭包+接线后回填,渲染期同步赋值故运行期等价;**react-compiler「hook 参数不可变」**会拦 dep ref 的 `.current=` 写入,惯用法=把写操作收敛为注入回调(`setCurrentXRefValue={(v)=>{ref.current=v}}`),只读不拦;**基接口必填但本 hook 未用的依赖**不进解构(解构即触发未用告警),接口仍声明、调用方仍传;**注入 Pusher 事件必须带 `data.type`**(客户端 validTypes 白名单过滤,漏 type 静默丢弃——与 T8 的「缺 env 静默失效」同属静默族);**合并展示 JSX(一行三栏)不按栏拆文件**,肢解循环闭包是伪分离,压力线偏差记票面即可;**恢复判据的活体验证**:库里造「分镜 imageUrl 全空」夹具,恢复后指示器分镜计数=0 且回到缺图步=正确行为(与 resume-checkpoint 判据互证)。锚点:`hooks/use-{regeneration,storyboard-edit,workflow-pipeline,workflow-resume,project-restore}.ts`、`docs/operate-split/T14-T18`「发现」节。
- 批次6 收官补充(2026-09-04,T19/T21a/T21b 完工+T20 裁决放弃,operate.tsx→1,693 行 0 warning):**接线收敛的正确姿势**——7 站 hook 接线的并集 props 做成 `workflowDeps` 对象一次装配、各站 `...workflowDeps + 站内特有`,落点必须早于最早消费者且晚于全部成员声明(可用集用「const/let/function+数组解构+对象解构」三种声明形态扫描);**扫描脚本三坑**:块尾要匹配 `^  \}\)` 而非首个 `}`、站与站之间必须现场重扫(改写会位移)、严格连续注释块检测勿用「间隔≤2 合并」(会把夹缝里的活代码吞进删除区间——本轮真实发生,靠 git checkout 恢复);**收尾脚本中止后的未落盘改动必须重查**——T21a 曾因此「完工造假」(声称两站接入实际只接一站),被 code-review 抓出;**合一前先裁决口径**:同名组装块谓词可能不同(includes vs String 强转)、payload 形状可能不同(imageUrl ?? null),口径不一致的站点排除合一并记档,不为凑去重而改行为;**放弃也是裁决**:T20 收益/风险倒挂(依赖循环+全量矩阵成本),收官确认放弃比硬做更符合专项初衷。锚点:`docs/operate-split/plan.md` 收官节、`lib/script-mapper.ts`、`components/operate.tsx` workflowDeps。

## 18. 自建供应商接入的「全流程工程法」样本（2026-09-04 grilling→spec→tickets→implement 首次全链实证）

- **接缝考古先行于设计**：动供应商代码前先探「当年预留的插拔位」——provider_routes 的 `provider='local'`/`region='local'`、schema 注释里的预留语义，都是设计输入；本轮生效模型解析直接复用预留结构，零迁移改动路由表。**事实纠偏也在此步**：剧本模型实为 ZenMux gemini-3.5（非记忆里的 GLM/Qwen）、合成步已自托管——带着错误预设设计会白做。
- **可测核心的抽取姿势**：路由包装器（chat-active）把「local 失败→云端恰一次→元数据」收敛成注入 callCloud 的纯逻辑单测；带 raw 透传等特殊需求的剧本路由不硬套包装器，内联但复用 pickLocalEntry/toEndpointConfig/normalizeLocalError 共享 helper——「统一决策、各自接线」。双失败场景把回退元数据挂在**原错误对象**上重抛（RoutedMetaCarrier），保住调用方 `instanceof LLMError` 语义。
- **测试守卫要「真守卫」**：热更新守卫初版删掉 invalidateRouteCache() 仍全绿（beforeEach 手动失效掩盖了被测行为）——改造为「预热缓存 + 路由行/端点行 modelKey 故意不同」后，缓存失效与否走的是不同代码路径，删守卫点立刻红。**每张票过两轴 code-review 的回报率极高**：五轮 review 累计抓出 funnel 线程断裂（local 成功误记 kieai）、角色图 webhook 未跳过 local、modelUsed 调用前定型、双失败丢回退痕迹、PATCH 撞唯一索引 500——全是静态检查与单测盲区。
- **接存量代码时顺手修真 bug 要留痕**：T3 接线发现分镜帧提取按数组下标取 `{default:{url}}` 对象恒 undefined（单帧重生成/首尾帧轮询模式恒判失败的存量 bug）——修了并在票面与 commit message 双留痕，上线后重点回归这两条路径。
- **每 capability 唯一启用**这类「唯一性约束」的前置检查（409）比撞 DB 部分唯一索引（500）便宜且可测；启停/删除联动派生态（路由行）时，capability 变更要同时下线旧 capability 的派生行。
- 锚点：`lib/providers/{chat-active,image-active}.test.ts`（注入 fetch/mock router 的两种打法）、`app/api/admin/models/route.test.ts`（首个路由级契约测试，vitest include 已扩 `app/**`）。
