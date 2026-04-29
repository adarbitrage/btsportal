import { db, auditLogTable } from "@workspace/db";
import { and, inArray, lt } from "drizzle-orm";
import { QUEUE_FALLBACK_ACTION_TYPE } from "./queue-fallback-tracker";
import { QUEUE_FALLBACK_ALERT_ACTION_TYPE } from "./queue-fallback-alerter";

const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 30;
// Both the raw queue-fallback events AND the on-call alert delivery rows
// produced by `queue-fallback-alerter` need bounded retention — a sustained
// outage can write many of either kind, and admins only need the recent
// history for incident retros. Constants are imported so renames in either
// module propagate here.
const QUEUE_FALLBACK_ACTION_TYPES = [
  QUEUE_FALLBACK_ACTION_TYPE,
  QUEUE_FALLBACK_ALERT_ACTION_TYPE,
] as const;

// Heartbeat tracking surfaced on the admin System Health page so on-call
// can confirm the queue-fallback sweep is firing and see which run last
// failed. Updated in the `finally` of `runQueueFallbackAuditCleanup` so
// `lastRanAt` advances on both success and failure (the heartbeat is the
// only signal that catches a job that started silently throwing every run).
let lastRanAt: Date | null = null;
let lastDeletedCount: number | null = null;
let lastError: { at: Date; message: string } | null = null;

export async function runQueueFallbackAuditCleanup(): Promise<number> {
  let deletedCount = 0;
  let runError: { at: Date; message: string } | null = null;
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await db
      .delete(auditLogTable)
      .where(
        and(
          inArray(auditLogTable.actionType, [...QUEUE_FALLBACK_ACTION_TYPES]),
          lt(auditLogTable.createdAt, cutoff),
        ),
      );
    deletedCount = result.rowCount ?? 0;
    if (deletedCount > 0) {
      console.log(
        `[QueueFallbackAuditCleanup] Deleted ${deletedCount} ${QUEUE_FALLBACK_ACTION_TYPES.join("/")} audit row(s) older than ${RETENTION_DAYS}d`,
      );
    }
    return deletedCount;
  } catch (err) {
    runError = {
      at: new Date(),
      message: (err as Error)?.message ?? String(err),
    };
    throw err;
  } finally {
    lastRanAt = new Date();
    lastDeletedCount = deletedCount;
    lastError = runError;
  }
}

export interface QueueFallbackAuditCleanupStatus {
  label: string;
  actionTypes: string[];
  retentionDays: number;
  lastRanAt: string | null;
  lastDeletedCount: number | null;
  lastError: { at: string; message: string } | null;
}

export function getQueueFallbackAuditCleanupStatus(): QueueFallbackAuditCleanupStatus {
  return {
    label: "queue_fallback",
    actionTypes: [...QUEUE_FALLBACK_ACTION_TYPES],
    retentionDays: RETENTION_DAYS,
    lastRanAt: lastRanAt ? lastRanAt.toISOString() : null,
    lastDeletedCount,
    lastError: lastError
      ? { at: lastError.at.toISOString(), message: lastError.message }
      : null,
  };
}

export function __resetQueueFallbackAuditCleanupStateForTests(): void {
  lastRanAt = null;
  lastDeletedCount = null;
  lastError = null;
}

let jobInterval: ReturnType<typeof setInterval> | null = null;

export function startQueueFallbackAuditCleanupJob(): void {
  if (jobInterval) return;
  jobInterval = setInterval(() => {
    runQueueFallbackAuditCleanup().catch((err) => {
      console.error("[QueueFallbackAuditCleanup] Unexpected error:", err);
    });
  }, RUN_INTERVAL_MS);
  console.log(
    `[QueueFallbackAuditCleanup] Started cleanup job (every ${RUN_INTERVAL_MS / 60000}m, retention ${RETENTION_DAYS}d)`,
  );
  runQueueFallbackAuditCleanup().catch((err) => {
    console.error("[QueueFallbackAuditCleanup] Initial run failed:", err);
  });
}

export function stopQueueFallbackAuditCleanupJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
