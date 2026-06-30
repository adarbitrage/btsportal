-- NMI Tier 6.2b: add next_retry_at column + index to subscriptions table.
-- Additive, nullable — safe to run against an already-migrated database.
-- Cleared (set to NULL) on recovery or final failure; populated when the
-- dunning state machine arms the +3d/+7d retry schedule.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS subscriptions_next_retry_at_idx
  ON subscriptions (next_retry_at);
