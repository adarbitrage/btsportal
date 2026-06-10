import app from "./app";
import { startWorker, shutdown } from "./lib/ghl-queue";
import { startCommunicationWorkers, stopCommunicationWorkers } from "./lib/communication-worker";
import { startSequenceEngine, shutdownSequenceEngine } from "./lib/sequence-engine";
import { startScheduledComms, shutdownScheduledComms } from "./lib/scheduled-comms";
import { startRevenuePipeline, shutdownRevenuePipeline } from "./lib/revenue-pipeline";
import { startQueueFallbackAlerter, stopQueueFallbackAlerter } from "./lib/queue-fallback-alerter";
import { startSignupChallengeAlerter, stopSignupChallengeAlerter } from "./lib/signup-challenge-alerter";
import { startAuthRateLimitAlerter, stopAuthRateLimitAlerter } from "./lib/auth-rate-limit-alerter";
import { startProductionEnvGuard, stopProductionEnvGuard } from "./lib/production-env-guard";
import {
  startYseGrantExhaustedAlerter,
  stopYseGrantExhaustedAlerter,
} from "./lib/yse-grant-exhausted-alerter";
import {
  startAbuseRateLimitCleanupAlerter,
  stopAbuseRateLimitCleanupAlerter,
} from "./lib/abuse-rate-limit-cleanup-alerter";
import {
  startRateLimitAuditFailureAlerter,
  stopRateLimitAuditFailureAlerter,
} from "./lib/rate-limit-audit-failure-alerter";
import {
  startMachineMismatchAlerter,
  stopMachineMismatchAlerter,
} from "./lib/machine-mismatch-alerter";
import {
  startModerationFailureAlerter,
  stopModerationFailureAlerter,
} from "./lib/moderation/failure-alerter";
import {
  startMachineMismatchDigestJob,
  stopMachineMismatchDigestJob,
} from "./lib/machine-mismatch-daily-digest";
import {
  startMachineMismatchDigestAlerter,
  stopMachineMismatchDigestAlerter,
} from "./lib/machine-mismatch-digest-alerter";
import {
  startLiveChatEmbedProbe,
  stopLiveChatEmbedProbe,
} from "./lib/live-chat-embed-probe";
import { seedBlitzDocs } from "./lib/blitz-seed";
import { bootstrapCriticalPrerequisites } from "./lib/bootstrap-critical-prerequisites";
import { purgeSeedCommunityPosts } from "./lib/seed-post-cleanup";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

if (process.env.REDIS_URL || process.env.GHL_API_KEY) {
  try {
    startWorker();
  } catch (err) {
    console.warn("[GHL Worker] Could not start GHL sync worker:", err);
  }
}

if (process.env.REDIS_URL) {
  try {
    startCommunicationWorkers();
  } catch (err) {
    console.warn("[Server] Could not start communication workers (Redis may be unavailable):", err);
  }
  startSequenceEngine().catch((err) => {
    console.warn("[Sequence Engine] Could not start:", err);
  });
  startScheduledComms().catch((err) => {
    console.warn("[Scheduled Comms] Could not start:", err);
  });
  startRevenuePipeline().catch((err) => {
    console.warn("[Revenue Pipeline] Could not start:", err);
  });
}

startQueueFallbackAlerter();
startSignupChallengeAlerter();
startAuthRateLimitAlerter();
startProductionEnvGuard();
startYseGrantExhaustedAlerter();
startAbuseRateLimitCleanupAlerter();
startRateLimitAuditFailureAlerter();
startMachineMismatchAlerter();
startMachineMismatchDigestJob();
startMachineMismatchDigestAlerter();
startModerationFailureAlerter();
startLiveChatEmbedProbe();

// Run critical prerequisites (YSE product seed + ON CONFLICT constraint check)
// BEFORE accepting traffic so a fresh deploy can never race the
// /api/integrations/machine-purchase endpoint. Drift in the prereqs is logged
// loudly but does NOT block startup — the rest of the API surface still needs
// to come up so other endpoints and the admin UI remain available for the
// operator to investigate.
let server: ReturnType<typeof app.listen> | null = null;
(async () => {
  try {
    await bootstrapCriticalPrerequisites();
  } catch (err) {
    console.error("[Bootstrap] bootstrapCriticalPrerequisites threw — continuing startup:", err);
  }
  await purgeSeedCommunityPosts().catch((err) => {
    console.error("[SeedCleanup] Failed to purge seed posts:", err);
  });
  server = app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    seedBlitzDocs().catch((err) => {
      console.error("[Blitz Seed] Startup seed failed:", err);
    });
  });
})();

async function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received — shutting down gracefully`);
  server?.close();
  await shutdown();
  await stopCommunicationWorkers();
  await shutdownSequenceEngine();
  await shutdownScheduledComms();
  await shutdownRevenuePipeline();
  stopQueueFallbackAlerter();
  stopSignupChallengeAlerter();
  stopAuthRateLimitAlerter();
  stopProductionEnvGuard();
  stopYseGrantExhaustedAlerter();
  stopAbuseRateLimitCleanupAlerter();
  stopRateLimitAuditFailureAlerter();
  stopMachineMismatchAlerter();
  stopMachineMismatchDigestJob();
  stopMachineMismatchDigestAlerter();
  stopModerationFailureAlerter();
  stopLiveChatEmbedProbe();
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
