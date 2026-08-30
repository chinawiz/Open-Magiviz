# MeiHao 管理后台方案

- 状态：P0 + P1 已实施并本地回归通过（2026-08-30，未提交/未部署）；P2（finance 对账 + growth 提现 UI）与 P3 待做
- 日期：2026-08-28 初稿 / 2026-08-30 评审修订 / 2026-08-30 P0+P1 落地
- 部署前置：0015 迁移必须先于代码上线（DEPLOY-CHECKLIST §1.2/§1.3 已入册）
- 评审记录：四位专家（安全鉴权/架构前端/数据财务/产品运营）对初稿并行做代码级评审，四票一致「有保留通过」——路线 A 不推翻；初稿「现状盘点」已过时处全部更正，存量安全债列为 P0 前置
- 动因：无鉴权提权端点 `/api/admin/set-admin` 已下线（commit `2034714`）；现有 admin 面是单页 tab 雏形，需要一个可扩展、带审计、制度化的正式后台

## 一、现状盘点（评审后更正）

已有底座（复用，不重造）：

- 页面守卫：`app/[locale]/admin/page.tsx` 服务端 `requireAdmin()`；实现在 `lib/auth-utils.ts`（NextAuth v4 会话 + `users.role='admin'`）
- API：`app/api/admin/{statistics,users,referrals,affiliates,pricing-health}` 五组路由，鉴权统一走 `isAdmin()`，无漏挂
- 组件：`components/admin/` 四件约 2500 行（dashboard 壳 533 / user-stats 803 / affiliate 781 / referral 366），另 newsletter-stats 297 行已作为第 5 个 tab 挂在壳里；recharts 图表已在用
- 写操作其实已有一半：调积分/订阅修改在 `app/api/admin/users/[userId]/route.ts`（action=adjustPoints/updateSubscription，且已有 `pointsHistory` 流水先例），提现 PATCH 已是完整人工审批流（`app/api/admin/affiliates/route.ts:325-455`：PENDING→PROCESSING/COMPLETED/FAILED + 失败退余额 + 邮件通知，线下打款）
- 补偿底座：`trigger/compensate-missed-webhooks.ts`（10min cron：补扣/补状态/24h 僵尸清理）已在线
- i18n：next-intl `admin` 命名空间 en/zh 各 314 个叶子 key 已完整

真正的缺口：

- 无任务监控页、无写操作审计、单页 tab 壳不可扩展
- **存量安全债（P0 前置收口，评审发现）**：
  1. `app/api/admin/users/route.ts:252-289` 裸 PUT 把任意 `updates` spread 进 `.set()`（mass assignment，可改 role/password）
  2. `app/api/admin/users/[userId]/route.ts:78` 的 `action=updateRole` 可经 HTTP 提权——与制度①「提权永不走 HTTP」直接矛盾
  3. `app/api/admin/users/[userId]/route.ts:27-51` 用户详情返回整行 users，含 password 哈希、resetToken、cardFingerprint、signupIp
  以上三者均已挂 admin 鉴权，非无鉴权洞，但放大单点失陷后果且均无审计。

## 二、同类项目调研（数据截止 2026-08-28，会过期，用时重测）

| 项目 | Stars | 活跃度 | 栈 | 判断 |
|---|---|---|---|---|
| [Kiranism/next-shadcn-dashboard-starter](https://github.com/Kiranism/next-shadcn-dashboard-starter) | 6.9k | 极活跃 | Next 16 + shadcn + TS | **最佳参考**（注意：Tailwind v4 + shadcn/Base UI，我们是 v3 + Radix，只借范式不 fork） |
| [Qualiora/shadboard](https://github.com/Qualiora/shadboard) | 712 | 一般 | Next 15 + shadcn | 次选参考 |
| [marmelab/react-admin](https://github.com/marmelab/react-admin) | 26.9k | 活跃 | React + MUI + react-router | 否决：视觉栈冲突 + 会话重桥 |
| [refinedev/refine](https://github.com/refinedev/refine) | 35.6k | 活跃 | headless 框架 | 否决：data-provider 抽象层对单人运营面板是无主灵活性 |
| [SoftwareBrothers/adminjs](https://github.com/SoftwareBrothers/adminjs) | 9.0k | 转慢 | ORM 自动生成面板 | 否决：裸 CRUD 直接暴露 DB，对金钱路径危险 |
| [ant-design/ant-design-pro](https://github.com/ant-design/ant-design-pro) | 38.7k | 活跃 | React + antd + Umi（非 Next） | 否决：独立 SPA = 第二部署 + 会话桥 + 双栈维护 |
| [soybeanjs/soybean-admin](https://github.com/soybeanjs/soybean-admin) / [vbenjs/vue-vben-admin](https://github.com/vbenjs/vue-vben-admin) | 14.9k / 33.3k | 活跃 | Vue3 生态 | 否决：生态不兼容 |

## 三、决策

**路线 A：深化 in-app admin——不引框架、不 fork 模板，借 shadcn dashboard 布局范式重构现有雏形。**

理由（对着本仓库约束）：

1. 面板是单人运营工具，不是多租户 CRM——框架抽象层买不起单
2. 视觉与主站统一：用户和运营看同一套 shadcn/Tailwind 设计语言
3. 鉴权直接复用 NextAuth 会话 + `requireAdmin()`，无需会话桥
4. 保持单 Vercel 项目 $0 部署，独立 SPA 方案需要第二套部署
5. 金钱路径需要业务级确认 + 审计，自动生成 CRUD 反而危险

## 四、目标架构

```
app/[locale]/admin/
  layout.tsx        ← requireAdmin() + AdminShell（侧边栏，server component）
  page.tsx          ← 概览：统计卡 + 趋势图 + 防薅两指标（注册→首生成转化率、同 signupIp 注册 top 榜）
  users/page.tsx    ← 用户管理：搜索/详情/调积分/封禁（写操作全带审计；展示 signupIp、cardVerifiedAt）
  tasks/page.tsx    ← 任务监控：按用户查失败任务 + 手动补偿（复用已有补偿 cron 底座）
  finance/page.tsx  ← 支付记录 + 积分流水 + 支付网关侧对账（pricing-health 是内部成本口径，不碰网关金额）
  growth/page.tsx   ← referral / affiliate 运营 + 提现处理（给现有 PATCH 审批流套 UI）
  newsletter/page.tsx ← P0 原样迁移现有 NewsletterStats（防功能蒸发），P3 视订阅规模再重写
```

四条配套制度（set-admin 教训代码化，评审修订版）：

1. **管理员引导永不走 HTTP**：`UPDATE users SET role='admin' WHERE email='…' RETURNING id, email;` 进 DEPLOY-CHECKLIST §1（Neon console 执行）；执行人必须核对 RETURNING 恰 1 行，email 拼错/大小写不符会静默 0 行更新，前后各 SELECT role 留痕
2. **审计日志 fail-closed**：新表 `admin_audit_logs`（id, adminUserId, action, targetType, targetId, before/after JSONB, ip, createdAt）。**先插审计行、失败即中止业务写**（neon-http 驱动不支持事务，`lib/affiliate.ts:266` 已有注释先例，做不到同事务）；before/after 走字段白名单脱敏，严禁落入 password/resetToken 等；索引 (targetType,targetId,createdAt) + (adminUserId,createdAt)；ip 复用 `lib/auth-utils.ts` getClientIP()；建表走 `drizzle/0015_*.sql` 手写幂等 SQL，**先于代码上线**（0014 缺列 500 教训）
3. **深度防御的现实边界**：middleware 预检只能验「已登录」——JWT 里没有 role（`lib/auth.ts:254` 回调只塞 id/provider），edge 不查 DB；role 判定仍在 route 层 `isAdmin()`。现 matcher（`middleware.ts:18`）排除 api，挂 `/api/admin` 需改排除正则分流，防止 next-intl 处理 API 路径
4. **RBAC 留缝不预设**：单 `role='admin'` 不动 schema；判定收敛在 `isAdmin()` 一处（已达成，五组路由均引用），将来加 'owner'/'support' 只改该函数

**P0 存量安全收口**（评审新增，动工前完成）：下线 users 裸 PUT；updateRole 移出 HTTP 或并入唯一审计写入口；用户详情改显式列白名单（排除 password/resetToken）；`requireAdmin()` 硬编码 `redirect('/zh/unauthorized')`（`lib/auth-utils.ts:33`）改按 locale 拼接；`lib/auth.ts:314` `debug:true` 生产关闭。

表格先用现有 shadcn Table 手写（现有 user-stats/affiliate 已是服务端分页+排序，够用）；排序/分页复杂后再引 TanStack Table（headless），不提前。

## 五、分期计划（评审修订版）

| 期 | 内容 | 预估 |
|---|---|---|
| P0 | 拆单页壳 → route-per-page + 侧边栏 + newsletter 原样挂 `/admin/newsletter`；`admin_audit_logs` 表（0015 幂等 SQL，先于代码上线）+ 引导 SQL 入 DEPLOY-CHECKLIST；**存量安全收口四件**（裸 PUT / updateRole / 详情列白名单 / requireAdmin locale 化 + debug:false）；概览页加防薅两指标 | 0.5–1 天 |
| P1 | users 页写操作（调积分改走审计入口 + 同步 pointsHistory 双写、新增封禁、双确认 + 负值/单次上限决策）；tasks 页最小版（按用户查失败任务 + 手动补偿；降级链数据在 funnel_events，ai_generation_tasks 无 provider/失败原因字段）；**finance 最小只读版提前**（按 email 查 stripePayments + pointsHistory——新价格切换 + 验卡 webhook 新分支正是漏发高发窗口） | 1-2 天 |
| P2 | finance 对账视图（stripePayments 金额勾稽 + 退款单可见 + 手动调减——`charge.refunded` 现只回收 affiliate 返利不回扣积分）；growth 页（给现有提现 PATCH 审批流套 UI） | 1-2 天 |
| P3（低 ROI 缓做） | newsletter 重写（触发条件：订阅者 >500）；Kie 成本对账维持月度脚本 `scripts/kie_cost_audit.py` 不开发 | 待定 |

## 六、验证策略

- 纯函数/金额计算走 vitest（与主站同一套）
- 每页交付按经验库规矩做真实 GUI 回归（admin 测试账号直插 Neon 创建）+ 中英双语冒烟
- 写操作验收四连：无会话 401、非 admin 403、审计行落库、积分流水同步（双写验收）
- **真实金额路径演练**（新增）：test mode 下单 → webhook 发点 → finance 可查 → 退款 → 调减积分 → 封禁后不可生成，一次半天，覆盖全部工单类型

## 七、已关闭的开放问题与裁决（2026-08-30 评审）

- ~~affiliate 提现是自动打款还是人工审批？~~ **人工审批**，代码证实（`lib/affiliate.ts:526` + admin PATCH 状态机），无自动打款通道
- ~~admin 面是否纳入 next-intl 双语？~~ **P0 就走**，en/zh 各 314 key 已全，成本≈0
- 已裁决：封禁做用户级即可（详情页展示 signupIp 供人工识别农场，不建 IP/设备封禁）；不建撤销按钮（审计 before/after 足够手工回滚）；调积分负值/单次上限 P1 顺手定；双人复核不列（单人无意义）
