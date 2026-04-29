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

export async function runQueueFallbackAuditCleanup(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await db
    .delete(auditLogTable)
    .where(
      and(
        inArray(auditLogTable.actionType, [...QUEUE_FALLBACK_ACTION_TYPES]),
        lt(auditLogTable.createdAt, cutoff),
      ),
    );
  const deletedCount = result.rowCount ?? 0;
  if (deletedCount > 0) {
    console.log(
      `[QueueFallbackAuditCleanup] Deleted ${deletedCount} ${QUEUE_FALLBACK_ACTION_TYPES.join("/")} audit row(s) older than ${RETENTION_DAYS}d`,
    );
  }
  return deletedCount;
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
