# MeiHao 管理后台方案

- 状态：已评审通过，待按分期实施
- 日期：2026-08-28
- 动因：无鉴权提权端点 `/api/admin/set-admin` 已下线（commit `2034714`）；现有 admin 面是单页 tab 雏形，需要一个可扩展、带审计、制度化的正式后台

## 一、现状盘点

已有底座（复用，不重造）：

- 页面守卫：`app/[locale]/admin/page.tsx` 服务端 `requireAdmin()`；实现在 `lib/auth-utils.ts`（NextAuth v4 会话 + `users.role='admin'`）
- API：`app/api/admin/{statistics,users,referrals,affiliates,pricing-health}` 五组路由，均已挂 admin 鉴权
- 组件：`components/admin/` 四件约 2500 行（dashboard 壳 533 / user-stats 803 / affiliate 781 / referral 366），recharts 图表已在用
- UI：19 个存活 shadcn 组件（table/dialog/tabs/select/badge…）、Tailwind v3、next-intl `admin.dashboard` 命名空间

缺口：无任务/生成监控、无写操作审计、无运营写动作（调积分/封禁/提现处理）、单页 tab 壳不可扩展、提权通道制度化缺失。

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
  page.tsx          ← 概览：统计卡 + 趋势图（复用 statistics API）
  users/page.tsx    ← 用户管理：搜索/详情/调积分/封禁（写操作全带审计）
  tasks/page.tsx    ← 任务监控：ai_generation_tasks 状态/失败率/降级链 + 手动补偿
  finance/page.tsx  ← 支付记录 + 积分流水 + pricing-health 对账视图
  growth/page.tsx   ← referral / affiliate 运营 + 提现处理
```

四条配套制度（set-admin 教训代码化）：

1. **管理员引导永不走 HTTP**：`UPDATE users SET role='admin' WHERE email='…';` 进 DEPLOY-CHECKLIST §1（与 deploy-smoke 冒烟账号同节，Neon console 执行）
2. **审计日志**：新表 `admin_audit_logs`（id, adminUserId, action, targetType, targetId, before, after, ip, createdAt），写操作先记后行
3. **深度防御**：middleware matcher 对 `/admin`、`/api/admin` 加会话预检（layout 已挡，再拦一层）
4. **RBAC 留缝不预设**：单 `role='admin'` 不动 schema；判定收敛在 `isAdmin()` 一处，将来加 'owner'/'support' 只改该函数

表格先用现有 shadcn Table 手写；排序/分页复杂后再引 TanStack Table（headless），不提前。

## 五、分期计划

| 期 | 内容 | 预估 |
|---|---|---|
| P0 | 拆单页壳 → route-per-page + 侧边栏；`admin_audit_logs` 表 + 引导 SQL 入 DEPLOY-CHECKLIST | 半天 |
| P1 | tasks 页（失败率/降级链 + 补偿触发）；users 页写操作（调积分/封禁，双确认 + 审计） | 1-2 天 |
| P2 | finance 页（支付 + 积分流水 + pricing-health）；growth 页（affiliate 提现流） | 1-2 天 |
| P3（可选） | newsletter 管理；Kie 成本对账入库（`scripts/kie_cost_audit.py` 的制度化延伸） | 待定 |

## 六、验证策略

- 纯函数/金额计算走 vitest（与主站同一套）
- 每页交付按经验库规矩做真实 GUI 回归（admin 测试账号直插 Neon 创建）
- 写操作验收必须覆盖：无会话 401、非 admin 403、审计行落库三连

## 七、开放问题

- affiliate 提现当前是自动打款还是需人工审批？决定 growth 页形态（P1 前确认）
- admin 面是否纳入 next-intl 双语？建议 P0 就走（namespace 已存在，成本≈0）
