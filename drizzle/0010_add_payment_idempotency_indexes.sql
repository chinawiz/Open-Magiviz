-- 幂等加固（F10/V2）：为 stripePayments 增加支付意向/结账会话唯一索引。
-- webhook 处理器已有应用层查重（先查后插），唯一索引作为并发窗口的最终防线，
-- 防止 Stripe 重复投递同一事件时产生重复支付记录/重复发放积分。
-- 若存量数据存在历史重复，先保留最早一条再建索引。

-- 1) 清理 paymentIntentId 重复（保留最早记录）
DELETE FROM "stripePayments" a
USING "stripePayments" b
WHERE a."paymentIntentId" IS NOT NULL
  AND a."paymentIntentId" = b."paymentIntentId"
  AND (COALESCE(a."createdAt", TIMESTAMPTZ 'epoch'), a."id") > (COALESCE(b."createdAt", TIMESTAMPTZ 'epoch'), b."id");

-- 2) 清理 checkoutSessionId 重复（保留最早记录）
DELETE FROM "stripePayments" a
USING "stripePayments" b
WHERE a."checkoutSessionId" IS NOT NULL
  AND a."checkoutSessionId" = b."checkoutSessionId"
  AND (COALESCE(a."createdAt", TIMESTAMPTZ 'epoch'), a."id") > (COALESCE(b."createdAt", TIMESTAMPTZ 'epoch'), b."id");

-- 3) 唯一索引（Postgres 唯一索引允许多个 NULL，无需部分谓词）
CREATE UNIQUE INDEX IF NOT EXISTS "sp_payment_intent_unique"
  ON "stripePayments" ("paymentIntentId");

CREATE UNIQUE INDEX IF NOT EXISTS "sp_checkout_session_unique"
  ON "stripePayments" ("checkoutSessionId");
