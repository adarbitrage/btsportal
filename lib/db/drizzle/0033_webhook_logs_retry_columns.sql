ALTER TABLE "webhook_logs" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "webhook_logs" ADD COLUMN IF NOT EXISTS "last_attempt_at" timestamp with time zone;
ALTER TABLE "webhook_logs" ADD COLUMN IF NOT EXISTS "next_retry_at" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "webhook_logs_retry_idx"
  ON "webhook_logs" ("event_type", "status", "next_retry_at")
  WHERE "status" = 'failed' AND "result" IS NULL;
