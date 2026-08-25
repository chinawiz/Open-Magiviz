-- F2/M2 供应商适配层：provider_routes 路由表（设计 §4.2.9 修正版落地）。
-- 按 capability 分组的有序供应商列表；priority=0 为 primary，降级顺序按 priority 升序。
-- region 为 IC-01 预留插拔位（当前仅 overseas；'local' 预留自托管推理节点，未启用）。

CREATE TABLE IF NOT EXISTS provider_routes (
  id text PRIMARY KEY,
  capability text NOT NULL,
  provider text NOT NULL,
  modelKey text,
  region text NOT NULL DEFAULT 'overseas',
  priority integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  configVersion text NOT NULL DEFAULT 'v1',
  createdAt timestamptz DEFAULT now(),
  updatedAt timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_routes_cap_region_pri
  ON provider_routes (capability, region, priority)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS provider_routes_cap_region
  ON provider_routes (capability, region);

-- 默认路由 seed（与 lib/providers/router.ts 静态默认一致；幂等插入）
INSERT INTO provider_routes (id, capability, provider, modelKey, region, priority) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'script',  'zenmux', 'google/gemini-3-flash-preview', 'overseas', 0),
  ('a1000000-0000-4000-8000-000000000002', 'image',   'kieai',  'nano-banana-2',                 'overseas', 0),
  ('a1000000-0000-4000-8000-000000000003', 'video',   'kieai',  NULL,                            'overseas', 0),
  ('a1000000-0000-4000-8000-000000000004', 'compose', 'fal',    NULL,                            'overseas', 0)
ON CONFLICT DO NOTHING;
