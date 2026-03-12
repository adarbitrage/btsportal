import { Router, type Request, type Response } from "express";
import { db, usersTable, revenueManualEntriesTable, memberHealthScoresTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { computeRevenueMetrics, getCachedMetrics, getMetricsTrend } from "../lib/revenue-metrics";
import { computeCohortAnalysis } from "../lib/cohort-analysis";
import { computeMemberHealthScore, computeAllHealthScores, getHealthScoreDistribution } from "../lib/member-health";
import { computeChurnRisks, computeUpgradeCandidates } from "../lib/churn-upgrade-scoring";
import { computeFunnelPerformance, computeLTVAnalysis } from "../lib/funnel-performance";
import { computeRevenueForecast } from "../lib/revenue-forecasting";
import { triggerForceRecompute, getCachedPipelineResult } from "../lib/revenue-pipeline";

const router = Router();

async function requireAdmin(req: Request, res: Response): Promise<boolean> {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }
  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId))
    .limit(1);
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

router.get("/admin/revenue/overview", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const period = (req.query.period as string) || undefined;
    const cached = period ? await getCachedMetrics(period) : null;
    const metrics = cached || await computeRevenueMetrics(period);

    res.json({ metrics, cached: !!cached });
  } catch (err) {
    console.error("[Admin Revenue] Overview error:", err);
    res.status(500).json({ error: "Failed to compute revenue overview" });
  }
});

router.get("/admin/revenue/trend", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const months = parseInt(req.query.months as string) || 12;
    const trend = await getMetricsTrend(months);

    res.json({ trend, months });
  } catch (err) {
    console.error("[Admin Revenue] Trend error:", err);
    res.status(500).json({ error: "Failed to get revenue trend" });
  }
});

router.get("/admin/revenue/cohorts", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const dimension = (req.query.dimension as string) || "signup_month";
    const maxPeriods = parseInt(req.query.maxPeriods as string) || 12;

    const validDimensions = ["signup_month", "source_funnel", "first_product", "experience_level"];
    if (!validDimensions.includes(dimension)) {
      res.status(400).json({ error: `Invalid dimension. Must be one of: ${validDimensions.join(", ")}` });
      return;
    }

    const cacheKey = `cohort_analysis_${dimension}`;
    const cached = await getCachedPipelineResult<unknown>(cacheKey);
    if (cached && !req.query.fresh) {
      res.json({ cohorts: cached, cached: true });
      return;
    }

    const cohorts = await computeCohortAnalysis(
      dimension as "signup_month" | "source_funnel" | "first_product" | "experience_level",
      maxPeriods
    );

    res.json({ cohorts, cached: false });
  } catch (err) {
    console.error("[Admin Revenue] Cohorts error:", err);
    res.status(500).json({ error: "Failed to compute cohort analysis" });
  }
});

router.get("/admin/revenue/health-scores", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const distribution = await getHealthScoreDistribution();

    const recentScores = await db
      .select({
        userId: memberHealthScoresTable.userId,
        score: memberHealthScoresTable.score,
        riskLevel: memberHealthScoresTable.riskLevel,
        trend: memberHealthScoresTable.trend,
        churnProbability: memberHealthScoresTable.churnProbability,
        upgradeProbability: memberHealthScoresTable.upgradeProbability,
        computedAt: memberHealthScoresTable.computedAt,
      })
      .from(memberHealthScoresTable)
      .orderBy(desc(memberHealthScoresTable.computedAt))
      .limit(100);

    res.json({ distribution, recentScores });
  } catch (err) {
    console.error("[Admin Revenue] Health scores error:", err);
    res.status(500).json({ error: "Failed to get health scores" });
  }
});

router.get("/admin/revenue/health-scores/:userId", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const userId = parseInt(req.params.userId as string);
    if (isNaN(userId)) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }

    const fresh = req.query.fresh === "true";
    let currentScore;

    if (fresh) {
      currentScore = await computeMemberHealthScore(userId);
    }

    const history = await db
      .select()
      .from(memberHealthScoresTable)
      .where(eq(memberHealthScoresTable.userId, userId))
      .orderBy(desc(memberHealthScoresTable.computedAt))
      .limit(30);

    res.json({ userId, currentScore: currentScore || null, history });
  } catch (err) {
    console.error("[Admin Revenue] Health score detail error:", err);
    res.status(500).json({ error: "Failed to get health score" });
  }
});

router.get("/admin/revenue/churn-risks", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const cached = await getCachedPipelineResult<unknown>("churn_risks");
    if (cached && !req.query.fresh) {
      res.json({ risks: cached, cached: true });
      return;
    }

    const risks = await computeChurnRisks();
    res.json({ risks, cached: false });
  } catch (err) {
    console.error("[Admin Revenue] Churn risks error:", err);
    res.status(500).json({ error: "Failed to compute churn risks" });
  }
});

router.get("/admin/revenue/upgrade-candidates", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const cached = await getCachedPipelineResult<unknown>("upgrade_candidates");
    if (cached && !req.query.fresh) {
      res.json({ candidates: cached, cached: true });
      return;
    }

    const candidates = await computeUpgradeCandidates();
    res.json({ candidates, cached: false });
  } catch (err) {
    console.error("[Admin Revenue] Upgrade candidates error:", err);
    res.status(500).json({ error: "Failed to compute upgrade candidates" });
  }
});

router.get("/admin/revenue/funnels", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const cached = await getCachedPipelineResult<unknown>("funnel_performance");
    if (cached && !req.query.fresh) {
      res.json({ funnels: cached, cached: true });
      return;
    }

    const funnels = await computeFunnelPerformance();
    res.json({ funnels, cached: false });
  } catch (err) {
    console.error("[Admin Revenue] Funnels error:", err);
    res.status(500).json({ error: "Failed to compute funnel performance" });
  }
});

router.get("/admin/revenue/ltv", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const segmentBy = (req.query.segmentBy as string) || "first_product";
    const validSegments = ["first_product", "experience_level", "funnel_source"];
    if (!validSegments.includes(segmentBy)) {
      res.status(400).json({ error: `Invalid segmentBy. Must be one of: ${validSegments.join(", ")}` });
      return;
    }

    const cacheKey = `ltv_by_${segmentBy === "first_product" ? "product" : segmentBy === "experience_level" ? "level" : "funnel"}`;
    const cached = await getCachedPipelineResult<unknown>(cacheKey);
    if (cached && !req.query.fresh) {
      res.json({ segments: cached, segmentBy, cached: true });
      return;
    }

    const segments = await computeLTVAnalysis(segmentBy as "first_product" | "experience_level" | "funnel_source");
    res.json({ segments, segmentBy, cached: false });
  } catch (err) {
    console.error("[Admin Revenue] LTV error:", err);
    res.status(500).json({ error: "Failed to compute LTV analysis" });
  }
});

router.get("/admin/revenue/forecast", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const months = parseInt(req.query.months as string) || 6;

    const cacheKey = `revenue_forecast_${months}`;
    const cached = await getCachedPipelineResult<unknown>(cacheKey);
    if (cached && !req.query.fresh) {
      res.json({ forecast: cached, cached: true });
      return;
    }

    const forecast = await computeRevenueForecast(months);
    res.json({ forecast, cached: false });
  } catch (err) {
    console.error("[Admin Revenue] Forecast error:", err);
    res.status(500).json({ error: "Failed to compute revenue forecast" });
  }
});

router.post("/admin/revenue/manual-entry", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const { metric, period, value, source, notes } = req.body;

    if (!metric || !period || value === undefined) {
      res.status(400).json({ error: "metric, period, and value are required" });
      return;
    }

    const validMetrics = ["ad_spend", "external_revenue", "cac_override", "custom"];
    if (!validMetrics.includes(metric)) {
      res.status(400).json({ error: `Invalid metric. Must be one of: ${validMetrics.join(", ")}` });
      return;
    }

    const [entry] = await db
      .insert(revenueManualEntriesTable)
      .values({
        metric,
        period,
        value: String(value),
        source: source || null,
        notes: notes || null,
        createdBy: req.userId,
      })
      .onConflictDoUpdate({
        target: [revenueManualEntriesTable.metric, revenueManualEntriesTable.period],
        set: {
          value: sql`excluded.value`,
          source: sql`excluded.source`,
          notes: sql`excluded.notes`,
          createdBy: sql`excluded.created_by`,
          updatedAt: sql`now()`,
        },
      })
      .returning();

    res.json({ entry });
  } catch (err) {
    console.error("[Admin Revenue] Manual entry error:", err);
    res.status(500).json({ error: "Failed to create manual entry" });
  }
});

router.post("/admin/revenue/recompute", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const result = await triggerForceRecompute();
    res.json(result);
  } catch (err) {
    console.error("[Admin Revenue] Recompute error:", err);
    res.status(500).json({ error: "Failed to trigger recompute" });
  }
});

export default router;
