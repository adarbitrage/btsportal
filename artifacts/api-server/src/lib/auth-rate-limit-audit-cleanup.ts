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

// Heartbeat tracking surfaced on the admin System Health page so on-call
// can confirm the rate-limit audit sweep is firing and see which run last
// failed. Updated in the `finally` of `runAuthRateLimitAuditCleanup` so
// `lastRanAt` advances on both success and failure (the heartbeat is the
// only signal that catches a job that started silently throwing every run).
let lastRanAt: Date | null = null;
let lastDeletedCount: number | null = null;
let lastError: { at: Date; message: string } | null = null;

export async function runAuthRateLimitAuditCleanup(): Promise<number> {
  let deletedCount = 0;
  let runError: { at: Date; message: string } | null = null;
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await db
      .delete(auditLogTable)
      .where(
        and(
          inArray(auditLogTable.actionType, [...AUTH_RATE_LIMIT_ACTION_TYPES]),
          lt(auditLogTable.createdAt, cutoff),
        ),
      );
    deletedCount = result.rowCount ?? 0;
    if (deletedCount > 0) {
      console.log(
        `[AuthRateLimitAuditCleanup] Deleted ${deletedCount} ${AUTH_RATE_LIMIT_ACTION_TYPES.join("/")} audit row(s) older than ${RETENTION_DAYS}d`,
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

export interface AuthRateLimitAuditCleanupStatus {
  label: string;
  actionTypes: string[];
  retentionDays: number;
  lastRanAt: string | null;
  lastDeletedCount: number | null;
  lastError: { at: string; message: string } | null;
}

export function getAuthRateLimitAuditCleanupStatus(): AuthRateLimitAuditCleanupStatus {
  return {
    label: "auth_rate_limit_blocked",
    actionTypes: [...AUTH_RATE_LIMIT_ACTION_TYPES],
    retentionDays: RETENTION_DAYS,
    lastRanAt: lastRanAt ? lastRanAt.toISOString() : null,
    lastDeletedCount,
    lastError: lastError
      ? { at: lastError.at.toISOString(), message: lastError.message }
      : null,
  };
}

export function __resetAuthRateLimitAuditCleanupStateForTests(): void {
  lastRanAt = null;
  lastDeletedCount = null;
  lastError = null;
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
