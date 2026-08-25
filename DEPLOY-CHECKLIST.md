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
```

## 2. 环境变量

**Vercel（新增/确认）**：

| 变量 | 必要性 | 说明 |
| --- | --- | --- |
| `FAL_WEBHOOK_TOKEN_SECRET` | **必须新增** | FAL 回调验签，缺失则回调 401。生成：`openssl rand -hex 24`（本地 .env.local 已有，可复用同值） |
| `KIE_WEBHOOK_HMAC_KEY` | **必须确认** | fail-closed 已生效，缺失 Kie 图片回调全部 401 |
| `KIE_VEO_WEBHOOK_HMAC_KEY` | **必须确认** | 同上（Veo 视频回调） |
| `COMPOSE_PROVIDER` | 可选 | 不设=自托管合成；设 `fal` 回退旧云端合成 |
| `FFMPEG_PATH` | 可选 | ffmpeg-static 在 Trigger 构建装不上时，指向容器自带 ffmpeg |
| `R2_*`（ACCESS_KEY/SECRET/ENDPOINT/BUCKET/PUBLIC_URL） | 确认 | 预签名下载依赖 |

**Trigger.dev**：环境变量与 Vercel 同步（尤其 `DATABASE_URL`、`KIE_API_KEY`、`R2_*`、`FAL_WEBHOOK_TOKEN_SECRET` 不需要——合成自托管不依赖 FAL）。

## 3. Trigger.dev 任务

```bash
npx trigger.dev@latest login   # 确认对 proj_piecdozsbqpancgoyqxc 有访问权
npm run trigger:deploy         # 发布 compensate-missed-webhooks + compose-final-video + 原迁移任务
```

- [ ] 控制台 → Schedules → 为 `compensate-missed-webhooks` 添加 cron（每 10 分钟）
- [ ] 观察本次构建是否成功（**风险点：ffmpeg-static postinstall**；失败则设 `FFMPEG_PATH` 后重部署）

## 4. 代码部署（Vercel）

- [ ] 按第 0 节决策部署（PR 合入或连 fork）
- [ ] 构建日志确认无 ffmpeg-static 打包告警（已配 serverExternalPackages）

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
| 迁移 0010 | `DROP INDEX IF EXISTS sp_payment_intent_unique, sp_checkout_session_unique;`（删除的数据用 Neon PITR 恢复） |
| 迁移 0011/0012 | `DROP TABLE IF EXISTS provider_routes / funnel_events;`（新表无旧依赖；router 会回落静态默认） |
| Kie 验签 | 无开关，配置正确密钥即恢复（代码层 fail-closed 不回退） |
