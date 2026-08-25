-- N1 基础漏斗埋点：创意→成片六阶段事件表（lib/observability/track.ts 写入）。

CREATE TABLE IF NOT EXISTS funnel_events (
  id text PRIMARY KEY,
  userId text,
  projectId text,
  stage text NOT NULL,
  success boolean NOT NULL DEFAULT true,
  durationMs integer,
  provider text,
  model text,
  fallbackApplied boolean NOT NULL DEFAULT false,
  taskId text,
  error text,
  createdAt timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fe_stage_created_idx ON funnel_events (stage, createdAt);
CREATE INDEX IF NOT EXISTS fe_project_idx ON funnel_events (projectId);
CREATE INDEX IF NOT EXISTS fe_user_created_idx ON funnel_events (userId, createdAt);
