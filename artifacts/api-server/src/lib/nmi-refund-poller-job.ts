// Periodic driver for the NMI refund/chargeback poller. Mirrors the other
// simple background jobs (setInterval + start/stop + run-once-on-boot).

import { pollNmiRefundEvents } from "./nmi-refund-poller.js";

const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

let jobInterval: ReturnType<typeof setInterval> | null = null;

export function startNmiRefundPollerJob(): void {
  if (jobInterval) return;
  jobInterval = setInterval(() => {
    pollNmiRefundEvents().catch((err) => {
      console.error("[NmiRefundPoller] Scheduled run failed:", err);
    });
  }, RUN_INTERVAL_MS);
  console.log(
    `[NmiRefundPoller] Started refund/chargeback poller job (every ${RUN_INTERVAL_MS / 60000}m)`,
  );
  pollNmiRefundEvents().catch((err) => {
    console.error("[NmiRefundPoller] Initial run failed:", err);
  });
}

export function stopNmiRefundPollerJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
