import { db } from "@workspace/db";
import { emailChangeHistoryTable } from "@workspace/db/schema";
import { lt } from "drizzle-orm";
import {
  CHANGE_HISTORY_RETENTION_DEFAULTS,
  getEmailChangeHistoryRetentionDays,
} from "./change-history-retention-settings";

const RUN_INTERVAL_MS = 60 * 60 * 1000;

export async function runEmailChangeHistoryCleanup(): Promise<void> {
  // Read retention at runtime so admin edits in the system Settings page
  // take effect on the next tick — no restart required. The accessor falls
  // back to the 90-day default if the read throws or no row is set, so a
  // bad/missing setting can never disable cleanup.
  const retentionDays = await getEmailChangeHistoryRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(emailChangeHistoryTable)
    .where(lt(emailChangeHistoryTable.changedAt, cutoff))
    .returning({ id: emailChangeHistoryTable.id });
  if (deleted.length === 0) {
    console.log(
      `[EmailChangeHistoryCleanup] No rows older than ${retentionDays}d to delete`,
    );
    return;
  }
  console.log(
    `[EmailChangeHistoryCleanup] Deleted ${deleted.length} email_change_history row(s) older than ${retentionDays}d`,
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
    `[EmailChangeHistoryCleanup] Started email_change_history cleanup job (every ${RUN_INTERVAL_MS / 60000}m, retention default ${CHANGE_HISTORY_RETENTION_DEFAULTS.emailRetentionDays}d, configurable via system_settings)`,
  );
}

export function stopEmailChangeHistoryCleanupJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
