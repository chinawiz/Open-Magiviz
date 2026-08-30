-- 0015: 2026-08-30 管理后台 P0（docs/admin-plan.md）
-- 新表 admin_audit_logs（制度②写操作审计）+ users 封禁字段（用户级停用，getAuthedSession 统一拦截）
-- 幂等：重复执行安全。
-- 回滚：DROP TABLE IF EXISTS admin_audit_logs; ALTER TABLE users DROP COLUMN IF EXISTS "bannedAt", DROP COLUMN IF EXISTS "bannedReason";（审计表无业务依赖，历史审计数据删除前自行确认）

CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
  "id" TEXT PRIMARY KEY,
  "adminUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "ip" TEXT,
  "createdAt" TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aal_target_idx ON "admin_audit_logs" ("targetType", "targetId", "createdAt");
CREATE INDEX IF NOT EXISTS aal_admin_idx ON "admin_audit_logs" ("adminUserId", "createdAt");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bannedAt" TIMESTAMP;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bannedReason" TEXT;
