import { db, passwordResetAttemptsTable } from "@workspace/db";
import { lt } from "drizzle-orm";
import { createRetryableIntervalJob } from "./interval-job-retry";

const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 7;

export async function runPasswordResetAttemptsCleanup(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await db
    .delete(passwordResetAttemptsTable)
    .where(lt(passwordResetAttemptsTable.createdAt, cutoff));
  const deletedCount = result.rowCount ?? 0;
  if (deletedCount > 0) {
    console.log(
      `[PasswordResetAttemptsCleanup] Deleted ${deletedCount} attempt row(s) older than ${RETENTION_DAYS}d`,
    );
  }
  return deletedCount;
}

// Shared crash-proof scheduler (task #2118): failed runs log the underlying
// DB error (code + message, not just the SQL text) and retry on a short
// bounded backoff instead of silently waiting the full 24h interval.
const job = createRetryableIntervalJob({
  label: "PasswordResetAttemptsCleanup",
  envPrefix: "PASSWORD_RESET_ATTEMPTS_CLEANUP",
  getIntervalMs: () => RUN_INTERVAL_MS,
  runAttempt: async () => {
    await runPasswordResetAttemptsCleanup();
  },
  runOnStart: true,
});

export function startPasswordResetAttemptsCleanupJob(): void {
  console.log(
    `[PasswordResetAttemptsCleanup] Started cleanup job (every ${RUN_INTERVAL_MS / 60000}m, retention ${RETENTION_DAYS}d)`,
  );
  job.start();
}

export function stopPasswordResetAttemptsCleanupJob(): void {
  job.stop();
}
