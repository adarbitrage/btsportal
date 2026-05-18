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

export interface UpgradePromptEventsCleanupStatus {
  intervalMs: number;
  retentionDays: number;
  lastRanAt: string | null;
  lastDeletedCount: number | null;
  lastError: { at: string; message: string } | null;
  stale: boolean;
}

// Surfaced to the admin System Health page so on-call can confirm the daily
// retention sweep is still running and pruning rows. The status is updated
// at the end of every `runUpgradePromptEventsCleanup` call (success OR
// failure), so `lastRanAt` doubles as a heartbeat — a silent crash in the
// inner loop still flips the panel out of "Pending" and surfaces the error.
let lastRanAt: Date | null = null;
let lastDeletedCount: number | null = null;
let lastError: { at: Date; message: string } | null = null;

// Baseline used to compute staleness when the job has not yet reported a
// run. Set at module load — which in production is process start, the same
// moment `startUpgradePromptEventsCleanupJob` would have started running.
// If no run shows up after 2 intervals from this baseline, the System
// Health panel surfaces it as stale instead of leaving it on "Pending"
// forever.
let baselineSince: Date = new Date();

export async function runUpgradePromptEventsCleanup(): Promise<number> {
  const retentionDays = getRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  let deletedCount = 0;
  try {
    const result = await db
      .delete(upgradePromptEventsTable)
      .where(lt(upgradePromptEventsTable.createdAt, cutoff));
    deletedCount = result.rowCount ?? 0;
    if (deletedCount > 0) {
      console.log(
        `[UpgradePromptEventsCleanup] Deleted ${deletedCount} upgrade_prompt_events row(s) older than ${retentionDays}d`,
      );
    }
    lastError = null;
    return deletedCount;
  } catch (err) {
    // Failures used to leave `lastRanAt` unchanged, so a job that broke
    // immediately would look like it had never run. Record a heartbeat on
    // the failure path and remember the error so the System Health page
    // can surface it.
    lastError = {
      at: new Date(),
      message: (err as Error)?.message ?? String(err),
    };
    throw err;
  } finally {
    lastRanAt = new Date();
    lastDeletedCount = deletedCount;
  }
}

/**
 * Snapshot of the cleanup job's runtime health for the admin System Health
 * page. Mirrors `getEmailChangeAttemptsCleanupStatus()` so on-call only ever
 * has to learn one shape: lastRanAt heartbeat, lastDeletedCount per-run
 * counter, lastError message, and a stale flag that flips after 2× the run
 * interval with no run. Also exposes the configured retention window so
 * admins can answer "how long do you keep upgrade-prompt analytics?" at a
 * glance without checking env vars.
 */
export function getUpgradePromptEventsCleanupStatus(): UpgradePromptEventsCleanupStatus {
  const intervalMs = getRunIntervalMs();
  // When the job has never reported a run we fall back to the module-load
  // baseline: if the process has been up longer than 2 intervals without a
  // single sweep landing, that is itself a regression worth surfacing.
  const referenceTs = (lastRanAt ?? baselineSince).getTime();
  const stale = Date.now() - referenceTs > 2 * intervalMs;
  return {
    intervalMs,
    retentionDays: getRetentionDays(),
    lastRanAt: lastRanAt ? lastRanAt.toISOString() : null,
    lastDeletedCount,
    lastError: lastError
      ? { at: lastError.at.toISOString(), message: lastError.message }
      : null,
    stale,
  };
}

// Test hook: reset the in-memory status back to its initial state so each
// test can assert against a clean slate. Not intended for production use.
export function __resetUpgradePromptEventsCleanupStatusForTests(): void {
  lastRanAt = null;
  lastDeletedCount = null;
  lastError = null;
  baselineSince = new Date();
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
