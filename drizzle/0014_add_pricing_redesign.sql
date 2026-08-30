-- 0014: 2026-08-30 定价重构（docs/pricing-redesign-2026-08.md）
-- users 表新增：注册 IP（防薅限速/聚类）、支付方式验证时间与卡指纹（一次性成片额度去重）
-- 幂等：重复执行安全。回滚：ALTER TABLE users DROP COLUMN IF EXISTS signup_ip; 等（列内无业务数据依赖）

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "signupIp" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cardVerifiedAt" TIMESTAMP;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cardFingerprint" TEXT;

-- 按 IP 限速查询与聚类监控走索引
CREATE INDEX IF NOT EXISTS users_signup_ip_created_idx ON "users" ("signupIp", "createdAt");
-- 卡指纹去重查询
CREATE INDEX IF NOT EXISTS users_card_fingerprint_idx ON "users" ("cardFingerprint");
