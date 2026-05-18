import { Router, type IRouter } from "express";
import { db, upgradePromptEventsTable } from "@workspace/db";
import { and, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";
import { sendError, ErrorCodes } from "../lib/api-errors";
import { abuseRateLimit } from "../middleware/abuse-rate-limit";

const router: IRouter = Router();

const VALID_EVENT_TYPES = new Set(["impression", "cta_click"]);
const VALID_VARIANTS = new Set(["dashboard", "sidebar"]);
const MAX_FEATURE_KEYS = 32;
const MAX_FEATURE_KEY_LENGTH = 64;
const MAX_TIER_LENGTH = 64;

const MAX_RANGE_DAYS = 366;
const DEFAULT_RANGE_DAYS = 30;
const TOP_FEATURE_COMBOS_LIMIT = 10;

// Bucket the daily-trend response based on the requested span so the chart
// stays legible and the payload stays small. At a year of daily bars the
// chart is unreadable; weekly buckets keep a 12-month view in roughly the
// same shape as the default 30-day daily view.
const WEEKLY_BUCKET_THRESHOLD_DAYS = 90;
const MONTHLY_BUCKET_THRESHOLD_DAYS = 365;

export type TrendGranularity = "day" | "week" | "month";

export function pickTrendGranularity(spanDays: number): TrendGranularity {
  if (spanDays > MONTHLY_BUCKET_THRESHOLD_DAYS) return "month";
  if (spanDays > WEEKLY_BUCKET_THRESHOLD_DAYS) return "week";
  return "day";
}

// Per-user cap on POST /analytics/events. The portal client de-dupes
// impressions per render, so a real member only emits a handful of events
// per page navigation (one impression + an optional cta_click for each of
// the dashboard and sidebar variants). 120 events / 60s leaves plenty of
// headroom for fast browsing across many tiers/feature combos while still
// shutting down a tight loop or scripted abuser before they can pile
// millions of rows into `upgrade_prompt_events`.
export const ANALYTICS_EVENTS_RATE_LIMIT = {
  maxRequests: 120,
  windowSeconds: 60,
} as const;

const analyticsEventsUserLimiter = abuseRateLimit({
  name: "analytics-events",
  maxRequests: ANALYTICS_EVENTS_RATE_LIMIT.maxRequests,
  windowSeconds: ANALYTICS_EVENTS_RATE_LIMIT.windowSeconds,
  // Keyed off the authenticated user only. The route handler below requires
  // authentication, so an anonymous flood is already short-circuited with a
  // 401 before any DB write happens — no IP-level backstop needed, which
  // also avoids tripping the limiter for many distinct members sitting
  // behind a single NAT'd egress IP. Returning null when there's no
  // userId simply lets the request fall through to the 401 check.
  keyResolver: (req) =>
    typeof req.userId === "number" ? `analytics-events:user:${req.userId}` : null,
  message: "Too many analytics events. Please slow down.",
});

function sanitizeFeatureKeys(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  if (input.length > MAX_FEATURE_KEYS) return null;
  const out: string[] = [];
  for (const v of input) {
    if (typeof v !== "string") return null;
    if (v.length === 0 || v.length > MAX_FEATURE_KEY_LENGTH) return null;
    out.push(v);
  }
  return out;
}

router.post("/analytics/events", analyticsEventsUserLimiter, async (req, res): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const { eventType, variant, sourceTier, lockedFeatureKeys } = req.body ?? {};

  if (typeof eventType !== "string" || !VALID_EVENT_TYPES.has(eventType)) {
    res.status(400).json({ error: "Invalid eventType" });
    return;
  }
  if (typeof variant !== "string" || !VALID_VARIANTS.has(variant)) {
    res.status(400).json({ error: "Invalid variant" });
    return;
  }
  if (typeof sourceTier !== "string" || sourceTier.length === 0 || sourceTier.length > MAX_TIER_LENGTH) {
    res.status(400).json({ error: "Invalid sourceTier" });
    return;
  }
  const featureKeys = sanitizeFeatureKeys(lockedFeatureKeys);
  if (featureKeys === null) {
    res.status(400).json({ error: "Invalid lockedFeatureKeys" });
    return;
  }

  await db.insert(upgradePromptEventsTable).values({
    userId: req.userId,
    eventType,
    variant,
    sourceTier,
    lockedFeatureKeys: featureKeys,
  });

  res.status(204).end();
});

interface AggregateRow {
  variant: string;
  sourceTier: string;
  impressions: number;
  clicks: number;
}

interface FeatureComboRow {
  comboKey: string;
  impressions: number;
  clicks: number;
}

interface TrendRow {
  bucket: string;
  impressions: number;
  clicks: number;
}

function ratePercent(clicks: number, impressions: number): number {
  if (impressions <= 0) return 0;
  return Math.round((clicks / impressions) * 1000) / 10;
}

function parseRange(
  query: Record<string, unknown>,
): { from: Date; to: Date; spanDays: number } | null {
  const rawFrom = typeof query.from === "string" ? query.from : null;
  const rawTo = typeof query.to === "string" ? query.to : null;

  const now = new Date();
  let to = now;
  if (rawTo) {
    const parsed = new Date(rawTo);
    if (Number.isNaN(parsed.getTime())) return null;
    to = parsed;
  }

  let from: Date;
  if (rawFrom) {
    const parsed = new Date(rawFrom);
    if (Number.isNaN(parsed.getTime())) return null;
    from = parsed;
  } else {
    from = new Date(to.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  }

  if (from.getTime() > to.getTime()) return null;
  const spanDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
  if (spanDays > MAX_RANGE_DAYS) return null;

  return { from, to, spanDays };
}

router.get(
  "/admin/analytics/upgrade-prompts",
  requirePermission("revenue:view"),
  async (req, res): Promise<void> => {
    const range = parseRange(req.query as Record<string, unknown>);
    if (!range) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "Invalid date range");
      return;
    }

    const rawVariant = typeof req.query.variant === "string" ? req.query.variant : "";
    const rawSourceTier = typeof req.query.sourceTier === "string" ? req.query.sourceTier : "";

    if (rawVariant && !VALID_VARIANTS.has(rawVariant)) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "Invalid variant");
      return;
    }
    if (rawSourceTier && (rawSourceTier.length === 0 || rawSourceTier.length > MAX_TIER_LENGTH)) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "Invalid sourceTier");
      return;
    }

    const conditions: SQL[] = [
      gte(upgradePromptEventsTable.createdAt, range.from),
      lte(upgradePromptEventsTable.createdAt, range.to),
    ];
    if (rawVariant) {
      conditions.push(eq(upgradePromptEventsTable.variant, rawVariant));
    }
    if (rawSourceTier) {
      conditions.push(eq(upgradePromptEventsTable.sourceTier, rawSourceTier));
    }
    const where = and(...conditions);

    const aggregateRows = (await db
      .select({
        variant: upgradePromptEventsTable.variant,
        sourceTier: upgradePromptEventsTable.sourceTier,
        impressions: sql<number>`sum(case when ${upgradePromptEventsTable.eventType} = 'impression' then 1 else 0 end)::int`,
        clicks: sql<number>`sum(case when ${upgradePromptEventsTable.eventType} = 'cta_click' then 1 else 0 end)::int`,
      })
      .from(upgradePromptEventsTable)
      .where(where)
      .groupBy(upgradePromptEventsTable.variant, upgradePromptEventsTable.sourceTier)) as AggregateRow[];

    const granularity = pickTrendGranularity(range.spanDays);
    // `date_trunc('week', ...)` uses ISO weeks (Monday-start) which matches
    // the "Week of <Mon>" label we render on the chart. `granularity` is a
    // controlled enum (day|week|month) so it's safe to inline as a SQL literal.
    const bucketUnitLiteral = sql.raw(`'${granularity}'`);
    const bucketExpr = sql<string>`to_char(date_trunc(${bucketUnitLiteral}, ${upgradePromptEventsTable.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
    const trendRows = (await db
      .select({
        bucket: bucketExpr.as("bucket"),
        impressions: sql<number>`sum(case when ${upgradePromptEventsTable.eventType} = 'impression' then 1 else 0 end)::int`,
        clicks: sql<number>`sum(case when ${upgradePromptEventsTable.eventType} = 'cta_click' then 1 else 0 end)::int`,
      })
      .from(upgradePromptEventsTable)
      .where(where)
      .groupBy(bucketExpr)
      .orderBy(bucketExpr)) as TrendRow[];

    const comboKeyExpr = sql<string>`coalesce((select string_agg(value, '|' order by value) from jsonb_array_elements_text(${upgradePromptEventsTable.lockedFeatureKeys}) as t(value)), '')`;
    const comboRows = (await db
      .select({
        comboKey: comboKeyExpr.as("combo_key"),
        impressions: sql<number>`sum(case when ${upgradePromptEventsTable.eventType} = 'impression' then 1 else 0 end)::int`,
        clicks: sql<number>`sum(case when ${upgradePromptEventsTable.eventType} = 'cta_click' then 1 else 0 end)::int`,
      })
      .from(upgradePromptEventsTable)
      .where(where)
      .groupBy(comboKeyExpr)
      .orderBy(sql`sum(case when ${upgradePromptEventsTable.eventType} = 'cta_click' then 1 else 0 end) desc`)
      .limit(TOP_FEATURE_COMBOS_LIMIT)) as FeatureComboRow[];

    const totals = { impressions: 0, clicks: 0 };
    const variantMap = new Map<string, { impressions: number; clicks: number }>();
    const tierMap = new Map<string, { impressions: number; clicks: number }>();

    for (const row of aggregateRows) {
      const impressions = Number(row.impressions) || 0;
      const clicks = Number(row.clicks) || 0;
      totals.impressions += impressions;
      totals.clicks += clicks;

      const v = variantMap.get(row.variant) ?? { impressions: 0, clicks: 0 };
      v.impressions += impressions;
      v.clicks += clicks;
      variantMap.set(row.variant, v);

      const t = tierMap.get(row.sourceTier) ?? { impressions: 0, clicks: 0 };
      t.impressions += impressions;
      t.clicks += clicks;
      tierMap.set(row.sourceTier, t);
    }

    const byVariant = Array.from(variantMap.entries())
      .map(([variant, agg]) => ({
        variant,
        impressions: agg.impressions,
        clicks: agg.clicks,
        ctr: ratePercent(agg.clicks, agg.impressions),
      }))
      .sort((a, b) => b.clicks - a.clicks);

    const byTier = Array.from(tierMap.entries())
      .map(([sourceTier, agg]) => ({
        sourceTier,
        impressions: agg.impressions,
        clicks: agg.clicks,
        ctr: ratePercent(agg.clicks, agg.impressions),
      }))
      .sort((a, b) => b.clicks - a.clicks);

    const trend = trendRows.map((row) => {
      const impressions = Number(row.impressions) || 0;
      const clicks = Number(row.clicks) || 0;
      return {
        bucket: row.bucket,
        impressions,
        clicks,
        ctr: ratePercent(clicks, impressions),
      };
    });

    const topFeatureCombos = comboRows.map((row) => {
      const impressions = Number(row.impressions) || 0;
      const clicks = Number(row.clicks) || 0;
      const keys = row.comboKey === "" ? [] : row.comboKey.split("|");
      return {
        keys,
        impressions,
        clicks,
        ctr: ratePercent(clicks, impressions),
      };
    });

    res.json({
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      granularity,
      totals: {
        impressions: totals.impressions,
        clicks: totals.clicks,
        ctr: ratePercent(totals.clicks, totals.impressions),
      },
      byVariant,
      byTier,
      trend,
      topFeatureCombos,
    });
  },
);

export default router;
