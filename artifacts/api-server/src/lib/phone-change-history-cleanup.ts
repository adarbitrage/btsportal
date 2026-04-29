import { db } from "@workspace/db";
import { phoneChangeHistoryTable } from "@workspace/db/schema";
import { lt } from "drizzle-orm";

const RUN_INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_DAYS = 90;

export async function runPhoneChangeHistoryCleanup(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(phoneChangeHistoryTable)
    .where(lt(phoneChangeHistoryTable.changedAt, cutoff))
    .returning({ id: phoneChangeHistoryTable.id });
  if (deleted.length === 0) {
    console.log(
      `[PhoneChangeHistoryCleanup] No rows older than ${RETENTION_DAYS}d to delete`,
    );
    return;
  }
  console.log(
    `[PhoneChangeHistoryCleanup] Deleted ${deleted.length} phone_change_history row(s) older than ${RETENTION_DAYS}d`,
  );
}

let jobInterval: ReturnType<typeof setInterval> | null = null;

export function startPhoneChangeHistoryCleanupJob(): void {
  if (jobInterval) return;
  jobInterval = setInterval(() => {
    runPhoneChangeHistoryCleanup().catch((err) => {
      console.error("[PhoneChangeHistoryCleanup] Unexpected error:", err);
    });
  }, RUN_INTERVAL_MS);
  console.log(
    `[PhoneChangeHistoryCleanup] Started phone_change_history cleanup job (every ${RUN_INTERVAL_MS / 60000}m, retention ${RETENTION_DAYS}d)`,
  );
}

export function stopPhoneChangeHistoryCleanupJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
