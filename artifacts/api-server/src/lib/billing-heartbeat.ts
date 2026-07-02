/**
 * DB-backed heartbeat for billing background jobs (Task #1572).
 *
 * The renewal charger and the daily billing digest both record their liveness
 * here, in Postgres, rather than in Redis. This is intentional: the failure we
 * are guarding against is Redis (and BullMQ, which rides on it) dying. A
 * Redis-stored heartbeat would die with it, so the dead-man's-switch would fail
 * silent exactly when it matters. Keeping the heartbeat in the primary DB means
 * the digest can still truthfully report "the charger last ran at X / has not
 * run in N hours" during a full Redis outage.
 *
 * Two named rows:
 *   - "charger": stamped by `recordChargerRun()` on every processDueRenewals()
 *     invocation (including idempotency replays — safe).
 *   - "digest":  claimed atomically by `claimDigestRun()` so that when every web
 *     replica runs the in-process setInterval digest scheduler, only ONE of them
 *     actually sends the email per period.
 */

import { db, billingOpsHeartbeatTable } from "@workspace/db";
import { and, eq, lt, sql } from "drizzle-orm";

const CHARGER = "charger";
const DIGEST = "digest";

/**
 * How long a run timestamp is retained in the rolling `recent_runs` log. Kept
 * at 48 h (a little over the 24 h the digest reports) so a slightly late digest
 * still sees a full trailing day, while the buffer stays tiny (~1 stamp/hour).
 */
const RUN_LOG_RETENTION_MS = 48 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Stamp the renewal-charger heartbeat. Call on every processDueRenewals() run.
 * Upserts last_run_at = now, increments the monotonic run counter, and appends
 * this run's timestamp to the rolling `recent_runs` log (pruning anything older
 * than the retention window) so the digest can report a true 24 h run count.
 *
 * The append + prune is done in a single SQL expression against the row's
 * current value, so it is atomic and immune to read-modify-write races even if
 * two runs ever overlap.
 */
export async function recordChargerRun(): Promise<void> {
  const now = new Date();
  const nowMs = now.getTime();
  const cutoffMs = nowMs - RUN_LOG_RETENTION_MS;
  await db
    .insert(billingOpsHeartbeatTable)
    .values({ name: CHARGER, lastRunAt: now, runCount: 1, recentRuns: [nowMs], updatedAt: now })
    .onConflictDoUpdate({
      target: billingOpsHeartbeatTable.name,
      set: {
        lastRunAt: now,
        runCount: sql`${billingOpsHeartbeatTable.runCount} + 1`,
        recentRuns: sql`(
          SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
          FROM jsonb_array_elements(
            ${billingOpsHeartbeatTable.recentRuns} || to_jsonb(${nowMs}::bigint)
          ) AS elem
          WHERE (elem::text)::bigint > ${cutoffMs}
        )`,
        updatedAt: now,
      },
    });
}

export interface ChargerHeartbeat {
  lastRunAt: Date | null;
  runCount: number;
  /** Distinct charger runs recorded in the trailing 24 h (from `recent_runs`). */
  runsLast24h: number;
}

/** Read the renewal-charger heartbeat (last run + lifetime + trailing-24 h count). */
export async function getChargerHeartbeat(): Promise<ChargerHeartbeat> {
  const rows = await db
    .select({
      lastRunAt: billingOpsHeartbeatTable.lastRunAt,
      runCount: billingOpsHeartbeatTable.runCount,
      recentRuns: billingOpsHeartbeatTable.recentRuns,
    })
    .from(billingOpsHeartbeatTable)
    .where(eq(billingOpsHeartbeatTable.name, CHARGER))
    .limit(1);
  const row = rows[0];
  const cutoff24 = Date.now() - DAY_MS;
  const recent = Array.isArray(row?.recentRuns) ? row.recentRuns : [];
  const runsLast24h = recent.filter(
    (t): t is number => typeof t === "number" && t > cutoff24,
  ).length;
  return {
    lastRunAt: row?.lastRunAt ?? null,
    runCount: row?.runCount ?? 0,
    runsLast24h,
  };
}

/**
 * Atomically claim the right to send this period's digest.
 *
 * Returns true only for the single process/tick that wins the claim within
 * `minIntervalMs`. This is the DB-guarded duplicate prevention that lets the
 * digest be scheduled by an in-process setInterval in every web replica without
 * emailing N copies: the winning UPDATE ... WHERE last_run_at < cutoff RETURNING
 * takes a row lock, and any concurrent claimant re-evaluates the WHERE against
 * the freshly-stamped row and matches nothing.
 */
export async function claimDigestRun(minIntervalMs: number): Promise<boolean> {
  const now = Date.now();
  const cutoff = new Date(now - minIntervalMs);

  // First-ever run: insert if missing. If it already exists this no-ops and we
  // fall through to the conditional update below.
  const inserted = await db
    .insert(billingOpsHeartbeatTable)
    .values({ name: DIGEST, lastRunAt: new Date(now), runCount: 1, updatedAt: new Date(now) })
    .onConflictDoNothing({ target: billingOpsHeartbeatTable.name })
    .returning({ id: billingOpsHeartbeatTable.id });
  if (inserted.length > 0) return true;

  const claimed = await db
    .update(billingOpsHeartbeatTable)
    .set({
      lastRunAt: new Date(now),
      runCount: sql`${billingOpsHeartbeatTable.runCount} + 1`,
      updatedAt: new Date(now),
    })
    .where(
      and(
        eq(billingOpsHeartbeatTable.name, DIGEST),
        lt(billingOpsHeartbeatTable.lastRunAt, cutoff),
      ),
    )
    .returning({ id: billingOpsHeartbeatTable.id });
  return claimed.length > 0;
}

/**
 * Release a digest claim after a send failure so the next scheduler tick can
 * retry instead of the failed period being silently swallowed. Best-effort:
 * resets last_run_at to the epoch so the next claimDigestRun() succeeds.
 */
export async function releaseDigestClaim(): Promise<void> {
  await db
    .update(billingOpsHeartbeatTable)
    .set({ lastRunAt: new Date(0), updatedAt: new Date() })
    .where(eq(billingOpsHeartbeatTable.name, DIGEST));
}
