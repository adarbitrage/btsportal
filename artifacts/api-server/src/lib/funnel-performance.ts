import { db, userProductsTable, productsTable, usersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

export interface FunnelMetrics {
  funnelSlug: string;
  funnelName: string;
  totalPurchases: number;
  totalRevenue: number;
  refundCount: number;
  refundRate: number;
  upgradeCount: number;
  upgradeRate: number;
  avgLtv: number;
}

export interface LTVSegment {
  segmentKey: string;
  segmentValue: string;
  avgLtv: number;
  memberCount: number;
  totalRevenue: number;
}

function estimatePrice(priceDisplay: string | null): number {
  if (!priceDisplay) return 9700;
  const parsed = parseFloat(priceDisplay.replace(/[^0-9.]/g, ""));
  return isNaN(parsed) ? 9700 : parsed * 100;
}

export async function computeFunnelPerformance(): Promise<FunnelMetrics[]> {
  const allPurchases = await db
    .select({
      userId: userProductsTable.userId,
      productId: userProductsTable.productId,
      status: userProductsTable.status,
      purchasedAt: userProductsTable.purchasedAt,
      productSlug: productsTable.slug,
      productName: productsTable.name,
      productType: productsTable.type,
      priceDisplay: productsTable.priceDisplay,
    })
    .from(userProductsTable)
    .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id));

  const frontendProducts = allPurchases.filter((p) => p.productType === "frontend");
  const funnelMap = new Map<string, typeof allPurchases>();

  for (const p of frontendProducts) {
    if (!funnelMap.has(p.productSlug)) {
      funnelMap.set(p.productSlug, []);
    }
    funnelMap.get(p.productSlug)!.push(p);
  }

  const purchasesByUser = new Map<number, typeof allPurchases>();
  for (const p of allPurchases) {
    if (!purchasesByUser.has(p.userId)) {
      purchasesByUser.set(p.userId, []);
    }
    purchasesByUser.get(p.userId)!.push(p);
  }

  const funnels: FunnelMetrics[] = [];

  for (const [slug, purchases] of funnelMap) {
    const totalPurchases = purchases.length;
    let totalRevenue = 0;
    let refundCount = 0;
    const upgradedUsers = new Set<number>();
    const uniqueUsers = new Set<number>();

    for (const p of purchases) {
      const price = estimatePrice(p.priceDisplay);
      totalRevenue += price;
      uniqueUsers.add(p.userId);

      if (p.status === "refunded") {
        refundCount++;
      }

      const userPurchases = purchasesByUser.get(p.userId) || [];
      const hasUpgrade = userPurchases.some(
        (up) => up.productType !== "frontend" && up.purchasedAt > p.purchasedAt
      );
      if (hasUpgrade) {
        upgradedUsers.add(p.userId);
      }
    }

    for (const uid of uniqueUsers) {
      const allUserPurchases = purchasesByUser.get(uid) || [];
      for (const up of allUserPurchases) {
        if (up.productType !== "frontend") {
          totalRevenue += estimatePrice(up.priceDisplay);
        }
      }
    }

    funnels.push({
      funnelSlug: slug,
      funnelName: purchases[0]?.productName || slug,
      totalPurchases,
      totalRevenue: Math.round(totalRevenue),
      refundCount,
      refundRate: totalPurchases > 0 ? parseFloat((refundCount / totalPurchases).toFixed(4)) : 0,
      upgradeCount: upgradedUsers.size,
      upgradeRate: uniqueUsers.size > 0 ? parseFloat((upgradedUsers.size / uniqueUsers.size).toFixed(4)) : 0,
      avgLtv: uniqueUsers.size > 0 ? Math.round(totalRevenue / uniqueUsers.size) : 0,
    });
  }

  funnels.sort((a, b) => b.totalRevenue - a.totalRevenue);
  return funnels;
}

export async function computeLTVAnalysis(segmentBy: "first_product" | "experience_level" | "funnel_source" = "first_product"): Promise<LTVSegment[]> {
  const allUsers = await db
    .select({
      id: usersTable.id,
      sourceProduct: usersTable.sourceProduct,
      experienceLevel: usersTable.experienceLevel,
    })
    .from(usersTable)
    .where(eq(usersTable.role, "member"));

  const allPurchases = await db
    .select({
      userId: userProductsTable.userId,
      productSlug: productsTable.slug,
      productName: productsTable.name,
      productType: productsTable.type,
      purchasedAt: userProductsTable.purchasedAt,
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

  const segments = new Map<string, { users: Set<number>; totalRevenue: number }>();

  for (const user of allUsers) {
    let segmentValue: string;
    const userPurchases = purchasesByUser.get(user.id) || [];

    switch (segmentBy) {
      case "first_product": {
        if (userPurchases.length === 0) continue;
        const sorted = [...userPurchases].sort((a, b) => a.purchasedAt.getTime() - b.purchasedAt.getTime());
        segmentValue = sorted[0].productName;
        break;
      }
      case "experience_level":
        segmentValue = user.experienceLevel || "unknown";
        break;
      case "funnel_source":
        segmentValue = user.sourceProduct || "unknown";
        break;
      default:
        segmentValue = "unknown";
    }

    if (!segments.has(segmentValue)) {
      segments.set(segmentValue, { users: new Set(), totalRevenue: 0 });
    }

    const segment = segments.get(segmentValue)!;
    segment.users.add(user.id);

    for (const p of userPurchases) {
      segment.totalRevenue += estimatePrice(p.priceDisplay);
    }
  }

  const results: LTVSegment[] = [];
  for (const [value, data] of segments) {
    results.push({
      segmentKey: segmentBy,
      segmentValue: value,
      avgLtv: data.users.size > 0 ? Math.round(data.totalRevenue / data.users.size) : 0,
      memberCount: data.users.size,
      totalRevenue: Math.round(data.totalRevenue),
    });
  }

  results.sort((a, b) => b.avgLtv - a.avgLtv);
  return results;
}
