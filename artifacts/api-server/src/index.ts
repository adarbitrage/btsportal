import app from "./app";
import { startWorker, shutdown } from "./lib/ghl-queue";
import { startCommunicationWorkers, stopCommunicationWorkers } from "./lib/communication-worker";
import { startSequenceEngine, shutdownSequenceEngine } from "./lib/sequence-engine";
import { startScheduledComms, shutdownScheduledComms } from "./lib/scheduled-comms";

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
}

const server = app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

async function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received — shutting down gracefully`);
  server.close();
  await shutdown();
  await stopCommunicationWorkers();
  await shutdownSequenceEngine();
  await shutdownScheduledComms();
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
