// Periodic driver for the private coaching recording ingest. Mirrors the other
// background jobs (setInterval + start/stop). The work itself no-ops when Google
// Drive is not configured, so this is safe to start unconditionally.

import { runCoachingRecordingIngest } from "./coaching-recording-ingest";

const RUN_INTERVAL_MS = 15 * 60 * 1000; // every 15 min

let jobInterval: ReturnType<typeof setInterval> | null = null;

export function startCoachingRecordingIngestJob(): void {
  if (jobInterval) return;
  jobInterval = setInterval(() => {
    runCoachingRecordingIngest().catch((err) => {
      console.error("[CoachingRecordingIngest] Unexpected error:", err);
    });
  }, RUN_INTERVAL_MS);
  console.log(
    `[CoachingRecordingIngest] Started recording-ingest job (every ${RUN_INTERVAL_MS / 60000}m; no-op until Google Drive is configured)`,
  );
}

export function stopCoachingRecordingIngestJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
