-- Add AI Generation Tasks Table
-- This migration adds a table to track AI generation tasks (taskId and userId mapping)
-- This allows us to deduct points only when the task succeeds (via webhook callback)
--
-- This migration is safe to run on existing databases and will not affect existing data.
-- 2026-08-30 修订：补齐 projectId/versionId/itemId/versionGroupId/new_version_id 五列与索引——
-- 这些列当年经 drizzle-kit push 直推上线、从未进入本迁移文件，按本文件新建的库（本地回归）
-- 缺列导致 webhook/后台查询 500。全部幂等：生产重跑为 no-op。

CREATE TABLE IF NOT EXISTS "ai_generation_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"taskId" text NOT NULL UNIQUE,
	"userId" text NOT NULL,
	"taskType" text NOT NULL,
	"pointsDeducted" boolean DEFAULT false NOT NULL,
	"pointsAmount" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"projectId" text,
	"versionId" text,
	"itemId" text,
	"version_group_id" text,
	"new_version_id" text,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	CONSTRAINT "ai_generation_tasks_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);

-- 已存在的库补齐后加的列（含 model，0013 之前的 push 遗留也在此兜底）
ALTER TABLE "ai_generation_tasks" ADD COLUMN IF NOT EXISTS "model" text;
ALTER TABLE "ai_generation_tasks" ADD COLUMN IF NOT EXISTS "projectId" text;
ALTER TABLE "ai_generation_tasks" ADD COLUMN IF NOT EXISTS "versionId" text;
ALTER TABLE "ai_generation_tasks" ADD COLUMN IF NOT EXISTS "itemId" text;
ALTER TABLE "ai_generation_tasks" ADD COLUMN IF NOT EXISTS "version_group_id" text;
ALTER TABLE "ai_generation_tasks" ADD COLUMN IF NOT EXISTS "new_version_id" text;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS "ai_task_task_id_idx" ON "ai_generation_tasks"("taskId");
CREATE INDEX IF NOT EXISTS "ai_task_user_id_idx" ON "ai_generation_tasks"("userId");
CREATE INDEX IF NOT EXISTS "ai_task_status_idx" ON "ai_generation_tasks"("status");
CREATE INDEX IF NOT EXISTS "ai_task_project_id_idx" ON "ai_generation_tasks"("projectId");
CREATE INDEX IF NOT EXISTS "ai_task_version_id_idx" ON "ai_generation_tasks"("versionId");
CREATE INDEX IF NOT EXISTS "ai_task_version_group_id_idx" ON "ai_generation_tasks"("version_group_id");
