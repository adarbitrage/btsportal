ALTER TABLE "webhook_logs" ADD COLUMN IF NOT EXISTS "alert_sent_at" timestamp with time zone;
ALTER TABLE "webhook_logs" ADD COLUMN IF NOT EXISTS "alert_claimed_at" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "webhook_logs_exhausted_unalerted_idx"
  ON "webhook_logs" ("event_type", "attempts")
  WHERE "status" = 'failed' AND "result" IS NULL AND "alert_sent_at" IS NULL;
