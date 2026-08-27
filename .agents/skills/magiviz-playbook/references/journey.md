# Journey —— 时间线、决策日志与当前快照

## 时间线（每个阶段 commit 可溯）

| 阶段 | 日期 | 关键提交 | 结果 |
|---|---|---|---|
| Fork 起点 | 2026-08-21 | `f82eb8b`（上游 ItusiAI 基线） | 项目骨架就绪 |
| 地基重构 | 2026-08-22~24 | `39636f4` `e80d312` | 类型系统收敛、API/LLM 公共层统一、operate.tsx 拆解 |
| 功能主批次 | 2026-08-25 | `953a1bc`(F11 计费口径) → `19836d8`(webhook 可靠性/安全) → `6a34072`(F2 供应商适配层) → `caad415`(F10 补偿任务) → `c157148`(POC) → `c692437`(自托管合成) → `276aabd`(T-05 预签名下载) → `579484c`(Stripe claim-first) → `42a63bf`(N1 漏斗埋点) → `69bd76b`(部署清单) | MVP 主线 F1–F11+N1 全部落地，43 vitest 保持全绿 |
| 部署期 | 2026-08-26 | `1340929`(锁文件) → `0705113`/`ff92f86`(Trigger CI) → `4e7de48`/`aeee1cd`(合成修复) → `02693d9`(presign 修复) | 生产管线六阶段端到端实测通过 |
| CF-Lite 原型 | 2026-08-26~27 | `20345e8`(OpenNext 脚手架) → `49c61a3`(R2 缓存) → `42a0274`(config 修正) → `23462d8`(cf-deploy CI) → `e5deec5`/`c24c8d5`(构建 env) | workerd 本地技术验证全通过，但免费版 3MiB 上限挡住 deploy → 宿主裁决 Vercel 留任 |
| 上线收口 | 2026-08-27 | `dd15776`(67 折残留文案清理) | **mhhao.com LIVE + SSL**，GUI 回归绿 |

## 决策日志

1. **$0 固定月费是硬约束**（贯穿全程）。它驱动了：拒绝 $5/mo Workers Paid、合成从 FAL 换成 Trigger.dev 自托管 ffmpeg、PG 停在 Neon 免费档、FAL 降为纯备选。任何基础设施提议先问「会不会引入固定月费」。
2. **正常轨道优先**（2026-08-25 拍板）：无审查供应商、本地 DGX Spark 全模型部署都进 backlog，不做就记方向结论（本地栈推荐清单已定，见会话记忆 local-deployment-plan），防止将来重新研究。
3. **平台整合终审（2026-08-27）**：Vercel 负责宿主，Cloudflare 只贡献 R2+DNS，Neon 免费 PG 无限期。CF-Lite 结论附带复活路径：升级 Workers Paid → 重跑 `.github/workflows/cf-deploy.yml`（secrets 已配好、缓存配置已在仓）。除非用户重启话题，不再重议宿主方案。
4. **计费口径统一先行**（F11）：配额收敛 `lib/plan-limits.ts`、视频单价收敛 `lib/video-pricing.ts`，之后所有扣费只认这两处。

## 当前快照（2026-08-27）

- 生产 https://mhhao.com LIVE（SSL）；全漏斗 e2e「一句话→成片」通过；live 域 GUI 回归绿（登录→首页→创作→zh/en）。
- 线上栈：Vercel `open-magiviz` + Neon ap-southeast-1 + CF R2 两桶 + Trigger.dev `proj_hycyyzkdnebddnffoaak`。
- 遗留待办（均不阻塞）：① `compensate-missed-webhooks` cron 尚未在 Trigger dashboard 排期；② Stripe 还是占位 key（支付不可用，填真 key 即活）；③ token 轮换候选：CF API token #2、Neon 密码（用户明确暂缓）、Trigger PAT/SecretKey、Kie/R2 key；④ ~~67 折 i18n 清理~~ 已由 `dd15776` 完成（当初 README 修了、messages/*.json 漏了，GUI 回归抓出来的）。
- 本快照应随进展**改写**，不是追加。

## 恢复主线时的既定顺序

showcase 链路加固（展示路径 presigned URL，私有桶前置）→ webhook-claim/降级链集成测试 → 待支付订单管理员对账视图 → 补偿任务全量 replay projectData → 完整版项（F12 编排汇总、F13 合并增长面板、基于 funnel_events 的 N1 管理面板、经 fal/OpenRouter 的跨供应商降级）。
