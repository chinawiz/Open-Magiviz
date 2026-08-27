# Infra Gotchas —— 部署、构建、存储与数据库的坑

每条都付过学费，动对应领域前先扫一遍。格式：场景 → 解法（已验证）→ 锚点。

## 域名与入口

1. `vercel domains add` 只是声明所有权，**不会**把域名挂到项目上——必须再 `vercel alias set <deployment> mhhao.com`，SSL 证书随后约 12s 自动签发。（2026-08-27 实测）
2. 本机代理 fake-ip DNS（解析出 198.18.x.x）会让你误判域名没生效——用 `curl --resolve mhhao.com:443:76.76.21.21` 绕开本地 DNS 验证。
3. 生产域名三件套 `NEXTAUTH_URL` / `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_BASE_URL` 必须同时指向最终域名；换域时三处一起改，漏一处会出现回调/跳转指向旧地址。

## 包管理与构建

4. 一个 92 字节的占位 `pnpm-lock.yaml` 会让 Vercel 误判包管理器导致构建失败——删掉陈旧锁文件即可。本仓库实际用 npm + package-lock.json。（`1340929`）
5. **Next.js build 时模块顶层就会求值**：Stripe 构造函数在 import 时就执行 → CI 构建环境必须提供 `DATABASE_URL`/Kie/R2 等值（可以是占位值）（`e5deec5`、`c24c8d5`）。教训：「构建不需要连接外部」在这个代码库里不成立，新增顶层初始化的外部 SDK 时要想到 build 环境。
6. `next.config.mjs` 里不要动态 `import('@opennextjs/cloudflare')`：一旦 devDependency 被 prune，普通 Vercel 构建直接 ERR_MODULE_NOT_FOUND。CF 专属配置放在 CF 的构建流程里注入，不放在共享 config 里。（`42a0274`）

## CI 与网络

7. depot（gRPC）和 `wrangler deploy` 在本机网络下协议级被掐断，TUN/代理都救不了——**这类平台部署一律搬进 GitHub Actions**（`.github/workflows/trigger-deploy.yml`、`cf-deploy.yml`，手动 dispatch）。通用法则：遇到「本地部署第三方平台反复失败」，第一时间改走 CI，不要跟本机网络较劲。
8. Trigger.dev 部署鉴权：能用的是 Personal Access Token（`tr_pat_…`）；`tr_dev_…` 环境 token 会报 "must login first"。SDK 版本要与 CI CLI 版本对齐（一度升到 4.5.12）。
9. `syncEnvVars` 扩展在 CI 模式下并没有真正同步环境变量——**Trigger 平台的运行时变量以 Dashboard 手工配置为准**。Vercel 侧运行时触发另需 `TRIGGER_SECRET_KEY`。

## Trigger.dev 与合成任务

10. 症状「ffmpeg 退出码 null」= ffmpeg-static 二进制根本不存在（npm install-scripts allowlist 拦掉了 postinstall）→ 改用官方 `ffmpeg()` build extension（apt 装 ffmpeg + 自动导出 FFMPEG_PATH，import 自 `@trigger.dev/build/extensions/core`），ffmpeg-static 移除。（`4e7de48`）
11. 免费小机型上合成 OOM（`TASK_PROCESS_OOM_KILLED`）三板斧：流式下载/上传替代内存 Buffer、ffmpeg 加 `-threads 2` + `veryfast`、机器档设 `medium-1x`（注意裸字符串 "medium" 过不了 TS 类型）。medium-1x 消耗更多 compute credits，是拿钱换稳定的明账。（`aeee1cd`）
12. CF 免费版 Worker 尺寸上限 3MiB：OpenNext 打包（Stripe+AWS SDK+全路由）超限后 `wrangler deploy` 直接拒绝，哪怕本地 workerd 全链路都验证通过了。教训：**尺寸/配额类硬限制只有真 deploy 才暴露，原型流程里要尽早 deploy 一次小版本**。

## R2 存储

13. aws-sdk v3.723+ 默认把 CRC 校验头纳入 SigV4 签名，R2 端报 SignatureDoesNotMatch（Vercel 与 workerd 双端同病）→ 设 `requestChecksumCalculation/responseChecksumValidation: 'WHEN_REQUIRED'`，在 `lib/r2-presign.ts`。（`02693d9`）背后的教训更大：T-05 当初只测了 403 拒绝路径就上了线，正向路径直到生产才炸——**资源的正、反两条路径都必须真实连通过才算完成**。
14. R2 token 的 secret 只在创建那一刻显示一次，401 时应重新生成而不是反复复制旧值；权限选 Object Read & Write 即够用（PutObject 上传、GetObject presign、HeadObject）。
15. ISR 增量缓存桶 `open-magiviz-cache` 通过绑定 `NEXT_INC_CACHE_R2_BUCKET` 接入（`49c61a3`），属 CF-Lite 遗产，宿主留在 Vercel 时不起作用，复活 CF 路径时才激活。

## 数据库（Neon PG）

16. drizzle 建出的列名是 camelCase（如 `"taskId"`、`"projectId"`），手写 SQL 查询必须加双引号，否则全变小写找不到列。
17. 生产 DB 快速核查的成熟模式：一次性子命令小工具（如 `/tmp/mgv.mjs`，subcommand task/projver/user/...），其中 neon 包要用**默认导入**再解构——CJS 包的 named export 会翻车。
