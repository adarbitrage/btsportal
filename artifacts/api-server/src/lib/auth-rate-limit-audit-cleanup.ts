import { db, auditLogTable } from "@workspace/db";
import { and, eq, lt } from "drizzle-orm";
import { AUTH_RATE_LIMIT_AUDIT_ACTION } from "../routes/auth";

const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 30;

export async function runAuthRateLimitAuditCleanup(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await db
    .delete(auditLogTable)
    .where(
      and(
        eq(auditLogTable.actionType, AUTH_RATE_LIMIT_AUDIT_ACTION),
        lt(auditLogTable.createdAt, cutoff),
      ),
    );
  const deletedCount = result.rowCount ?? 0;
  if (deletedCount > 0) {
    console.log(
      `[AuthRateLimitAuditCleanup] Deleted ${deletedCount} ${AUTH_RATE_LIMIT_AUDIT_ACTION} audit row(s) older than ${RETENTION_DAYS}d`,
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
