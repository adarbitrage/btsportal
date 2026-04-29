import { db, emailChangeAttemptsTable } from "@workspace/db";
import { and, isNull, isNotNull, lt, or } from "drizzle-orm";

const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Rows without a `new_email` are legacy rate-limit-only counters: short-lived,
// no audit value beyond the rolling 24h window the rate limiter inspects.
export const RATE_LIMIT_RETENTION_DAYS = 7;

// Rows with a `new_email` represent an actual email change attempt that
// support may need to look up when a member calls in confused. Keep these
// long enough to cover follow-up calls well beyond the 7-day window.
export const AUDIT_RETENTION_DAYS = 90;

// Rows that were explicitly cancelled (cancelled_at populated, by either
// an admin via /admin/members/:id/cancel-email-change or by the member
// via POST /members/me/email/cancel — or replaced by a follow-up
// POST /members/me/email) carry extra audit value beyond a normal
// abandoned/expired attempt: they document a deliberate action. Support
// staff routinely revisit these rows months later when working through
// old tickets ("why did we cancel this member's email change back in
// Q1?"), so they get a longer retention window than ordinary attempt
// rows. Still bounded so the table does not grow forever.
export const ADMIN_CANCELLED_RETENTION_DAYS = 365;

export interface EmailChangeAttemptsRetentionPolicy {
  rateLimitRetentionDays: number;
  auditRetentionDays: number;
  adminCancelledRetentionDays: number;
}

/**
 * Snapshot of the retention windows the cleanup job applies. Surfaced on the
 * admin System Health page so admins can answer "how long do you keep
 * email-change attempts?" without grepping through code or log lines. Sourced
 * from the same constants the job itself uses so the UI cannot drift from
 * the actual policy.
 */
export function getEmailChangeAttemptsRetentionPolicy(): EmailChangeAttemptsRetentionPolicy {
  return {
    rateLimitRetentionDays: RATE_LIMIT_RETENTION_DAYS,
    auditRetentionDays: AUDIT_RETENTION_DAYS,
    adminCancelledRetentionDays: ADMIN_CANCELLED_RETENTION_DAYS,
  };
}

export async function runEmailChangeAttemptsCleanup(): Promise<number> {
  const now = Date.now();
  const rateLimitCutoff = new Date(
    now - RATE_LIMIT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const auditCutoff = new Date(
    now - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const adminCancelledCutoff = new Date(
    now - ADMIN_CANCELLED_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  // Classify explicitly-cancelled rows by `cancelledAt` rather than
  // `cancelledByAdminId`: the schema populates both columns together for
  // admin cancellations, but the admin FK is `onDelete: set null`, so
  // deleting an admin user would null out `cancelledByAdminId` and silently
  // demote a historical admin-cancelled row back into the 90-day audit
  // cohort. `cancelledAt` is the durable marker that the cancellation
  // actually happened — it's also set together with `cancelledByMember`
  // for member-initiated cancel/replace flows, so both buckets get the
  // longer retention window without further branching.
  const result = await db.delete(emailChangeAttemptsTable).where(
    or(
      and(
        isNull(emailChangeAttemptsTable.newEmail),
        lt(emailChangeAttemptsTable.createdAt, rateLimitCutoff),
      ),
      // Ordinary audit rows: have a new_email but were not explicitly
      // cancelled (by either an admin or the member). Deleted at the
      // standard 90-day mark.
      and(
        isNotNull(emailChangeAttemptsTable.newEmail),
        isNull(emailChangeAttemptsTable.cancelledAt),
        lt(emailChangeAttemptsTable.createdAt, auditCutoff),
      ),
      // Explicitly-cancelled rows (admin or member): kept for the longer
      // 365-day window so support staff can investigate stale tickets
      // months after the cancellation.
      and(
        isNotNull(emailChangeAttemptsTable.cancelledAt),
        lt(emailChangeAttemptsTable.createdAt, adminCancelledCutoff),
      ),
    ),
  );
  const deletedCount = result.rowCount ?? 0;
  if (deletedCount > 0) {
    console.log(
      `[EmailChangeAttemptsCleanup] Deleted ${deletedCount} attempt row(s) (rate-limit retention ${RATE_LIMIT_RETENTION_DAYS}d, audit retention ${AUDIT_RETENTION_DAYS}d, admin-cancelled retention ${ADMIN_CANCELLED_RETENTION_DAYS}d)`,
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
    `[EmailChangeAttemptsCleanup] Started cleanup job (every ${RUN_INTERVAL_MS / 60000}m, rate-limit retention ${RATE_LIMIT_RETENTION_DAYS}d, audit retention ${AUDIT_RETENTION_DAYS}d, admin-cancelled retention ${ADMIN_CANCELLED_RETENTION_DAYS}d)`,
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
