// OpenNext Cloudflare 适配配置
// 缓存：R2 增量缓存（ISR/SSG 页面缓存复用 + 静态资产二次缓存）
// https://opennext.js.org/cloudflare/caching
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
});
