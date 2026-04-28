import { db, emailChangeAttemptsTable } from "@workspace/db";
import { lt } from "drizzle-orm";

const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 7;

export async function runEmailChangeAttemptsCleanup(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await db
    .delete(emailChangeAttemptsTable)
    .where(lt(emailChangeAttemptsTable.createdAt, cutoff));
  const deletedCount = result.rowCount ?? 0;
  if (deletedCount > 0) {
    console.log(
      `[EmailChangeAttemptsCleanup] Deleted ${deletedCount} attempt row(s) older than ${RETENTION_DAYS}d`,
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
    `[EmailChangeAttemptsCleanup] Started cleanup job (every ${RUN_INTERVAL_MS / 60000}m, retention ${RETENTION_DAYS}d)`,
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
