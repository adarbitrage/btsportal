import { db, userProductsTable, productsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export interface CohortPeriod {
  periodIndex: number;
  activeCount: number;
  cumulativeRevenue: number;
  retentionPercent: number;
  upgradePercent: number;
}

export interface Cohort {
  cohortKey: string;
  memberCount: number;
  periods: CohortPeriod[];
}

type CohortDimension = "signup_month" | "source_funnel" | "first_product" | "experience_level";

function formatMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthDiff(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export async function computeCohortAnalysis(
  dimension: CohortDimension = "signup_month",
  maxPeriods: number = 12
): Promise<Cohort[]> {
  const allUsers = await db
    .select({
      id: usersTable.id,
      memberSince: usersTable.memberSince,
      sourceProduct: usersTable.sourceProduct,
      experienceLevel: usersTable.experienceLevel,
    })
    .from(usersTable)
    .where(eq(usersTable.role, "member"));

  const allPurchases = await db
    .select({
      userId: userProductsTable.userId,
      productId: userProductsTable.productId,
      purchasedAt: userProductsTable.purchasedAt,
      status: userProductsTable.status,
      expiresAt: userProductsTable.expiresAt,
      productSlug: productsTable.slug,
      productType: productsTable.type,
      priceDisplay: productsTable.priceDisplay,
    })
    .from(userProductsTable)
    .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id));

  const purchasesByUser = new Map<number, typeof allPurchases>();
  for (const p of allPurchases) {
    if (!purchasesByUser.has(p.userId)) {
      purchasesByUser.set(p.userId, []);
    }
    purchasesByUser.get(p.userId)!.push(p);
  }

  function getCohortKey(user: (typeof allUsers)[0]): string {
    switch (dimension) {
      case "signup_month":
        return formatMonth(user.memberSince);
      case "source_funnel":
        return user.sourceProduct || "unknown";
      case "first_product": {
        const purchases = purchasesByUser.get(user.id) || [];
        if (purchases.length === 0) return "none";
        const sorted = [...purchases].sort((a, b) => a.purchasedAt.getTime() - b.purchasedAt.getTime());
        return sorted[0].productSlug;
      }
      case "experience_level":
        return user.experienceLevel || "unknown";
      default:
        return formatMonth(user.memberSince);
    }
  }

  function estimatePrice(priceDisplay: string | null): number {
    if (!priceDisplay) return 9700;
    const parsed = parseFloat(priceDisplay.replace(/[^0-9.]/g, ""));
    return isNaN(parsed) ? 9700 : parsed * 100;
  }

  const cohortGroups = new Map<string, (typeof allUsers)>();
  for (const user of allUsers) {
    const key = getCohortKey(user);
    if (!cohortGroups.has(key)) {
      cohortGroups.set(key, []);
    }
    cohortGroups.get(key)!.push(user);
  }

  const now = new Date();
  const cohorts: Cohort[] = [];

  for (const [cohortKey, members] of cohortGroups) {
    const memberIds = new Set(members.map((m) => m.id));
    const cohortStart = members.reduce(
      (min, m) => (m.memberSince < min ? m.memberSince : min),
      members[0].memberSince
    );

    const periods: CohortPeriod[] = [];
    const periodsToCompute = Math.min(maxPeriods, monthDiff(cohortStart, now) + 1);

    for (let i = 0; i < periodsToCompute; i++) {
      const periodStart = new Date(cohortStart.getFullYear(), cohortStart.getMonth() + i, 1);
      const periodEnd = new Date(cohortStart.getFullYear(), cohortStart.getMonth() + i + 1, 1);

      if (periodStart > now) break;

      let activeCount = 0;
      let cumulativeRevenue = 0;
      let upgradedCount = 0;

      for (const memberId of memberIds) {
        const purchases = purchasesByUser.get(memberId) || [];
        const hasActiveInPeriod = purchases.some(
          (p) =>
            p.purchasedAt <= periodEnd &&
            (p.status === "active" || p.purchasedAt >= periodStart) &&
            (!p.expiresAt || p.expiresAt >= periodStart)
        );

        if (hasActiveInPeriod) activeCount++;

        for (const p of purchases) {
          if (p.purchasedAt <= periodEnd) {
            cumulativeRevenue += estimatePrice(p.priceDisplay);
          }
        }

        const firstPurchase = purchases
          .filter((p) => p.productType === "frontend")
          .sort((a, b) => a.purchasedAt.getTime() - b.purchasedAt.getTime())[0];

        if (firstPurchase) {
          const hasUpgrade = purchases.some(
            (p) =>
              p.productType !== "frontend" &&
              p.purchasedAt <= periodEnd &&
              p.purchasedAt > firstPurchase.purchasedAt
          );
          if (hasUpgrade) upgradedCount++;
        }
      }

      periods.push({
        periodIndex: i,
        activeCount,
        cumulativeRevenue: Math.round(cumulativeRevenue),
        retentionPercent: members.length > 0 ? parseFloat((activeCount / members.length).toFixed(4)) : 0,
        upgradePercent: members.length > 0 ? parseFloat((upgradedCount / members.length).toFixed(4)) : 0,
      });
    }

    cohorts.push({
      cohortKey,
      memberCount: members.length,
      periods,
    });
  }

  cohorts.sort((a, b) => a.cohortKey.localeCompare(b.cohortKey));
  return cohorts;
}
