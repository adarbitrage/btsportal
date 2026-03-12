import {
  db, userProductsTable, productsTable, usersTable, commissionsTable,
  revenueMetricsCacheTable, revenueManualEntriesTable
} from "@workspace/db";
import { eq, and, gte, lte, lt, sql, count, isNull, or } from "drizzle-orm";

export interface RevenueMetrics {
  mrr: number;
  arr: number;
  newRevenue: number;
  expansionRevenue: number;
  churnedRevenue: number;
  netRevenue: number;
  avgLtv: number;
  ltvByProduct: Record<string, number>;
  cac: number;
  ltvCacRatio: number;
  arpu: number;
  churnRate: number;
  retentionRate: number;
  upgradeRate: number;
  refundRate: number;
  revenuePerFunnel: Record<string, number>;
}

function formatPeriod(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthRange(period: string): { start: Date; end: Date } {
  const [year, month] = period.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  return { start, end };
}

export async function computeRevenueMetrics(period?: string): Promise<RevenueMetrics> {
  const now = new Date();
  const currentPeriod = period || formatPeriod(now);
  const { start, end } = getMonthRange(currentPeriod);

  const prevMonthStart = new Date(start);
  prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);

  const allPurchases = await db
    .select({
      id: userProductsTable.id,
      userId: userProductsTable.userId,
      productId: userProductsTable.productId,
      purchasedAt: userProductsTable.purchasedAt,
      expiresAt: userProductsTable.expiresAt,
      status: userProductsTable.status,
      productSlug: productsTable.slug,
      productName: productsTable.name,
      productType: productsTable.type,
      priceDisplay: productsTable.priceDisplay,
      durationDays: productsTable.durationDays,
    })
    .from(userProductsTable)
    .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id));

  const periodPurchases = allPurchases.filter(
    (p) => p.purchasedAt >= start && p.purchasedAt < end
  );

  const activeSubs = allPurchases.filter(
    (p) =>
      p.status === "active" &&
      p.durationDays &&
      (p.expiresAt === null || p.expiresAt >= start)
  );

  const priceMap: Record<string, number> = {};
  for (const p of allPurchases) {
    if (p.priceDisplay) {
      const parsed = parseFloat(p.priceDisplay.replace(/[^0-9.]/g, ""));
      if (!isNaN(parsed)) priceMap[p.productSlug] = parsed * 100;
    }
  }

  function estimatePrice(slug: string): number {
    return priceMap[slug] || 9700;
  }

  let newRevenue = 0;
  let expansionRevenue = 0;
  const userFirstPurchase = new Map<number, Date>();

  for (const p of allPurchases) {
    const existing = userFirstPurchase.get(p.userId);
    if (!existing || p.purchasedAt < existing) {
      userFirstPurchase.set(p.userId, p.purchasedAt);
    }
  }

  for (const p of periodPurchases) {
    const price = estimatePrice(p.productSlug);
    const first = userFirstPurchase.get(p.userId);
    if (first && first >= start && first < end) {
      newRevenue += price;
    } else {
      expansionRevenue += price;
    }
  }

  const cancelledInPeriod = allPurchases.filter(
    (p) =>
      p.status !== "active" &&
      p.expiresAt &&
      p.expiresAt >= start &&
      p.expiresAt < end
  );

  let churnedRevenue = 0;
  for (const p of cancelledInPeriod) {
    churnedRevenue += estimatePrice(p.productSlug);
  }

  const netRevenue = newRevenue + expansionRevenue - churnedRevenue;

  let mrr = 0;
  for (const s of activeSubs) {
    const price = estimatePrice(s.productSlug);
    const months = s.durationDays ? s.durationDays / 30 : 1;
    mrr += price / months;
  }
  const arr = mrr * 12;

  const ltvByProduct: Record<string, number> = {};
  const productRevenue: Record<string, { total: number; count: number }> = {};
  for (const p of allPurchases) {
    const price = estimatePrice(p.productSlug);
    if (!productRevenue[p.productName]) {
      productRevenue[p.productName] = { total: 0, count: 0 };
    }
    productRevenue[p.productName].total += price;
    productRevenue[p.productName].count += 1;
  }
  for (const [name, data] of Object.entries(productRevenue)) {
    ltvByProduct[name] = Math.round(data.total / data.count);
  }

  const uniqueUsers = new Set(allPurchases.map((p) => p.userId));
  const totalRevenue = allPurchases.reduce((sum, p) => sum + estimatePrice(p.productSlug), 0);
  const avgLtv = uniqueUsers.size > 0 ? Math.round(totalRevenue / uniqueUsers.size) : 0;

  const [adSpendRow] = await db
    .select({ value: revenueManualEntriesTable.value })
    .from(revenueManualEntriesTable)
    .where(
      and(
        eq(revenueManualEntriesTable.metric, "ad_spend"),
        eq(revenueManualEntriesTable.period, currentPeriod)
      )
    )
    .limit(1);

  const adSpend = adSpendRow ? parseFloat(adSpendRow.value) : 0;

  const newUsersInPeriod = new Set(
    periodPurchases
      .filter((p) => {
        const first = userFirstPurchase.get(p.userId);
        return first && first >= start && first < end;
      })
      .map((p) => p.userId)
  );

  const cac = newUsersInPeriod.size > 0 && adSpend > 0 ? Math.round(adSpend / newUsersInPeriod.size) : 0;
  const ltvCacRatio = cac > 0 ? parseFloat((avgLtv / cac).toFixed(2)) : 0;

  const activeUsersInPeriod = new Set(
    allPurchases.filter((p) => p.status === "active").map((p) => p.userId)
  );
  const arpu = activeUsersInPeriod.size > 0 ? Math.round(netRevenue / activeUsersInPeriod.size) : 0;

  const prevActiveSubs = allPurchases.filter(
    (p) =>
      p.status === "active" &&
      p.purchasedAt < start
  );
  const prevActiveCount = new Set(prevActiveSubs.map((p) => p.userId)).size;
  const churnedCount = new Set(cancelledInPeriod.map((p) => p.userId)).size;
  const churnRate = prevActiveCount > 0 ? parseFloat((churnedCount / prevActiveCount).toFixed(4)) : 0;
  const retentionRate = parseFloat((1 - churnRate).toFixed(4));

  const frontendUsers = new Set(
    allPurchases
      .filter((p) => p.productType === "frontend" && p.purchasedAt < start)
      .map((p) => p.userId)
  );
  const upgradedUsers = new Set(
    periodPurchases
      .filter((p) => p.productType !== "frontend" && frontendUsers.has(p.userId))
      .map((p) => p.userId)
  );
  const upgradeRate = frontendUsers.size > 0 ? parseFloat((upgradedUsers.size / frontendUsers.size).toFixed(4)) : 0;

  const refundedInPeriod = allPurchases.filter(
    (p) =>
      p.status === "refunded" &&
      p.purchasedAt >= start &&
      p.purchasedAt < end
  );
  const refundRate = periodPurchases.length > 0
    ? parseFloat((refundedInPeriod.length / periodPurchases.length).toFixed(4))
    : 0;

  const revenuePerFunnel: Record<string, number> = {};
  for (const p of periodPurchases) {
    const funnel = p.productSlug || "unknown";
    revenuePerFunnel[funnel] = (revenuePerFunnel[funnel] || 0) + estimatePrice(p.productSlug);
  }

  const metrics: RevenueMetrics = {
    mrr: Math.round(mrr),
    arr: Math.round(arr),
    newRevenue,
    expansionRevenue,
    churnedRevenue,
    netRevenue,
    avgLtv,
    ltvByProduct,
    cac,
    ltvCacRatio,
    arpu,
    churnRate,
    retentionRate,
    upgradeRate,
    refundRate,
    revenuePerFunnel,
  };

  return metrics;
}

export async function cacheMetrics(period: string, metrics: RevenueMetrics): Promise<void> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const entries = Object.entries(metrics).map(([key, value]) => ({
    metricKey: key,
    period,
    value: typeof value === "object" ? "0" : String(value),
    breakdown: typeof value === "object" ? value : null,
    computedAt: new Date(),
    expiresAt,
  }));

  for (const entry of entries) {
    await db
      .insert(revenueMetricsCacheTable)
      .values(entry)
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
}

export async function getCachedMetrics(period: string): Promise<RevenueMetrics | null> {
  const rows = await db
    .select()
    .from(revenueMetricsCacheTable)
    .where(
      and(
        eq(revenueMetricsCacheTable.period, period),
        or(
          isNull(revenueMetricsCacheTable.expiresAt),
          gte(revenueMetricsCacheTable.expiresAt, new Date())
        )
      )
    );

  if (rows.length === 0) return null;

  const result: Record<string, unknown> = {};
  for (const row of rows) {
    if (row.breakdown && typeof row.breakdown === "object") {
      result[row.metricKey] = row.breakdown;
    } else {
      const num = parseFloat(row.value);
      result[row.metricKey] = isNaN(num) ? row.value : num;
    }
  }

  return result as unknown as RevenueMetrics;
}

export async function getMetricsTrend(months: number = 12): Promise<Array<{ period: string; metrics: RevenueMetrics }>> {
  const results: Array<{ period: string; metrics: RevenueMetrics }> = [];
  const now = new Date();

  for (let i = months - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const period = formatPeriod(date);
    const cached = await getCachedMetrics(period);
    if (cached) {
      results.push({ period, metrics: cached });
    }
  }

  return results;
}
