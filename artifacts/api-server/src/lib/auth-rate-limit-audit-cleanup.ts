import { db, auditLogTable } from "@workspace/db";
import { and, inArray, lt } from "drizzle-orm";
import { AUTH_RATE_LIMIT_AUDIT_ACTION } from "../routes/auth";
import { AUTH_RATE_LIMIT_ALERT_ACTION_TYPE } from "./auth-rate-limit-alerter";

const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 30;
// Both the raw rate-limit hits AND the on-call alert delivery rows produced
// by `auth-rate-limit-alerter` need bounded retention — a sustained attack
// can write many of either kind, and admins only need recent history for
// incident retros. Constants are imported so renames in either module
// propagate here.
const AUTH_RATE_LIMIT_ACTION_TYPES = [
  AUTH_RATE_LIMIT_AUDIT_ACTION,
  AUTH_RATE_LIMIT_ALERT_ACTION_TYPE,
] as const;

export async function runAuthRateLimitAuditCleanup(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await db
    .delete(auditLogTable)
    .where(
      and(
        inArray(auditLogTable.actionType, [...AUTH_RATE_LIMIT_ACTION_TYPES]),
        lt(auditLogTable.createdAt, cutoff),
      ),
    );
  const deletedCount = result.rowCount ?? 0;
  if (deletedCount > 0) {
    console.log(
      `[AuthRateLimitAuditCleanup] Deleted ${deletedCount} ${AUTH_RATE_LIMIT_ACTION_TYPES.join("/")} audit row(s) older than ${RETENTION_DAYS}d`,
    );
  }
  return deletedCount;
}

let jobInterval: ReturnType<typeof setInterval> | null = null;

export function startAuthRateLimitAuditCleanupJob(): void {
  if (jobInterval) return;
  jobInterval = setInterval(() => {
    runAuthRateLimitAuditCleanup().catch((err) => {
      console.error("[AuthRateLimitAuditCleanup] Unexpected error:", err);
    });
  }, RUN_INTERVAL_MS);
  console.log(
    `[AuthRateLimitAuditCleanup] Started cleanup job (every ${RUN_INTERVAL_MS / 60000}m, retention ${RETENTION_DAYS}d)`,
  );
  runAuthRateLimitAuditCleanup().catch((err) => {
    console.error("[AuthRateLimitAuditCleanup] Initial run failed:", err);
  });
}

export function stopAuthRateLimitAuditCleanupJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
