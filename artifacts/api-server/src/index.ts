import app from "./app";
import { startWorker, shutdown } from "./lib/ghl-queue";

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

const server = app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

async function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received — shutting down gracefully`);
  server.close();
  await shutdown();
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
