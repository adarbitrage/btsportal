/**
 * Background retry job for failed YSE grant deliveries.
 *
 * Why this exists: when `/api/integrations/grant-product` fails (network
 * blip mid-transaction, transient DB lock, GHL side-effect crash, etc.)
 * the caller has already accepted payment for the customer. Leaving that
 * grant un-retried means a paying customer with no portal access — the
 * exact outage this job prevents.
 *
 * Strategy: `external-grant-product.ts` upserts a row into `webhook_logs`
 * on every failure with `status='failed'`, `result IS NULL`, an attempts
 * counter, and a `next_retry_at` set per exponential-backoff schedule.
 * This job sweeps the table on an interval and replays
 * `handleExternalGrantProduct` for any row whose backoff has elapsed and
 * which is still under `YSE_GRANT_MAX_ATTEMPTS`. On success, that same
 * helper writes status='processed' + result, so the row will no longer
 * match the sweep query — i.e. the job is naturally idempotent.
 */

import { db, webhookLogsTable } from "@workspace/db";
import { and, eq, isNull, lte, or, sql, desc } from "drizzle-orm";
import {
  handleExternalGrantProduct,
  redactPii,
  YSE_GRANT_EVENT_TYPE,
  YSE_GRANT_MAX_ATTEMPTS,
  type ExternalGrantPayload,
} from "./external-grant-product";

const RUN_INTERVAL_MS = 60_000;
const BATCH_SIZE = 25;

interface RetryJobState {
  lastRanAt: Date | null;
  lastSucceeded: number;
  lastFailed: number;
  lastError: { at: Date; message: string } | null;
}

const state: RetryJobState = {
  lastRanAt: null,
  lastSucceeded: 0,
  lastFailed: 0,
  lastError: null,
};

export interface RetrySweepResult {
  picked: number;
  succeeded: number;
  failed: number;
}

/**
 * Run one sweep of the retry queue. Returns counts for tests and
 * observability. Each row is attempted independently so a poison payload
 * cannot starve the others in the same batch.
 */
export async function runYseGrantRetrySweep(): Promise<RetrySweepResult> {
  const now = new Date();
  const rows = await db
    .select({
      id: webhookLogsTable.id,
      externalId: webhookLogsTable.externalId,
      payload: webhookLogsTable.payload,
      attempts: webhookLogsTable.attempts,
    })
    .from(webhookLogsTable)
    .where(
      and(
        eq(webhookLogsTable.eventType, YSE_GRANT_EVENT_TYPE),
        eq(webhookLogsTable.status, "failed"),
        isNull(webhookLogsTable.result),
        sql`${webhookLogsTable.attempts} < ${YSE_GRANT_MAX_ATTEMPTS}`,
        or(
          isNull(webhookLogsTable.nextRetryAt),
          lte(webhookLogsTable.nextRetryAt, now),
        ),
      ),
    )
    .orderBy(webhookLogsTable.nextRetryAt)
    .limit(BATCH_SIZE);

  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    const payload = row.payload as unknown as ExternalGrantPayload;
    if (!payload || typeof payload !== "object" || !payload.externalOrderId) {
      // Defensive: a malformed payload would loop forever otherwise.
      // Mark it terminal by pushing attempts to the cap.
      await db
        .update(webhookLogsTable)
        .set({
          attempts: YSE_GRANT_MAX_ATTEMPTS,
          errorMessage: "Retry skipped: payload missing externalOrderId",
          nextRetryAt: null,
          lastAttemptAt: new Date(),
        })
        .where(eq(webhookLogsTable.id, row.id));
      failed++;
      continue;
    }

    try {
      const result = await handleExternalGrantProduct(payload);
      if ("code" in result && result.code === "UNKNOWN_SLUGS") {
        // Unknown slugs are a payload problem the retry job cannot fix.
        // Mark terminal so we stop retrying.
        await db
          .update(webhookLogsTable)
          .set({
            attempts: YSE_GRANT_MAX_ATTEMPTS,
            errorMessage: `Retry skipped: unknown product slugs: ${result.unknownSlugs.join(", ")}`,
            nextRetryAt: null,
            lastAttemptAt: new Date(),
          })
          .where(eq(webhookLogsTable.id, row.id));
        failed++;
        continue;
      }
      succeeded++;
      console.log(
        `[YseGrantRetry] Replay succeeded for externalId=${row.externalId} (attempts=${row.attempts + 1})`,
      );
    } catch (err) {
      // handleExternalGrantProduct's own catch already upserted the
      // failed row with an incremented attempts counter and the next
      // backoff window, so we just count it here.
      failed++;
      console.error(
        `[YseGrantRetry] Replay failed for externalId=${row.externalId}: ${redactPii(err)}`,
      );
    }
  }

  state.lastRanAt = new Date();
  state.lastSucceeded = succeeded;
  state.lastFailed = failed;
  state.lastError = null;

  return { picked: rows.length, succeeded, failed };
}

export interface PendingFailedGrant {
  id: number;
  externalId: string;
  attempts: number;
  maxAttempts: number;
  status: string;
  errorMessage: string | null;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  createdAt: string;
  customerEmail: string | null;
  externalOrderId: string | null;
  externalSource: string | null;
  productSlugs: string[];
  terminal: boolean;
  payloadPreview: string;
}

/**
 * List YSE grants that are not yet successfully delivered. Powers the
 * admin "pending/failed deliveries" surface so on-call can see exactly
 * which paying customers are still without portal access.
 */
export async function listPendingFailedYseGrants(
  limit = 100,
): Promise<PendingFailedGrant[]> {
  const rows = await db
    .select({
      id: webhookLogsTable.id,
      externalId: webhookLogsTable.externalId,
      attempts: webhookLogsTable.attempts,
      status: webhookLogsTable.status,
      errorMessage: webhookLogsTable.errorMessage,
      lastAttemptAt: webhookLogsTable.lastAttemptAt,
      nextRetryAt: webhookLogsTable.nextRetryAt,
      createdAt: webhookLogsTable.createdAt,
      payload: webhookLogsTable.payload,
      result: webhookLogsTable.result,
    })
    .from(webhookLogsTable)
    .where(
      and(
        eq(webhookLogsTable.eventType, YSE_GRANT_EVENT_TYPE),
        isNull(webhookLogsTable.result),
      ),
    )
    .orderBy(desc(webhookLogsTable.createdAt))
    .limit(Math.min(500, Math.max(1, limit)));

  return rows.map((r) => {
    const p = (r.payload ?? {}) as Partial<ExternalGrantPayload> & {
      customer?: { email?: string };
    };
    return {
      id: r.id,
      externalId: r.externalId,
      attempts: r.attempts,
      maxAttempts: YSE_GRANT_MAX_ATTEMPTS,
      status: r.status,
      errorMessage: r.errorMessage,
      lastAttemptAt: r.lastAttemptAt ? r.lastAttemptAt.toISOString() : null,
      nextRetryAt: r.nextRetryAt ? r.nextRetryAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      customerEmail: p.customer?.email ?? null,
      externalOrderId: p.externalOrderId ?? null,
      externalSource: p.externalSource ?? null,
      productSlugs: Array.isArray(p.productSlugs) ? p.productSlugs : [],
      terminal: r.attempts >= YSE_GRANT_MAX_ATTEMPTS,
      payloadPreview: redactPii(JSON.stringify(r.payload ?? {}, null, 2)).slice(
        0,
        2000,
      ),
    };
  });
}

/**
 * Force-replay a specific failed YSE grant by webhook_log id, regardless
 * of its current backoff window. Used by the admin "Retry now" button.
 * Resets attempts to allow further automatic retries if this manual run
 * also fails.
 */
export async function manuallyRetryYseGrant(
  webhookLogId: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [row] = await db
    .select({
      payload: webhookLogsTable.payload,
      result: webhookLogsTable.result,
      status: webhookLogsTable.status,
    })
    .from(webhookLogsTable)
    .where(
      and(
        eq(webhookLogsTable.id, webhookLogId),
        eq(webhookLogsTable.eventType, YSE_GRANT_EVENT_TYPE),
      ),
    )
    .limit(1);

  if (!row) return { ok: false, reason: "Not found" };
  if (row.result != null) return { ok: false, reason: "Already processed" };

  // Reset attempts so the manual retry doesn't immediately trip the cap.
  await db
    .update(webhookLogsTable)
    .set({
      attempts: 0,
      nextRetryAt: null,
      errorMessage: null,
      status: "failed",
    })
    .where(eq(webhookLogsTable.id, webhookLogId));

  try {
    const result = await handleExternalGrantProduct(
      row.payload as unknown as ExternalGrantPayload,
    );
    if ("code" in result) {
      return { ok: false, reason: `Unknown product slugs: ${result.unknownSlugs.join(", ")}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: redactPii(err) };
  }
}

export function getYseGrantRetryStatus() {
  return {
    lastRanAt: state.lastRanAt ? state.lastRanAt.toISOString() : null,
    lastSucceeded: state.lastSucceeded,
    lastFailed: state.lastFailed,
    lastError: state.lastError
      ? { at: state.lastError.at.toISOString(), message: state.lastError.message }
      : null,
    intervalMs: RUN_INTERVAL_MS,
    maxAttempts: YSE_GRANT_MAX_ATTEMPTS,
  };
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startYseGrantRetryJob(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    runYseGrantRetrySweep().catch((err) => {
      state.lastError = {
        at: new Date(),
        message: (err as Error)?.message ?? String(err),
      };
      console.error("[YseGrantRetry] Sweep crashed:", redactPii(err));
    });
  }, RUN_INTERVAL_MS);
  console.log(
    `[YseGrantRetry] Started retry job (every ${RUN_INTERVAL_MS / 1000}s, max ${YSE_GRANT_MAX_ATTEMPTS} attempts)`,
  );
  runYseGrantRetrySweep().catch((err) => {
    state.lastError = {
      at: new Date(),
      message: (err as Error)?.message ?? String(err),
    };
    console.error("[YseGrantRetry] Initial sweep failed:", redactPii(err));
  });
}

export function stopYseGrantRetryJob(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

/** Test-only: reset cached state so tests don't bleed between cases. */
export function __resetYseGrantRetryStateForTests(): void {
  state.lastRanAt = null;
  state.lastSucceeded = 0;
  state.lastFailed = 0;
  state.lastError = null;
}
