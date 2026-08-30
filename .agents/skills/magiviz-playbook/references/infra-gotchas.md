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

## UI 组件与依赖账本

18. 本仓库曾**两套 toast 全都不渲染**：shadcn 的 `useToast()`（3 个消费者）依赖挂载 `<Toaster>`，sonner 的 `toast()`（7 个消费者）依赖挂载 sonner 自己的 `<Toaster>`——2026-08-28 清扫时发现全仓 0 处挂载，所有 toast 调用一直静默无效。教训：**"调用了 API"≠"UI 生效"，凡是需要 provider/挂载点的 UI 设施（toast、theme、session），验收必须走真实 GUI 流程**；从模板复制进来的 kit（50 个 ui 组件只有 19 个被用）要定期做消费者对账，不用的整件退役。2026-08-30 UI 审计后已修复：补建 `components/ui/toaster.tsx` 并在 `[locale]/layout.tsx` 同时挂载 shadcn 与 sonner 两个 Toaster——修复后支付成功/管理操作的 toast 才第一次真正可见。

21. **neon-http 驱动连不了本机 Postgres**（`ERR_INVALID_URL`→`api.0.0.1/sql`），且 drizzle-kit push 同病——本地回归要么用不到 DB，要么假空库。2026-08-30 起的解法：`lib/db.ts` 按 URL 判断本机地址回落 node-postgres（pg 为 devDependency、动态 import，生产零加载）；本地建库用 `psql -f drizzle/*.sql` 按序灌（drizzle/ 里有 kit 双胞胎历史文件，重复报错无碍，以最终 schema 为准）。本地回归金钱路径（注册闸门/限速）从此可行。
22. **重复锚点文本上做脚本化插入必翻车**：operate.tsx 的「检查是否是积分不足错误」出现在 3 个 handler，`s.find()` 命中第一处把块插进了角色图 handler（引用了不存在的外层变量）。教训：多锚点文件要么用「定位唯一兄弟锚（如 fetch URL 字面量）再找其后首个目标锚」的两段式定位，要么改完立刻 tsc（本次靠 tsc 抓回）。

19. **品牌主色亮度高（L≈74%）时，shadcn 模板默认的 `--primary-foreground: #FFF` 必挂 WCAG**：白字贴 #E6A37A 实测 2.12:1（正文要 4.5:1、大字要 3:1）。修 token 层一处（改成深色 #2C2B29，实测 6.66:1，与暗色模式既有写法一致）全站按钮同步生效，比逐组件改 class 便宜两个量级；但必须全局 grep 清掉硬编码 `text-white`/`hover:text-white` 的漏网点（本次抓到 hero CTA、定价 outline hover、offer 胶囊 text-primary 三类）。浅底上的品牌色文字用 peach-800 `#9D5E34`（白卡 5.14:1），不要用 peach-500/600。

20. **next-intl 的 `t() || "中文兜底"` 全是死代码**：缺键时 next-intl 直接抛错（或渲染键名），永远不会返回 falsy，`||` 后面的兜底给人虚假的安全感。本次清了 operate/library/upload 等十余处；**键是否缺失要用 `python3 -c` 直接查 messages/*.json 而不是看组件里有没有兜底**（本次定价区三个 `offer` 键 zh/en 双双缺失、线上渲染裸键名，就是这么抓到的）。另一个可迁移点：next-intl middleware 会把当前 locale 写进请求头 `x-next-intl-locale`，root layout 拿不到 `[locale]` params 时可以 `headers().get('x-next-intl-locale')` 在服务端输出 `<html lang>`——本次就用它修了全站无 lang 属性的问题。
