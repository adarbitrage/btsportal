import { db, usersTable } from "@workspace/db";
import { lt } from "drizzle-orm";

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

let jobInterval: ReturnType<typeof setInterval> | null = null;

export function startPendingEmailCleanupJob(): void {
  if (jobInterval) return;
  jobInterval = setInterval(() => {
    runPendingEmailCleanup().catch((err) => {
      console.error("[PendingEmailCleanup] Unexpected error:", err);
    });
  }, RUN_INTERVAL_MS);
  console.log(
    `[PendingEmailCleanup] Started pending email cleanup job (every ${RUN_INTERVAL_MS / 60000}m)`,
  );
  runPendingEmailCleanup().catch((err) => {
    console.error("[PendingEmailCleanup] Initial run failed:", err);
  });
}

export function stopPendingEmailCleanupJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
