import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { isRedisConnected } from "../lib/redis";
import { getQueueFallbackStats } from "../lib/queue-fallback-tracker";

const router: IRouter = Router();

router.get("/v1/health", async (_req, res) => {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string; details?: unknown }> = {};

  const dbStart = Date.now();
  try {
    await pool.query("SELECT 1");
    checks.database = { status: "healthy", latencyMs: Date.now() - dbStart };
  } catch (err: any) {
    checks.database = { status: "unhealthy", latencyMs: Date.now() - dbStart, error: err.message };
  }

  const queueFallbacks = getQueueFallbackStats();

  const redisStart = Date.now();
  try {
    const connected = await isRedisConnected();
    let status: string;
    if (!connected) {
      status = "unavailable";
    } else if (queueFallbacks.alerting) {
      // Redis answered a ping but the queue had to fall back recently —
      // this is the window where the connection is flapping or the worker
      // is stuck. Surface it as degraded so on-call can investigate.
      status = "degraded";
    } else {
      status = "healthy";
    }
    checks.redis = {
      status,
      latencyMs: Date.now() - redisStart,
      details: { queueFallbacks },
    };
  } catch (err: any) {
    checks.redis = { status: "unhealthy", latencyMs: Date.now() - redisStart, error: err.message };
  }

  checks.sendgrid = {
    status: process.env.SENDGRID_API_KEY ? "configured" : "not_configured",
  };

  checks.twilio = {
    status: process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN ? "configured" : "not_configured",
  };

  const allHealthy = checks.database.status === "healthy";
  const overallStatus = allHealthy
    ? queueFallbacks.alerting ? "degraded" : "healthy"
    : "degraded";

  // Still 200 when only Redis is degraded — the direct-send fallback keeps
  // user-facing behavior intact, so we don't want orchestrators yanking the
  // pod. Database failure is the only thing that returns 503.
  res.status(allHealthy ? 200 : 503).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: "v1",
    services: checks,
    queueFallbacks,
  });
});

export default router;
