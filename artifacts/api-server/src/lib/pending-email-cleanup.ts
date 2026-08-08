import { db, usersTable } from "@workspace/db";
import { lt } from "drizzle-orm";
import { createRetryableIntervalJob } from "./interval-job-retry";

const RUN_INTERVAL_MS = 60 * 60 * 1000;

export async function runPendingEmailCleanup(): Promise<number> {
  const now = new Date();
  const cleared = await db
    .update(usersTable)
    .set({
      pendingEmail: null,
      emailChangeToken: null,
      emailChangeExpires: null,
    })
    .where(lt(usersTable.emailChangeExpires, now))
    .returning({ id: usersTable.id });

  if (cleared.length === 0) {
    console.log("[PendingEmailCleanup] No expired pending email changes to clear");
  } else {
    console.log(
      `[PendingEmailCleanup] Cleared ${cleared.length} expired pending email change(s)`,
    );
  }
  return cleared.length;
}

// Shared crash-proof scheduler (task #2118): failed runs log the underlying
// DB error (code + message, not just the SQL text) and retry on a short
// bounded backoff instead of silently waiting the full interval.
const job = createRetryableIntervalJob({
  label: "PendingEmailCleanup",
  envPrefix: "PENDING_EMAIL_CLEANUP",
  getIntervalMs: () => RUN_INTERVAL_MS,
  runAttempt: async () => {
    await runPendingEmailCleanup();
  },
  runOnStart: true,
});

export function startPendingEmailCleanupJob(): void {
  console.log(
    `[PendingEmailCleanup] Started pending email cleanup job (every ${RUN_INTERVAL_MS / 60000}m)`,
  );
  job.start();
}

export function stopPendingEmailCleanupJob(): void {
  job.stop();
}
