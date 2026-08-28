-- 0013: ai_generation_tasks 增加 model 列（按模型统计失败率/毛利，见 lib/pricing-health.ts）
-- 幂等：可重复执行
ALTER TABLE ai_generation_tasks ADD COLUMN IF NOT EXISTS model text;
CREATE INDEX IF NOT EXISTS ai_task_model_idx ON ai_generation_tasks (model);
