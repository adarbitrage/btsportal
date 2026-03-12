import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { computeRevenueMetrics, cacheMetrics } from "./revenue-metrics";
import { computeCohortAnalysis } from "./cohort-analysis";
import { computeAllHealthScores } from "./member-health";
import { computeChurnRisks, computeUpgradeCandidates } from "./churn-upgrade-scoring";
import { computeFunnelPerformance, computeLTVAnalysis } from "./funnel-performance";
import { computeRevenueForecast } from "./revenue-forecasting";
import { db, revenueMetricsCacheTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const QUEUE_NAME = "revenue-metrics";

let connection: IORedis | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;

function getConnection(): ConnectionOptions {
  if (!connection) {
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    connection.on("error", (err) => {
      console.error("[Revenue Pipeline] Redis connection error:", err.message);
    });
  }
  return connection as unknown as ConnectionOptions;
}

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 30000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return queue;
}

function formatPeriod(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function runFullPipeline(): Promise<{ success: boolean; results: Record<string, unknown> }> {
  const startTime = Date.now();
  const now = new Date();
  const currentPeriod = formatPeriod(now);
  const results: Record<string, unknown> = {};

  try {
    console.log("[Revenue Pipeline] Starting full computation pipeline...");

    console.log("[Revenue Pipeline] Computing core revenue metrics...");
    const metrics = await computeRevenueMetrics(currentPeriod);
    await cacheMetrics(currentPeriod, metrics);
    results.metrics = { period: currentPeriod, computed: true };

    console.log("[Revenue Pipeline] Computing cohort analysis...");
    const cohortDimensions = ["signup_month", "source_funnel", "first_product", "experience_level"] as const;
    for (const dim of cohortDimensions) {
      const cohorts = await computeCohortAnalysis(dim, 12);
      await cachePipelineResult(`cohort_analysis_${dim}`, currentPeriod, cohorts);
    }
    const defaultCohorts = await computeCohortAnalysis("signup_month", 12);
    results.cohorts = { count: defaultCohorts.length, dimensions: cohortDimensions.length };

    console.log("[Revenue Pipeline] Computing member health scores...");
    const healthCount = await computeAllHealthScores();
    results.healthScores = { membersProcessed: healthCount };

    console.log("[Revenue Pipeline] Computing churn risks...");
    const churnRisks = await computeChurnRisks();
    await cachePipelineResult("churn_risks", currentPeriod, churnRisks);
    results.churnRisks = { count: churnRisks.length };

    console.log("[Revenue Pipeline] Computing upgrade candidates...");
    const upgradeCandidates = await computeUpgradeCandidates();
    await cachePipelineResult("upgrade_candidates", currentPeriod, upgradeCandidates);
    results.upgradeCandidates = { count: upgradeCandidates.length };

    console.log("[Revenue Pipeline] Computing funnel performance...");
    const funnels = await computeFunnelPerformance();
    await cachePipelineResult("funnel_performance", currentPeriod, funnels);
    results.funnelPerformance = { funnelCount: funnels.length };

    console.log("[Revenue Pipeline] Computing LTV analysis...");
    const ltvByProduct = await computeLTVAnalysis("first_product");
    const ltvByLevel = await computeLTVAnalysis("experience_level");
    const ltvByFunnel = await computeLTVAnalysis("funnel_source");
    await cachePipelineResult("ltv_by_product", currentPeriod, ltvByProduct);
    await cachePipelineResult("ltv_by_level", currentPeriod, ltvByLevel);
    await cachePipelineResult("ltv_by_funnel", currentPeriod, ltvByFunnel);
    results.ltvAnalysis = { byProduct: ltvByProduct.length, byLevel: ltvByLevel.length, byFunnel: ltvByFunnel.length };

    console.log("[Revenue Pipeline] Computing revenue forecast...");
    const forecast12 = await computeRevenueForecast(12);
    await cachePipelineResult("revenue_forecast_12", currentPeriod, forecast12);
    const forecast6 = await computeRevenueForecast(6);
    await cachePipelineResult("revenue_forecast_6", currentPeriod, forecast6);
    results.forecast = { periods: forecast12.periods.length };

    const elapsed = Date.now() - startTime;
    console.log(`[Revenue Pipeline] Full pipeline completed in ${elapsed}ms`);
    results.elapsedMs = elapsed;

    return { success: true, results };
  } catch (err) {
    console.error("[Revenue Pipeline] Pipeline failed:", err);
    return { success: false, results: { error: String(err) } };
  }
}

async function cachePipelineResult(key: string, period: string, data: unknown): Promise<void> {
  await db
    .insert(revenueMetricsCacheTable)
    .values({
      metricKey: key,
      period,
      value: "0",
      breakdown: data,
      computedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .onConflictDoUpdate({
      target: [revenueMetricsCacheTable.metricKey, revenueMetricsCacheTable.period],
      set: {
        value: sql`excluded.value`,
        breakdown: sql`excluded.breakdown`,
        computedAt: sql`excluded.computed_at`,
        expiresAt: sql`excluded.expires_at`,
      },
    });
}

export async function getCachedPipelineResult<T>(key: string, period?: string): Promise<T | null> {
  const targetPeriod = period || formatPeriod(new Date());

  const [row] = await db
    .select({ breakdown: revenueMetricsCacheTable.breakdown })
    .from(revenueMetricsCacheTable)
    .where(
      and(
        eq(revenueMetricsCacheTable.metricKey, key),
        eq(revenueMetricsCacheTable.period, targetPeriod)
      )
    )
    .limit(1);

  if (!row || !row.breakdown) return null;
  return row.breakdown as T;
}

export async function startRevenuePipeline(): Promise<void> {
  const q = getQueue();

  worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      console.log(`[Revenue Pipeline] Processing job: ${job.name}`);
      const result = await runFullPipeline();
      return result;
    },
    {
      connection: getConnection(),
      concurrency: 1,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[Revenue Pipeline] Job ${job?.name} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[Revenue Pipeline] Job ${job?.name} failed:`, err.message);
  });

  const existingJobs = await q.getRepeatableJobs();
  for (const job of existingJobs) {
    await q.removeRepeatableByKey(job.key);
  }

  await q.add("computeRevenueMetrics", {}, {
    repeat: {
      pattern: "0 2 * * *",
    },
  });

  console.log("[Revenue Pipeline] Worker started, nightly job scheduled at 2 AM");
}

export async function triggerForceRecompute(): Promise<{ success: boolean; results: Record<string, unknown> }> {
  return runFullPipeline();
}

export async function shutdownRevenuePipeline(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (connection) {
    connection.disconnect();
    connection = null;
  }
  console.log("[Revenue Pipeline] Shutdown complete");
}
