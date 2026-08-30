# 部署验证清单（2026-08-25 批次：12 个 commit）

> 覆盖内容：F11 计费统一 / F10 幂等全套 / F2 适配层+降级链 / 合成自托管 /
> T-05 预签名 / webhook fail-closed / healthz / N1 埋点。
> 按顺序执行；每步的回退方式见文末。

## 0. 前置决策：部署源（必须先定）

新代码在 fork（`chinawiz/Open-Magiviz`，main = `42a63bf`），
upstream（`ItusiAI/Open-Magiviz`）仍在 `f82eb8b`。二选一：

- [ ] **A. PR 合入 upstream**：`gh pr create --repo ItusiAI/Open-Magiviz`（Vercel 连的如果是 ItusiAI 仓库，走这条）
- [ ] **B. Vercel 改连 fork**：项目 Settings → Git → 换成 `chinawiz/Open-Magiviz`（最快可验证）

## 1. 数据库（Neon）

**1.0 备份**：确认 PITR 开启，或创建一个 Neon branch 快照（0010 含数据清理，必须可回退）。

**1.1 预检查**（只读，看 0010 会清理多少重复）：

```sql
SELECT paymentIntentId, COUNT(*) FROM stripePayments
 WHERE paymentIntentId IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1;
SELECT checkoutSessionId, COUNT(*) FROM stripePayments
 WHERE checkoutSessionId IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1;
```

> 有结果 = 存在历史重复，0010 将保留最早一条删除其余（支付审计影响自行确认后再继续）。

**1.2 执行迁移**（手写 SQL，用 psql 逐个执行；均幂等）：

```bash
psql "$DATABASE_URL" -f drizzle/0010_add_payment_idempotency_indexes.sql
psql "$DATABASE_URL" -f drizzle/0011_add_provider_routes.sql
psql "$DATABASE_URL" -f drizzle/0012_add_funnel_events.sql
psql "$DATABASE_URL" -f drizzle/0013_add_ai_task_model.sql
psql "$DATABASE_URL" -f drizzle/0014_add_pricing_redesign.sql
psql "$DATABASE_URL" -f drizzle/0015_add_admin_audit_and_ban.sql
```

> 0014（2026-08-30 定价重构）：users 表加 `signupIp`/`cardVerifiedAt`/`cardFingerprint` 三列 + 两个索引，纯增量、幂等。
> 配套：Stripe Dashboard 需先建 4 个新 Price（Starter $9.9/mo、Pro $24.9/mo、Annual $249/yr、积分包 Premium $85），
> 并配置 `STRIPE_STARTER_PRICE_ID`，更新 `STRIPE_PRO_PRICE_ID`/`STRIPE_ANNUAL_PRICE_ID`/`STRIPE_POINTS_PREMIUM_PRICE_ID`
> 指向新价；旧 Price 保留（老订阅 grandfather 续费）。方案全文见 `docs/pricing-redesign-2026-08.md`。
> 0015（2026-08-30 管理后台 P0）：新表 `admin_audit_logs` + users 表 `bannedAt`/`bannedReason` 列，纯增量、幂等。**必须先于含 admin 审计代码的部署执行**（缺表即 500）。

**1.3 管理员引导 SQL（制度①：提权永不走 HTTP）**（Neon console 执行，新管理员/找回管理员时用）：

```sql
UPDATE users SET role='admin' WHERE email='此处填邮箱' RETURNING id, email, role;
```

> [ ] 执行人必须核对 RETURNING **恰好 1 行**——email 拼错或大小写不符会静默 0 行更新；
> [ ] 前后各 `SELECT id, email, role FROM users WHERE email='…';` 留痕。
> 撤销管理员：`UPDATE users SET role='user' WHERE email='…' RETURNING id, email, role;`（同样核对 1 行）。
> **专用冒烟账号**（methods#10）：`smoke-admin@mhhao.com`（id `smoke-admin-001`，role=admin，密码默认锁空）。用时先置密：
> `UPDATE users SET password='<bcrypt hash>', "emailVerified"=now() WHERE email='smoke-admin@mhhao.com';`（生成 hash：`node -e "console.log(require('bcryptjs').hashSync('新密码',10))"`），用完务必 `UPDATE users SET password=NULL WHERE id='smoke-admin-001';` 锁回。

## 2. 环境变量

**Vercel（新增/确认）**：

| 变量 | 必要性 | 说明 |
| --- | --- | --- |
| `FAL_WEBHOOK_TOKEN_SECRET` | **必须新增** | FAL 回调验签，缺失则回调 401。生成：`openssl rand -hex 24`（本地 .env.local 已有，可复用同值） |
| `KIE_WEBHOOK_HMAC_KEY` | **必须确认** | fail-closed 已生效，缺失 Kie 图片回调全部 401 |
| `KIE_VEO_WEBHOOK_HMAC_KEY` | **必须确认** | 同上（Veo 视频回调） |
| `COMPOSE_PROVIDER` | 可选 | 不设=自托管合成；设 `fal` 回退旧云端合成 |
| `FFMPEG_PATH` | 可选 | 由 Trigger 构建扩展 `ffmpeg()`（apt 安装系统 ffmpeg）自动注入，无需手动设置 |
| `R2_*`（ACCESS_KEY/SECRET/ENDPOINT/BUCKET/PUBLIC_URL） | 确认 | 预签名下载依赖 |

**Trigger.dev**：环境变量与 Vercel 同步（尤其 `DATABASE_URL`、`KIE_API_KEY`、`R2_*`、`FAL_WEBHOOK_TOKEN_SECRET` 不需要——合成自托管不依赖 FAL）。

## 3. Trigger.dev 任务

```bash
npx trigger.dev@latest login   # 确认对 proj_hycyyzkdnebddnffoaak 有访问权（与 trigger.config.ts 一致）
npm run trigger:deploy         # 发布 compensate-missed-webhooks + compose-final-video + 原迁移任务
```

- [ ] 控制台 → Schedules → 为 `compensate-missed-webhooks` 添加 cron（每 10 分钟）
- [ ] 观察本次构建是否成功（ffmpeg 已由 `ffmpeg()` 构建扩展 apt 安装，无 ffmpeg-static postinstall 下载风险）

## 4. 代码部署（Vercel）

- [ ] 按第 0 节决策部署（PR 合入或连 fork）
- [ ] 构建日志确认无 ffmpeg 相关打包告警（ffmpeg 仅存在于 Trigger 任务侧，Vercel 不打包 ffmpeg）

## 5. 冒烟验证（部署后立即，按序）

| # | 检查 | 方式 | 通过标准 |
| --- | --- | --- | --- |
| 1 | 存活/就绪 | `curl https://<域名>/api/healthz` 和 `/api/readyz` | 均 200；readyz 含 `database: ok` |
| 2 | Kie 验签通过 | 真实账号跑一次"一句话→成片" | 能出片（=图片/视频回调未被 401 拦截） |
| 3 | 自托管合成 | 上一步的成片 | 任务日志出现 `[compose-final-video] 合成完成`；projectData.finalVideoUrl 是 R2 永久 URL |
| 4 | 埋点落库 | `SELECT stage, success, COUNT(*) FROM funnel_events GROUP BY 1, 2;` | 六阶段均有数据 |
| 5 | 预签名下载 | 前端下载一张已迁移资产，看响应 | `source: "r2-presigned"`、`expiresIn: 300` |
| 6 | 补偿任务 | 等 cron 首轮（或控制台手动 Run） | 日志 `扫描到 0 条`（或仅真实漏单）、无 401/异常 |
| 7 | Stripe claim | 测试模式下一笔积分购买（可选，或观察自然订单） | stripePayments 出现 pending→succeeded 记录，积分一次到账 |

## 6. 部署后 48h 观察项

```sql
-- 异常 pending 支付（claim-first 观察）
SELECT id, checkoutSessionId, paymentIntentId, createdAt FROM stripePayments
 WHERE paymentStatus = 'pending' AND createdAt < now() - interval '1 hour';

-- 降级链触发情况（V1 度量）
SELECT model, fallbackApplied, COUNT(*) FROM funnel_events
 WHERE stage = 'video' GROUP BY 1, 2;
```

- console 过滤 `[compensate-missed-webhooks]`（僵尸任务关闭告警）
- console 过滤 `降级生效`（模型降级触发）

## 7. 回退方式

| 对象 | 回退 |
| --- | --- |
| 代码 | Vercel redeploy 上一 Deployment（或 revert commit） |
| 合成 | `COMPOSE_PROVIDER=fal`（无需回代码） |
**域名/重定向故障速查（2026-08-30 实战）**：站点「重定向次数过多」时先看 308 的 `server` 头——`cloudflare` = CF Redirect Rule 在管（查 Rules 里通配匹配，删除或收紧到 Hostname equals 裸域）；`Vercel` = 项目主域设置在管（预期行为）。CF 与 Vercel 只留一层管跳转；CF 上的域名记录建议 DNS-only。另：新代码上线前迁移必须先行——注册路由等 `db.query.users` 关系型查询 SELECT 全列，生产库缺新列即 500（本次 0014 实证）。

| 迁移 0010 | `DROP INDEX IF EXISTS sp_payment_intent_unique, sp_checkout_session_unique;`（删除的数据用 Neon PITR 恢复） |
| 迁移 0011/0012 | `DROP TABLE IF EXISTS provider_routes / funnel_events;`（新表无旧依赖；router 会回落静态默认） |
| Kie 验签 | 无开关，配置正确密钥即恢复（代码层 fail-closed 不回退） |

## 8. 月度成本对账（非部署期，每月一次）

1. **Kie 账单校准**：控制台 Credits 页导出 xlsx → `python3 scripts/kie_cost_audit.py <账单.xlsx>`。
   把实测 $/s 回填 `lib/video-pricing.ts` 的 `MODEL_COST_BASIS_USD_PER_SECOND`（`verified: true`），
   跑 `npx vitest run lib/video-pricing.test.ts`——底线守卫测试会拦住击穿 100% 毛利规则的改价。
   重点盯：veo-3-1 的 8s 档 credits（若与 4s 同价则 Lite 成本减半，可降价）、
   seedance-2-5 实测（当前 0.23 为市价上限估计，实测后大概率可从 9 分/秒下调）。
2. **线上失败率与毛利**：管理员访问 `/api/admin/pricing-health?days=30`。
   带 `warning` 的模型：失败损耗 >1.7× → 换模型或上调底线倍率；预估毛利 <100% → 重订单价。
   注意：2026-08-28 之前的任务无 model 字段，归在 unknown 桶，新数据会自动归位。
