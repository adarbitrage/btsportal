import {
  probeRetellAgentHealth,
  setCachedRetellSetupResult,
  interpretRetellSetupHealth,
} from "./retell-agent-setup";

// Default cadence for the passive background re-probe. The probe is read-only
// (it never mutates the Retell agent), so a 10-minute interval keeps the cached
// health verdict fresh without an admin having to click "Re-check now" or the
// server having to restart.
const DEFAULT_RUN_INTERVAL_MS = 10 * 60 * 1000;

function readPositiveInt(envValue: string | undefined, fallback: number): number {
  if (!envValue) return fallback;
  const parsed = Number.parseInt(envValue, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function getRunIntervalMs(): number {
  const seconds = readPositiveInt(
    process.env.RETELL_HEALTH_REPROBE_INTERVAL_SECONDS,
    DEFAULT_RUN_INTERVAL_MS / 1000,
  );
  return seconds * 1000;
}

/**
 * Run the read-only voice-agent health probe and refresh the cached verdict.
 *
 * Cheap no-op safety: `probeRetellAgentHealth` short-circuits and returns a
 * "not_configured" result the moment RETELL_API_KEY / RETELL_AGENT_ID are
 * absent — it never reaches the Retell API in that case — so this is free to
 * run on an interval in dev where voice is intentionally off.
 */
export async function runRetellHealthReprobe(): Promise<void> {
  const result = await probeRetellAgentHealth();
  setCachedRetellSetupResult(result);
}

let jobInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the passive background re-probe that keeps the Voice Assistant health
 * badge fresh even when no admin is looking at the System Health page.
 *
 * The startup `setupRetellAgentKb` run already seeds the cache, so this job
 * deliberately does NOT run immediately — it waits one interval before the
 * first re-probe to avoid a redundant Retell round-trip right after boot.
 */
export function startRetellHealthReprobeJob(): void {
  if (jobInterval) return;
  const intervalMs = getRunIntervalMs();
  jobInterval = setInterval(() => {
    runRetellHealthReprobe().catch((err) => {
      console.error("[RetellHealthReprobe] Unexpected error:", err);
    });
  }, intervalMs);
  // Allow the process to exit even if this timer is pending (matches other
  // best-effort background timers and keeps tests from hanging).
  if (typeof jobInterval.unref === "function") {
    jobInterval.unref();
  }
  console.log(
    `[RetellHealthReprobe] Started voice-agent health re-probe job (every ${intervalMs / 60000}m)`,
  );
}

export function stopRetellHealthReprobeJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}

// Re-exported for callers/tests that want to interpret the freshly cached
// verdict without importing from two modules.
export { interpretRetellSetupHealth };
