-- N1 基础漏斗埋点：创意→成片六阶段事件表（lib/observability/track.ts 写入）。
-- 2026-08-30 修订：标识符加双引号（与 drizzle schema 一致）——原版裸列名会被 PG 折叠成小写，
-- 全新环境执行会建出 userid/projectid 小写列，导致 drizzle 读写 "userId" 直接报错。
-- 已有正确大写列的库（生产）重跑本文件为 no-op（IF NOT EXISTS）。

CREATE TABLE IF NOT EXISTS funnel_events (
  "id" text PRIMARY KEY,
  "userId" text,
  "projectId" text,
  "stage" text NOT NULL,
  "success" boolean NOT NULL DEFAULT true,
  "durationMs" integer,
  "provider" text,
  "model" text,
  "fallbackApplied" boolean NOT NULL DEFAULT false,
  "taskId" text,
  "error" text,
  "createdAt" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fe_stage_created_idx ON funnel_events ("stage", "createdAt");
CREATE INDEX IF NOT EXISTS fe_project_idx ON funnel_events ("projectId");
CREATE INDEX IF NOT EXISTS fe_user_created_idx ON funnel_events ("userId", "createdAt");
