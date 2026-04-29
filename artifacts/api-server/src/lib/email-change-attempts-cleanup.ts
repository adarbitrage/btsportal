import { db, emailChangeAttemptsTable } from "@workspace/db";
import { and, isNull, isNotNull, lt, or } from "drizzle-orm";

const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Rows without a `new_email` are legacy rate-limit-only counters: short-lived,
// no audit value beyond the rolling 24h window the rate limiter inspects.
const RATE_LIMIT_RETENTION_DAYS = 7;

// Rows with a `new_email` represent an actual email change attempt that
// support may need to look up when a member calls in confused. Keep these
// long enough to cover follow-up calls well beyond the 7-day window.
const AUDIT_RETENTION_DAYS = 90;

export async function runEmailChangeAttemptsCleanup(): Promise<number> {
  const now = Date.now();
  const rateLimitCutoff = new Date(
    now - RATE_LIMIT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const auditCutoff = new Date(
    now - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const result = await db.delete(emailChangeAttemptsTable).where(
    or(
      and(
        isNull(emailChangeAttemptsTable.newEmail),
        lt(emailChangeAttemptsTable.createdAt, rateLimitCutoff),
      ),
      and(
        isNotNull(emailChangeAttemptsTable.newEmail),
        lt(emailChangeAttemptsTable.createdAt, auditCutoff),
      ),
    ),
  );
  const deletedCount = result.rowCount ?? 0;
  if (deletedCount > 0) {
    console.log(
      `[EmailChangeAttemptsCleanup] Deleted ${deletedCount} attempt row(s) (rate-limit retention ${RATE_LIMIT_RETENTION_DAYS}d, audit retention ${AUDIT_RETENTION_DAYS}d)`,
    );
  }
  return deletedCount;
}

let jobInterval: ReturnType<typeof setInterval> | null = null;

export function startEmailChangeAttemptsCleanupJob(): void {
  if (jobInterval) return;
  jobInterval = setInterval(() => {
    runEmailChangeAttemptsCleanup().catch((err) => {
      console.error("[EmailChangeAttemptsCleanup] Unexpected error:", err);
    });
  }, RUN_INTERVAL_MS);
  console.log(
    `[EmailChangeAttemptsCleanup] Started cleanup job (every ${RUN_INTERVAL_MS / 60000}m, rate-limit retention ${RATE_LIMIT_RETENTION_DAYS}d, audit retention ${AUDIT_RETENTION_DAYS}d)`,
  );
  runEmailChangeAttemptsCleanup().catch((err) => {
    console.error("[EmailChangeAttemptsCleanup] Initial run failed:", err);
  });
}

export function stopEmailChangeAttemptsCleanupJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
