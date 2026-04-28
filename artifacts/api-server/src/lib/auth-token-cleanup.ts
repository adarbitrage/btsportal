import { db, usersTable } from "@workspace/db";
import { lt } from "drizzle-orm";

const RUN_INTERVAL_MS = 60 * 60 * 1000;

export async function runResetTokenCleanup(): Promise<number> {
  const now = new Date();
  const cleared = await db
    .update(usersTable)
    .set({
      resetToken: null,
      resetTokenExpires: null,
    })
    .where(lt(usersTable.resetTokenExpires, now))
    .returning({ id: usersTable.id });

  if (cleared.length === 0) {
    console.log("[AuthTokenCleanup] No expired password-reset tokens to clear");
  } else {
    console.log(
      `[AuthTokenCleanup] Cleared ${cleared.length} expired password-reset token(s)`,
    );
  }
  return cleared.length;
}

export async function runEmailVerifyTokenCleanup(): Promise<number> {
  const now = new Date();
  const cleared = await db
    .update(usersTable)
    .set({
      emailVerifyToken: null,
      emailVerifyExpires: null,
    })
    .where(lt(usersTable.emailVerifyExpires, now))
    .returning({ id: usersTable.id });

  if (cleared.length === 0) {
    console.log("[AuthTokenCleanup] No expired email-verify tokens to clear");
  } else {
    console.log(
      `[AuthTokenCleanup] Cleared ${cleared.length} expired email-verify token(s)`,
    );
  }
  return cleared.length;
}

export async function runAuthTokenCleanup(): Promise<{
  resetCleared: number;
  emailVerifyCleared: number;
}> {
  const [resetCleared, emailVerifyCleared] = await Promise.all([
    runResetTokenCleanup(),
    runEmailVerifyTokenCleanup(),
  ]);
  return { resetCleared, emailVerifyCleared };
}

let jobInterval: ReturnType<typeof setInterval> | null = null;

export function startAuthTokenCleanupJob(): void {
  if (jobInterval) return;
  jobInterval = setInterval(() => {
    runAuthTokenCleanup().catch((err) => {
      console.error("[AuthTokenCleanup] Unexpected error:", err);
    });
  }, RUN_INTERVAL_MS);
  console.log(
    `[AuthTokenCleanup] Started auth token cleanup job (every ${RUN_INTERVAL_MS / 60000}m)`,
  );
  runAuthTokenCleanup().catch((err) => {
    console.error("[AuthTokenCleanup] Initial run failed:", err);
  });
}

export function stopAuthTokenCleanupJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
