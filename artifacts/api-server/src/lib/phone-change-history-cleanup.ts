import { db } from "@workspace/db";
import { phoneChangeHistoryTable } from "@workspace/db/schema";
import { lt } from "drizzle-orm";
import {
  CHANGE_HISTORY_RETENTION_DEFAULTS,
  getPhoneChangeHistoryRetentionDays,
} from "./change-history-retention-settings";

const RUN_INTERVAL_MS = 60 * 60 * 1000;

export async function runPhoneChangeHistoryCleanup(): Promise<void> {
  // Read retention at runtime so admin edits in the system Settings page
  // take effect on the next tick — no restart required. The accessor falls
  // back to the 90-day default if the read throws or no row is set, so a
  // bad/missing setting can never disable cleanup.
  const retentionDays = await getPhoneChangeHistoryRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(phoneChangeHistoryTable)
    .where(lt(phoneChangeHistoryTable.changedAt, cutoff))
    .returning({ id: phoneChangeHistoryTable.id });
  if (deleted.length === 0) {
    console.log(
      `[PhoneChangeHistoryCleanup] No rows older than ${retentionDays}d to delete`,
    );
    return;
  }
  console.log(
    `[PhoneChangeHistoryCleanup] Deleted ${deleted.length} phone_change_history row(s) older than ${retentionDays}d`,
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
    `[PhoneChangeHistoryCleanup] Started phone_change_history cleanup job (every ${RUN_INTERVAL_MS / 60000}m, retention default ${CHANGE_HISTORY_RETENTION_DEFAULTS.phoneRetentionDays}d, configurable via system_settings)`,
  );
}

export function stopPhoneChangeHistoryCleanupJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
