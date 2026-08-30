# MeiHao UI/UX 全面审计（2026-08-30）

> **修复状态（2026-08-30）**：本文审计发现的问题已按三个批次全部处理完毕（唯一例外见下），验证链 = tsc + vitest 53/53 + next build + 真实 GUI 回归（亮/暗 × 中/英 × 桌面/移动截图）。P0 五项全部修复；i18n 泄漏、aria 批量、防重复提交、对比度 token、字体系统、reduced-motion、版权素材、冷启动 chips 均已落地。**唯一未动**：Trial $19.9 定价表述（P2-6）——涉及计费语义，需所有者决策后改文案。法务三页仅将 locale 来源从 useParams 切到 useLocale，长文案保留在组件内未迁 messages（迁移高风险低收益，如需再排期）。

> 范围：落地页、定价、登录/注册、创作流（create/operate）、素材库、项目、个人中心、管理后台、法务页；
> 方法：代码走查 + 本地 dev（亮/暗 × 桌面/移动）截图目检 + WCAG 对比度实测 + ui-ux-pro-max 规范库对照。
> 结论先行：**品牌视觉方向（暖桃 + 暖炭）成立且落地页完成度高，但存在 3 类系统性缺陷——主按钮对比度不达标（全站）、i18n 键缺失/硬编码泄漏（英文用户会看到中文或裸键名）、触屏/键盘不可达的 hover-only 控件**。建议按 P0→P2 顺序修。

---

## P0 — 上线阻断级（每条都有实锤）

### 1. 定价区三个套餐卖点显示裸 i18n 键名
`components/pricing-section.tsx:76/95/117` 引用 `t("trial.offer")` 等，但 `messages/zh.json` 与 `en.json` 中 **`pricing.{trial,annual,pro}.offer` 键均不存在**。线上所有访客在定价卡上都看到 `pricing.trial.offer` 字样（本次目检截图实锤）。补文案即可，10 分钟修复。

### 2. 主按钮「白字贴桃色」对比度 2.12:1（全站）
`app/globals.css:25`（亮色）`--primary-foreground: 0 0% 100%`，而 `--primary: #E6A37A`。实测 **白字/桃底 = 2.12:1**，低于正文 4.5:1，也低于大字号 3:1。受影响面：导航「立即开始」、hero「开始创作」（`components/hero.tsx:39` 还硬编码了 `text-white`）、所有 Button default 变体、定价「立即订阅」、登录「登录」按钮、页脚「订阅」。暗色模式的同位写法是深字贴桃（6.66:1，达标）——**把亮色 `--primary-foreground` 改为 `30 8% 17%`（#2C2B29）即与暗色一致**，一次改 token 全站生效；同时清理硬编码 `text-white`（hero.tsx:39、pricing-section.tsx:245/270 `hover:text-white`）。注意 `hover:bg-primary/90` 在桃色上叠白底会更浅，hover 色建议同步改为 peach-600 `#C98860` 并配深字。

### 3. 支付成功页无 session_id 时无限转圈
`components/dashboard/payment-success.tsx:69-75 + 141-155`：URL 缺 `session_id` 时 `handlePaymentSuccess` 直接 return，`verificationComplete` 永远 false，页面永远停在「正在验证」spinner。刚付完钱的用户被困死在加载页——转化路径上最伤的 bug。需补明确的失败/空态分支。

### 4. hover-only 控件在触屏/键盘上不可用
- `components/library/unified-library-page.tsx:1004-1016`：素材卡**删除按钮 `opacity-0 group-hover:opacity-100`**——移动端不可见却能误触，键盘用户看不到焦点。
- `components/project-detail.tsx:741-763`：分镜轮播箭头同样 hover 才出现，且内容是裸字符 `‹ ›`，无 aria-label。
统一改为常驻（或 `opacity-0 group-hover:opacity-100 focus-visible:opacity-100` + 移动端常显），补 aria-label。

### 5. `<html>` 无 `lang` 属性
`app/layout.tsx:14`：根布局的 `<html>` 未设 lang，`[locale]/layout.tsx` 只渲染 div。读屏发音引擎、翻译工具、搜索引擎都拿不到语言信号。修法：把 `<html>` 下沉到 `[locale]/layout.tsx` 渲染并传 `lang={locale}`（Next.js App Router 标准做法），或根布局读 middleware 注入的 locale 头。

---

## P1 — 明显影响体验（本批次共 ~20 项，列高频共性）

### 可访问性
- **FAQ 手风琴无 `aria-expanded`/`aria-controls`**（`components/faq-section.tsx:59-65`）；库页签、网格/列表切换等同理（unified-library-page.tsx:294-309/349-366）。
- **图标按钮无可访问名称**（批量）：导航汉堡按钮（navbar.tsx:167）、密码眼睛按钮 ×5（signin/signup/reset）、订阅刷新（subscription-info.tsx:236）、项目更多菜单（projects-list.tsx:240）、admin 移动菜单（admin-dashboard.tsx:153）、社交链接（footer.tsx:237-252）。
- **错误提示无 `role="alert"`**：auth 三个表单、library、projects-list 的错误框读屏不可感知。
- **键盘不可达**：库卡片媒体区 `div onClick` 预览（unified-library-page.tsx:563 等 5 处）、上传拖放区（upload-asset-dialog.tsx:382）。
- **表单缺 `autoComplete`**：signin 缺 `email`/`current-password`，signup 缺 `new-password`，影响密码管理器。

### i18n 泄漏（英文用户会看到中文/错误格式）
- 硬编码 `zh-CN` 日期/金额：`unified-library-page.tsx:262`、`project-detail.tsx:84`、`projects-list.tsx:84`、`payment-history.tsx:369`（USD 金额按 zh-CN 排布）、`payment-success.tsx:234`。
- 硬编码中文进 UI：支付 toast（profile-info.tsx:140,152）、「加载更多/没有更多了」（unified-library-page.tsx:515,818）、「{scene.duration}秒」（operate.tsx:7625）、上传失败文案（upload-asset-dialog.tsx:301）、分割线「或使用邮箱登录」（signin-form.tsx:219）、三整页法务文案全部 `isZh ? :` 三元绕过 messages（cookie/privacy/terms-content.tsx:9）。
- `t(...) || "中文兜底"` 模式无效：next-intl key 缺失会抛错而非返回 falsy，兜底全是死代码（operate.tsx:7152/8482 等）。

### 反馈与防误操作
- **重复提交**：上传按钮 uploading 期间未禁用（upload-asset-dialog.tsx:465）；admin 改角色/积分对话框无 pending 态可连点（user-stats.tsx:796）。
- **搜索无防抖**：admin 用户搜索每敲一键发一次请求（user-stats.tsx:144）。
- **原生 `confirm()`/`alert()`** 与全站 AlertDialog 割裂：projects-list.tsx:94、subscription-info.tsx:88。
- **导航无当前页高亮**：navbar 三个入口任何时候都长一样（规范库 Active State 条目：Severity Medium）。
- **hero CTA 丢语言前缀**：`components/hero.tsx:38` `window.location.href='/create'` 绕过 locale（/zh 页点过去落到英文），且用整页刷新代替 `<Link>`。

### 排版/视觉
- **移动端标题孤字**：390px 下「释放无限影视」断成「…影/视」孤字换行（目检实锤）。给 h1 加 `text-balance`（或 `[text-wrap:balance]`）+ 移动端降到 text-4xl。
- **`text-[8px]`/`text-[10px]` 微缩字**：hero 卡片标签 8px（hero.tsx:77 等）不可读；operate.tsx 有 9 处 10px。
- **成功/失败提示色不达标**：页脚订阅成功 `text-green-400` 贴浅底 **1.67:1**（footer.tsx:202-204），`text-red-400` 2.65:1；`bg-yellow-500` 白字徽章（projects-list.tsx:204）同样不足。应新增语义 token `--color-success-foreground` 类或改深色字。
- **Tab 溢出**：`TabsList` 固定 `h-10 inline-flex` 无横向滚动，project-detail 7 个页签移动端挤压（tabs.tsx:17 + project-detail.tsx:433）。

---

## P2 — 打磨项 / 品牌与工程健康

1. **版权素材风险（商业法务向）**：hero 拼贴直接使用《鬼灭之刃》角色图与「鬼灭之刃」字样（hero.tsx:94-178，R2 公开桶）。产品正在走 Creem 支付审核，展示页用未授权 IP 作效果示例有下架风险，建议换成自制/AI 生成示例。
2. **全站无品牌字体**：`font-headline` 在 4 个组件使用但 tailwind.config.ts 从未定义，该类是 no-op；也没加载任何 webfont。设计意图（标题字体）从未落地。用 `next/font/google` 挂一个中英双字重对（如 Nunito/Manrope + 思源黑体子集）或删掉所有 `font-headline`。
3. **`globals.css:81-83` 全局 `* { transition: background-color .3s… }`**：所有元素所有状态变化都被拖 0.3s，按钮 hover 已有自身 transition 会叠加；应只留在 `body`，并整体包进 `@media (prefers-reduced-motion: no-preference)`。全站 motion 入场动画（motion/react whileInView 等）也无 reduced-motion 降级（规范库 High severity）。
4. **触控目标 <44px**：Button `sm=h-9`、`icon=h-10`，导航大量 size="sm"；轮播箭头 32px、重发验证 24px。移动端统一 ≥44px（或加伪元素扩大热区）。
5. **空状态与引导**：/create 首屏只有一个大输入框（目检），新用户无示例 prompt/模板/「如何运作」引导；connected-accounts 空数据整块空白；profile 未登录只有一行文案没有登录按钮。
6. **定价表述**：Trial 标价 $19.9 但卖点写「7天试用期 赠送200积分」——「试用」收全价容易引发退款争议，建议文案明示「入门套餐」或改 7 天免费+扣卡。
7. **死代码/死样式清理**：`border-dark-600/50`（footer.tsx:219，色值未定义 no-op）、`dark:grayscale dark:grayscale-0`（hero.tsx:93 自相矛盾）、footer 空 social div、operate.tsx 大段注释掉的积分 UI、`{t(...) || "中文"}` 兜底模式、unauthorized-content 5 行 console.log。
8. **一致性小项**：注册成功 3 秒 setTimeout 跳转不可取消且未清理（signup-form.tsx:108）；「恢复」按钮实为「查看」（project-detail.tsx:995）；select 用 `focus:` 而非 `focus-visible:`（ui/select.tsx:22）；Dialog Close sr-only 硬编码英文（ui/dialog.tsx:47）。
9. **暗色模式散落硬编码浅色**：profile/admin 大量 `bg-green-100 text-green-800` 类徽章无 dark: 变体，暗色下刺眼浅块（profile-info.tsx:273-294 等十余处）。建议收敛为 `<Badge variant="success|warning|danger">` 语义变体一次解决。

---

## 建议修复顺序

| 批次 | 内容 | 工作量 |
|---|---|---|
| ① 当天可完成 | P0-1 补 offer 文案；P0-2 改 token + 清 text-white；P0-3 补失败分支；P0-5 lang；P1 孤字 text-balance；FAQ aria-expanded | ~半天 |
| ② 一周内 | i18n 泄漏批量（zh-CN 日期金额 + 硬编码文案 + 法务页迁 messages）；hover-only 控件；图标按钮 aria-label 批量；重复提交/防抖；错误框 role="alert" | 2-3 天 |
| ③ 结构性 | 字体系统落地（next/font）；语义状态色 Badge 收敛；触控目标规范；reduced-motion 全局方案；hero 示例素材换自制；/create 冷启动引导 | 排期 |

> 量化基线（实测）：白字/桃底 2.12:1；桃字/浅底 2.04:1；green-400 提示 1.67:1；删除线价格 1.54:1——全部低于 WCAG AA。暗色模式深字/桃底 6.66:1 达标，可作为亮色修复模板。
