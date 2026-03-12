import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { isRedisConnected } from "../lib/redis";

const router: IRouter = Router();

router.get("/v1/health", async (_req, res) => {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

  const dbStart = Date.now();
  try {
    await pool.query("SELECT 1");
    checks.database = { status: "healthy", latencyMs: Date.now() - dbStart };
  } catch (err: any) {
    checks.database = { status: "unhealthy", latencyMs: Date.now() - dbStart, error: err.message };
  }

  const redisStart = Date.now();
  try {
    const connected = await isRedisConnected();
    checks.redis = {
      status: connected ? "healthy" : "unavailable",
      latencyMs: Date.now() - redisStart,
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
  const overallStatus = allHealthy ? "healthy" : "degraded";

  res.status(allHealthy ? 200 : 503).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: "v1",
    services: checks,
  });
});

export default router;
