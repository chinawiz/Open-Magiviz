-- 自建端点（ADR-0001）：一期 capability 限 script/image（文本两步 + 图像走 OpenAI 兼容统一契约），视频二期。
-- endpoint 启用行是「该 capability 自建生效」的唯一事实源；provider_routes 的 region='local'
-- 行由 lib/providers/endpoints.ts 的 sync 函数联动维护（本迁移不 seed 端点）。
-- baseUrl 约定包含到 /v1（如 http://dgx:8000/v1）。

CREATE TABLE IF NOT EXISTS self_hosted_endpoints (
  "id" text PRIMARY KEY,
  "capability" text NOT NULL,
  "protocol" text NOT NULL,
  "baseUrl" text NOT NULL,
  "apiKey" text NOT NULL,
  "modelId" text NOT NULL,
  "timeoutMs" integer NOT NULL DEFAULT 60000,
  "enabled" boolean NOT NULL DEFAULT true,
  "lastTestAt" timestamptz,
  "lastTestOk" boolean,
  "note" text,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now()
);

-- 每 capability 至多一条启用端点（全量切语义；禁用行不受限）
CREATE UNIQUE INDEX IF NOT EXISTS self_hosted_endpoints_cap_enabled
  ON self_hosted_endpoints ("capability")
  WHERE enabled = true;
