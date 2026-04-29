import { db, upgradePromptEventsTable } from "@workspace/db";
import { lt } from "drizzle-orm";

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

function readPositiveInt(envValue: string | undefined, fallback: number): number {
  if (!envValue) return fallback;
  const parsed = Number.parseInt(envValue, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function getRetentionDays(): number {
  return readPositiveInt(
    process.env.UPGRADE_PROMPT_EVENTS_RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS,
  );
}

function getRunIntervalMs(): number {
  const rawSeconds = process.env.UPGRADE_PROMPT_EVENTS_CLEANUP_INTERVAL_SECONDS;
  const seconds = readPositiveInt(rawSeconds, DEFAULT_RUN_INTERVAL_MS / 1000);
  return seconds * 1000;
}

export async function runUpgradePromptEventsCleanup(): Promise<number> {
  const retentionDays = getRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await db
    .delete(upgradePromptEventsTable)
    .where(lt(upgradePromptEventsTable.createdAt, cutoff));
  const deletedCount = result.rowCount ?? 0;
  if (deletedCount > 0) {
    console.log(
      `[UpgradePromptEventsCleanup] Deleted ${deletedCount} upgrade_prompt_events row(s) older than ${retentionDays}d`,
    );
  }
  return deletedCount;
}

let jobInterval: ReturnType<typeof setInterval> | null = null;

export function startUpgradePromptEventsCleanupJob(): void {
  if (jobInterval) return;
  const intervalMs = getRunIntervalMs();
  const retentionDays = getRetentionDays();
  jobInterval = setInterval(() => {
    runUpgradePromptEventsCleanup().catch((err) => {
      console.error("[UpgradePromptEventsCleanup] Unexpected error:", err);
    });
  }, intervalMs);
  console.log(
    `[UpgradePromptEventsCleanup] Started cleanup job (every ${intervalMs / 60000}m, retention ${retentionDays}d)`,
  );
  runUpgradePromptEventsCleanup().catch((err) => {
    console.error("[UpgradePromptEventsCleanup] Initial run failed:", err);
  });
}

export function stopUpgradePromptEventsCleanupJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
