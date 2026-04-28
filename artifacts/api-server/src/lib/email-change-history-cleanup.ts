import { db } from "@workspace/db";
import { emailChangeHistoryTable } from "@workspace/db/schema";
import { lt } from "drizzle-orm";

const RUN_INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_DAYS = 90;

export async function runEmailChangeHistoryCleanup(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(emailChangeHistoryTable)
    .where(lt(emailChangeHistoryTable.changedAt, cutoff))
    .returning({ id: emailChangeHistoryTable.id });
  if (deleted.length === 0) {
    console.log(
      `[EmailChangeHistoryCleanup] No rows older than ${RETENTION_DAYS}d to delete`,
    );
    return;
  }
  console.log(
    `[EmailChangeHistoryCleanup] Deleted ${deleted.length} email_change_history row(s) older than ${RETENTION_DAYS}d`,
  );
}

let jobInterval: ReturnType<typeof setInterval> | null = null;

export function startEmailChangeHistoryCleanupJob(): void {
  if (jobInterval) return;
  jobInterval = setInterval(() => {
    runEmailChangeHistoryCleanup().catch((err) => {
      console.error("[EmailChangeHistoryCleanup] Unexpected error:", err);
    });
  }, RUN_INTERVAL_MS);
  console.log(
    `[EmailChangeHistoryCleanup] Started email_change_history cleanup job (every ${RUN_INTERVAL_MS / 60000}m, retention ${RETENTION_DAYS}d)`,
  );
}

export function stopEmailChangeHistoryCleanupJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
