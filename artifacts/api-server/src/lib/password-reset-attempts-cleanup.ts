import { db, passwordResetAttemptsTable } from "@workspace/db";
import { lt } from "drizzle-orm";

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

let jobInterval: ReturnType<typeof setInterval> | null = null;

export function startPasswordResetAttemptsCleanupJob(): void {
  if (jobInterval) return;
  jobInterval = setInterval(() => {
    runPasswordResetAttemptsCleanup().catch((err) => {
      console.error("[PasswordResetAttemptsCleanup] Unexpected error:", err);
    });
  }, RUN_INTERVAL_MS);
  console.log(
    `[PasswordResetAttemptsCleanup] Started cleanup job (every ${RUN_INTERVAL_MS / 60000}m, retention ${RETENTION_DAYS}d)`,
  );
  runPasswordResetAttemptsCleanup().catch((err) => {
    console.error("[PasswordResetAttemptsCleanup] Initial run failed:", err);
  });
}

export function stopPasswordResetAttemptsCleanupJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
