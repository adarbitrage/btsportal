-- Durable history of every completed `runAbuseRateLimitCleanup` invocation,
-- both successful and failed. Lets the "Trimmed per run" sparkline on the
-- System Health page survive an API server restart (deploy, crash, scale
-- event) instead of resetting to an empty chart until ~24h of sweeps land.
--
-- Idempotent so it is safe to re-run against a database that already has
-- the table (e.g. created via `drizzle-kit push`).
CREATE TABLE IF NOT EXISTS "abuse_rate_limit_cleanup_runs" (
    "id" serial PRIMARY KEY NOT NULL,
    "ran_at" timestamp with time zone DEFAULT now() NOT NULL,
    "scanned" integer DEFAULT 0 NOT NULL,
    "trimmed" integer DEFAULT 0 NOT NULL,
    "deleted" integer DEFAULT 0 NOT NULL,
    "error_message" text
);

CREATE INDEX IF NOT EXISTS "abuse_rate_limit_cleanup_runs_ran_at_idx"
    ON "abuse_rate_limit_cleanup_runs" ("ran_at");
