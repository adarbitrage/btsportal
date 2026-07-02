---
name: Billing dead-man's-switch + money-endpoint rate limiter
description: Why billing job heartbeat lives in Postgres (not Redis), how the digest prevents duplicate sends, why billing limiters must fail CLOSED, and the test-env gotcha that neutralizes them.
---

# Billing dead-man's-switch + money-endpoint rate limiter

## Heartbeat & digest live in Postgres, scheduled by setInterval — NOT Redis/BullMQ
The renewal charger stamps `billing_ops_heartbeat` (name="charger") in Postgres on
every `processDueRenewals()`. The daily digest reads that row to report "charger
last ran X / stalled N h" and is the dead-man's-switch: no digest email ⇒ scheduler
is down.

**Why not Redis:** the failure being guarded against is Redis/BullMQ dying. A
Redis-stored heartbeat or a BullMQ-scheduled digest would die exactly when it needs
to fire. So heartbeat = Postgres, digest schedule = in-process `setInterval`.

**Duplicate-send prevention (every web replica runs the timer):** `claimDigestRun(minIntervalMs)`
in billing-heartbeat.ts — insert-if-missing (`onConflictDoNothing ... returning`),
else conditional `UPDATE ... WHERE last_run_at < cutoff RETURNING`. Only the row-lock
winner sends. `releaseDigestClaim()` resets `last_run_at` to epoch on send failure so
the next tick retries. Manual/test triggers pass `{force:true}` to bypass the claim.
`minIntervalMs` is set slightly BELOW the schedule interval so clock jitter across
replicas never skips a legit period.

**Residual risk (stated in the digest email footer):** timer+claim survive a Redis
outage but NOT a full outage of the web process/host — if that's down, digest AND
charger go silent together. External uptime monitoring is the only cover.

**Reconciliation count** comes from `checkout_idempotency.result->>'outcomeType' =
'paid_reconciliation_needed'` (the durable JSONB trace) — NEVER query `bts_orders`
by that status; it is never persisted on the order row.

## Heartbeat must survive a failed run; digest reports a TRUE 24 h count
- **Stamp the heartbeat in a `finally`, not only on success:** a charger run that
  THREW must still update the last-run timestamp. **Why:** the dead-man's-switch
  is meant to fire on "the scheduler never ran" — a failed run DID run, and its
  failure is escalated on its own channel (below). Skipping the stamp on a thrown
  run would make a persistently-failing charger look healthy.
- **The daily digest must report a trailing-24 h run count, not the lifetime
  total:** the monotonic run counter is meaningless in a daily summary. Keep a
  rolling, self-pruning log of recent run timestamps and derive the trailing-day
  count from it; the lifetime total is at most a secondary line.
- **Worker failures page on-call** via a fire-and-forget billing alert with a
  SINGLE dedup key, so a persistently-failing charger alerts once per throttle
  window instead of on every tick.

## Money-endpoint rate limiters MUST fail CLOSED
`abuseRateLimit` (the shared limiter) fails OPEN twice: it `next()`s when
`getRedis()` is null (REDIS_URL unset) AND its `.catch` swallows Redis operation
errors and `next()`s (Redis configured-but-down). For billing/checkout endpoints
that means an attacker who knocks Redis over also strips all throttling.

`billing-rate-limit.ts` therefore does NOT delegate to `abuseRateLimit`. It runs the
Redis sorted-set sliding window itself (same `abuse-rate:*` keys) and, on BOTH a null
client AND any Redis op rejection, falls back to a BOUNDED in-memory per-process
sliding window (LRU-evicted at `MEM_MAX_KEYS`) + a throttled loud `console.error`.
Never a no-op. **How to apply:** any new money endpoint limiter must go through this
self-contained fallback, not `abuseRateLimit`.

## Test gotcha: neutralize billing limiters via env, not a store reset
Billing test files `vi.mock("../lib/redis", () => ({ getRedis: () => null }))`, so the
in-memory fallback engages; all requests share IP 127.0.0.1, so a single test file's
requests exceed the per-IP default (20/10min) and unrelated assertions get 429s.

A shared `beforeEach` that clears the in-memory Map does NOT work: `vi.mock`
re-evaluates the middleware per test file, so the setup file's imported module
instance is a DIFFERENT one than the app uses — the reset touches the wrong Map.
**Fix:** `src/test-setup.ts` (wired via vitest `setupFiles`) raises
`BILLING_RATE_LIMIT_USER_MAX`/`IP_MAX` in `process.env`. Limits are read live at
request time by every instance, so this is instance-independent. No billing test
asserts a 429 from these limiters.
