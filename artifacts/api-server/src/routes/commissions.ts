import { Router, type Request, type Response } from "express";
import {
  db, affiliateProfilesTable, commissionsTable, commissionRatesTable,
  referralLinksTable, referralClicksTable, commissionPayoutsTable, affiliateResourcesTable,
  productsTable, usersTable
} from "@workspace/db";
import { eq, and, desc, sql, gte, lte, asc } from "drizzle-orm";
import { getUserEntitlements, hasMemberAccessBypass } from "../lib/entitlements";
import { hasCommissionEntitlement, ensureAffiliateProfile, resolveCommissionTier } from "../lib/commissions";

const router = Router();

async function requireCommissionAccess(req: Request, res: Response): Promise<{ affiliateId: number; userId: number } | null> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }

  const entitlements = await getUserEntitlements(userId);
  if (!hasCommissionEntitlement(entitlements) && !(await hasMemberAccessBypass(userId))) {
    res.status(403).json({ error: "Commission access required" });
    return null;
  }

  const profile = await ensureAffiliateProfile(userId);
  if (!profile) {
    res.status(403).json({ error: "Affiliate profile not available" });
    return null;
  }

  return { affiliateId: profile.id, userId };
}

router.get("/commissions/dashboard", async (req: Request, res: Response) => {
  const access = await requireCommissionAccess(req, res);
  if (!access) return;

  const [profile] = await db
    .select()
    .from(affiliateProfilesTable)
    .where(eq(affiliateProfilesTable.id, access.affiliateId))
    .limit(1);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const recentCommissions = await db
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${commissionsTable.commissionAmount}), 0)::int`,
    })
    .from(commissionsTable)
    .where(and(
      eq(commissionsTable.affiliateId, access.affiliateId),
      eq(commissionsTable.status, "pending"),
      gte(commissionsTable.createdAt, thirtyDaysAgo)
    ));

  const allTimeStats = await db
    .select({
      totalCommissions: sql<number>`count(*)::int`,
      totalEarnings: sql<number>`coalesce(sum(case when ${commissionsTable.status} in ('pending', 'approved', 'paid') then ${commissionsTable.commissionAmount} else 0 end), 0)::int`,
      pendingAmount: sql<number>`coalesce(sum(case when ${commissionsTable.status} = 'pending' then ${commissionsTable.commissionAmount} else 0 end), 0)::int`,
      approvedAmount: sql<number>`coalesce(sum(case when ${commissionsTable.status} = 'approved' then ${commissionsTable.commissionAmount} else 0 end), 0)::int`,
      paidAmount: sql<number>`coalesce(sum(case when ${commissionsTable.status} = 'paid' then ${commissionsTable.commissionAmount} else 0 end), 0)::int`,
    })
    .from(commissionsTable)
    .where(eq(commissionsTable.affiliateId, access.affiliateId));

  const linkCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(referralLinksTable)
    .where(eq(referralLinksTable.affiliateId, access.affiliateId));

  const conversionRate = profile.lifetimeClicks > 0
    ? ((profile.lifetimeConversions / profile.lifetimeClicks) * 100).toFixed(1)
    : "0.0";

  res.json({
    affiliateCode: profile.affiliateCode,
    tier: profile.tier,
    status: profile.status,
    lifetimeClicks: profile.lifetimeClicks,
    lifetimeConversions: profile.lifetimeConversions,
    conversionRate,
    totalEarnings: allTimeStats[0]?.totalEarnings ?? 0,
    pendingBalance: allTimeStats[0]?.pendingAmount ?? 0,
    approvedBalance: allTimeStats[0]?.approvedAmount ?? 0,
    paidBalance: allTimeStats[0]?.paidAmount ?? 0,
    recentCommissions: recentCommissions[0]?.count ?? 0,
    recentEarnings: recentCommissions[0]?.total ?? 0,
    activeLinks: linkCount[0]?.count ?? 0,
    paypalEmail: profile.paypalEmail,
    taxFormSubmitted: profile.taxFormSubmitted,
  });
});

router.get("/commissions/summary", async (req: Request, res: Response) => {
  const access = await requireCommissionAccess(req, res);
  if (!access) return;

  const [profile] = await db
    .select()
    .from(affiliateProfilesTable)
    .where(eq(affiliateProfilesTable.id, access.affiliateId))
    .limit(1);

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const monthStats = await db
    .select({
      earnings: sql<number>`coalesce(sum(${commissionsTable.commissionAmount}), 0)::int`,
    })
    .from(commissionsTable)
    .where(and(
      eq(commissionsTable.affiliateId, access.affiliateId),
      gte(commissionsTable.createdAt, startOfMonth)
    ));

  const allTimeStats = await db
    .select({
      totalEarnings: sql<number>`coalesce(sum(case when ${commissionsTable.status} in ('pending', 'approved', 'paid') then ${commissionsTable.commissionAmount} else 0 end), 0)::int`,
      pendingAmount: sql<number>`coalesce(sum(case when ${commissionsTable.status} = 'pending' then ${commissionsTable.commissionAmount} else 0 end), 0)::int`,
      approvedAmount: sql<number>`coalesce(sum(case when ${commissionsTable.status} = 'approved' then ${commissionsTable.commissionAmount} else 0 end), 0)::int`,
    })
    .from(commissionsTable)
    .where(eq(commissionsTable.affiliateId, access.affiliateId));

  res.json({
    tierLabel: profile.tier,
    tierSlug: profile.tier,
    earningsThisMonth: monthStats[0]?.earnings ?? 0,
    earningsThisMonthChange: 0,
    pendingAmount: allTimeStats[0]?.pendingAmount ?? 0,
    availableForPayout: allTimeStats[0]?.approvedAmount ?? 0,
    totalEarnedAllTime: allTimeStats[0]?.totalEarnings ?? 0,
    totalReferrals: profile.lifetimeConversions,
    totalClicksThisMonth: profile.lifetimeClicks,
  });
});

router.get("/commissions/earnings", async (req: Request, res: Response) => {
  const access = await requireCommissionAccess(req, res);
  if (!access) return;

  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset = (page - 1) * limit;
  const status = req.query.status as string;
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;

  const conditions = [eq(commissionsTable.affiliateId, access.affiliateId)];
  if (status) conditions.push(eq(commissionsTable.status, status));
  if (startDate) conditions.push(gte(commissionsTable.createdAt, new Date(startDate)));
  if (endDate) conditions.push(lte(commissionsTable.createdAt, new Date(endDate)));

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(commissionsTable)
    .where(and(...conditions));

  const earnings = await db
    .select({
      id: commissionsTable.id,
      orderId: commissionsTable.orderId,
      customerEmail: commissionsTable.customerEmail,
      saleAmount: commissionsTable.saleAmount,
      commissionRate: commissionsTable.commissionRate,
      commissionAmount: commissionsTable.commissionAmount,
      flatBonus: commissionsTable.flatBonus,
      status: commissionsTable.status,
      tier: commissionsTable.tier,
      productName: productsTable.name,
      productSlug: productsTable.slug,
      createdAt: commissionsTable.createdAt,
      approvedAt: commissionsTable.approvedAt,
      paidAt: commissionsTable.paidAt,
    })
    .from(commissionsTable)
    .leftJoin(productsTable, eq(commissionsTable.productId, productsTable.id))
    .where(and(...conditions))
    .orderBy(desc(commissionsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({
    earnings,
    pagination: {
      page,
      limit,
      total: countResult.count,
      totalPages: Math.ceil(countResult.count / limit),
    },
  });
});

router.get("/commissions/referral-links", async (req: Request, res: Response) => {
  const access = await requireCommissionAccess(req, res);
  if (!access) return;

  const links = await db
    .select({
      id: referralLinksTable.id,
      productId: referralLinksTable.productId,
      productName: productsTable.name,
      productSlug: productsTable.slug,
      slug: referralLinksTable.slug,
      clickCount: referralLinksTable.clickCount,
      conversionCount: referralLinksTable.conversionCount,
      status: referralLinksTable.status,
      createdAt: referralLinksTable.createdAt,
    })
    .from(referralLinksTable)
    .leftJoin(productsTable, eq(referralLinksTable.productId, productsTable.id))
    .where(eq(referralLinksTable.affiliateId, access.affiliateId))
    .orderBy(desc(referralLinksTable.clickCount));

  const [profile] = await db
    .select({ affiliateCode: affiliateProfilesTable.affiliateCode })
    .from(affiliateProfilesTable)
    .where(eq(affiliateProfilesTable.id, access.affiliateId))
    .limit(1);

  res.json({
    links: links.map(l => ({
      ...l,
      referralUrl: `/go/${l.productSlug || l.slug}?ref=${profile?.affiliateCode}`,
      conversionRate: l.clickCount > 0 ? ((l.conversionCount / l.clickCount) * 100).toFixed(1) : "0.0",
    })),
    affiliateCode: profile?.affiliateCode,
  });
});

router.get("/commissions/payouts", async (req: Request, res: Response) => {
  const access = await requireCommissionAccess(req, res);
  if (!access) return;

  const payouts = await db
    .select()
    .from(commissionPayoutsTable)
    .where(eq(commissionPayoutsTable.affiliateId, access.affiliateId))
    .orderBy(desc(commissionPayoutsTable.generatedAt));

  res.json({ payouts });
});

router.get("/commissions/leaderboard", async (req: Request, res: Response) => {
  const access = await requireCommissionAccess(req, res);
  if (!access) return;

  const leaderboard = await db
    .select({
      affiliateId: affiliateProfilesTable.id,
      name: usersTable.name,
      tier: affiliateProfilesTable.tier,
      totalEarnings: affiliateProfilesTable.totalEarnings,
      lifetimeConversions: affiliateProfilesTable.lifetimeConversions,
    })
    .from(affiliateProfilesTable)
    .innerJoin(usersTable, eq(affiliateProfilesTable.userId, usersTable.id))
    .where(eq(affiliateProfilesTable.status, "active"))
    .orderBy(desc(affiliateProfilesTable.totalEarnings))
    .limit(20);

  const myRank = leaderboard.findIndex(l => l.affiliateId === access.affiliateId) + 1;

  res.json({
    leaderboard: leaderboard.map((l, i) => ({
      rank: i + 1,
      name: l.name,
      tier: l.tier,
      totalEarnings: l.totalEarnings,
      conversions: l.lifetimeConversions,
      isCurrentUser: l.affiliateId === access.affiliateId,
    })),
    myRank: myRank > 0 ? myRank : null,
  });
});

router.get("/commissions/rates", async (req: Request, res: Response) => {
  const access = await requireCommissionAccess(req, res);
  if (!access) return;

  const rates = await db
    .select({
      id: commissionRatesTable.id,
      tier: commissionRatesTable.tier,
      productId: commissionRatesTable.productId,
      productName: productsTable.name,
      productSlug: productsTable.slug,
      ratePercent: commissionRatesTable.ratePercent,
      flatBonus: commissionRatesTable.flatBonus,
    })
    .from(commissionRatesTable)
    .leftJoin(productsTable, eq(commissionRatesTable.productId, productsTable.id))
    .orderBy(asc(commissionRatesTable.tier), asc(productsTable.sortOrder));

  res.json({ rates });
});

router.get("/commissions/resources", async (req: Request, res: Response) => {
  const access = await requireCommissionAccess(req, res);
  if (!access) return;

  const resources = await db
    .select()
    .from(affiliateResourcesTable)
    .where(eq(affiliateResourcesTable.status, "active"))
    .orderBy(asc(affiliateResourcesTable.type), asc(affiliateResourcesTable.sortOrder));

  res.json({ resources });
});

router.get("/commissions/profile", async (req: Request, res: Response) => {
  const access = await requireCommissionAccess(req, res);
  if (!access) return;

  const [profile] = await db
    .select({
      id: affiliateProfilesTable.id,
      affiliateCode: affiliateProfilesTable.affiliateCode,
      tier: affiliateProfilesTable.tier,
      status: affiliateProfilesTable.status,
      paypalEmail: affiliateProfilesTable.paypalEmail,
      taxFormSubmitted: affiliateProfilesTable.taxFormSubmitted,
      taxFormUrl: affiliateProfilesTable.taxFormUrl,
      totalEarnings: affiliateProfilesTable.totalEarnings,
      totalPaid: affiliateProfilesTable.totalPaid,
      pendingBalance: affiliateProfilesTable.pendingBalance,
      approvedBalance: affiliateProfilesTable.approvedBalance,
      lifetimeClicks: affiliateProfilesTable.lifetimeClicks,
      lifetimeConversions: affiliateProfilesTable.lifetimeConversions,
      createdAt: affiliateProfilesTable.createdAt,
    })
    .from(affiliateProfilesTable)
    .where(eq(affiliateProfilesTable.id, access.affiliateId))
    .limit(1);

  res.json({ profile });
});

router.patch("/commissions/profile", async (req: Request, res: Response) => {
  const access = await requireCommissionAccess(req, res);
  if (!access) return;

  const { paypalEmail } = req.body;
  const updates: Record<string, unknown> = {};

  if (paypalEmail !== undefined) {
    updates.paypalEmail = paypalEmail;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [updated] = await db.update(affiliateProfilesTable)
    .set(updates)
    .where(eq(affiliateProfilesTable.id, access.affiliateId))
    .returning();

  res.json({ profile: updated });
});

router.post("/commissions/profile/tax-form", async (req: Request, res: Response) => {
  const access = await requireCommissionAccess(req, res);
  if (!access) return;

  const { taxFormUrl } = req.body;
  if (!taxFormUrl) {
    res.status(400).json({ error: "Tax form URL required" });
    return;
  }

  const [updated] = await db.update(affiliateProfilesTable)
    .set({ taxFormSubmitted: true, taxFormUrl })
    .where(eq(affiliateProfilesTable.id, access.affiliateId))
    .returning();

  res.json({ profile: updated });
});

router.get("/commissions/chart", async (req: Request, res: Response) => {
  const access = await requireCommissionAccess(req, res);
  if (!access) return;

  const days = parseInt(req.query.days as string) || 30;
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const chartData = await db
    .select({
      date: sql<string>`to_char(${commissionsTable.createdAt}, 'YYYY-MM-DD')`,
      earnings: sql<number>`coalesce(sum(${commissionsTable.commissionAmount}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(commissionsTable)
    .where(and(
      eq(commissionsTable.affiliateId, access.affiliateId),
      gte(commissionsTable.createdAt, startDate)
    ))
    .groupBy(sql`to_char(${commissionsTable.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${commissionsTable.createdAt}, 'YYYY-MM-DD')`);

  res.json({ chartData, days });
});

export default router;
