---
name: Prod DB transient "Authentication timed out" bursts
description: Prod background jobs occasionally all fail together with Postgres 08P01 "Authentication timed out"; treat as transient, design jobs with cause-unwrapping + short backoff retries.
---

# Prod DB transient auth-timeout bursts (08P01)

Production periodically has short bursts where MANY background jobs fail at once with `cause: error: Authentication timed out` (Postgres code 08P01), alongside ioredis `connect ETIMEDOUT` noise — a transient infra/connection blip, not schema drift. The same queries run clean minutes later and in dev.

**Why:** The Machine mismatch digest paged ops after such a burst; hours of diagnosis were wasted because Drizzle's `DrizzleQueryError.message` is only `Failed query: <sql>` — the real Postgres error rides on `err.cause` and was being dropped.

**How to apply:**
- When a prod-only "query failed" report arrives and dev runs clean, check the deployment log for a cluster of simultaneous job failures with `Authentication timed out` / ETIMEDOUT before suspecting drift.
- Any long-interval job should: unwrap the `err.cause` chain into its recorded reason (code + message), and retry failed runs on a short bounded backoff instead of waiting the full interval. Shared implementation: `interval-job-retry.ts` (`describeJobError`, `createRetryableIntervalJob`; per-job env `${PREFIX}_RETRY_BACKOFF_MS` / `${PREFIX}_MAX_RETRIES`, defaults 15 min / 3). The digest, pending-email, password-reset-attempts, upgrade-prompt-events, and ticket jobs already use it — wrap any NEW long-interval job in it rather than hand-rolling setInterval + catch.
