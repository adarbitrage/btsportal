import { Router, type IRouter } from "express";
import { db, usersTable, winsTable, winMilestonesTable } from "@workspace/db";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import { getHighestProductLabel, getUserEntitlements } from "../lib/entitlements";

const router: IRouter = Router();

router.get("/v1/marketing/testimonials", async (req, res): Promise<void> => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
  const category = req.query.category as string | undefined;
  const milestone = req.query.milestone as string | undefined;
  const minRevenue = req.query.min_revenue ? parseFloat(req.query.min_revenue as string) : undefined;
  const featuredOnly = req.query.featured_only === "true";
  const random = req.query.random === "true";

  const conditions: any[] = [
    eq(winsTable.testimonialApproved, true),
    eq(winsTable.allowTestimonial, true),
  ];

  if (category) {
    conditions.push(eq(winMilestonesTable.category, category));
  }
  if (milestone) {
    conditions.push(eq(winMilestonesTable.slug, milestone));
  }
  if (minRevenue !== undefined && !isNaN(minRevenue)) {
    conditions.push(gte(sql`CAST(${winsTable.revenueAmount} AS DECIMAL)`, minRevenue));
  }
  if (featuredOnly) {
    conditions.push(eq(winsTable.status, "featured"));
  }

  const orderBy = random
    ? sql`RANDOM()`
    : desc(winsTable.featuredAt);

  const results = await db
    .select({
      id: winsTable.id,
      userId: winsTable.userId,
      userName: usersTable.name,
      allowPublicName: winsTable.allowPublicName,
      milestoneName: winMilestonesTable.name,
      milestoneIcon: winMilestonesTable.icon,
      milestoneCategory: winMilestonesTable.category,
      revenueAmount: winsTable.revenueAmount,
      testimonialText: winsTable.testimonialText,
      winDate: winsTable.winDate,
      proofVerified: winsTable.proofVerified,
      proofImageUrl: winsTable.proofImageUrl,
      createdAt: winsTable.createdAt,
    })
    .from(winsTable)
    .innerJoin(winMilestonesTable, eq(winsTable.milestoneId, winMilestonesTable.id))
    .innerJoin(usersTable, eq(winsTable.userId, usersTable.id))
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(limit);

  const data = await Promise.all(results.map(async (r) => {
    let memberName: string;
    if (r.allowPublicName) {
      memberName = r.userName;
    } else {
      const parts = r.userName.split(" ");
      memberName = parts.length > 1
        ? `${parts[0]} ${parts[parts.length - 1][0]}.`
        : parts[0];
    }

    const entitlements = await getUserEntitlements(r.userId);
    const productLevel = getHighestProductLabel(entitlements);

    return {
      id: r.id,
      memberName,
      memberProductLevel: productLevel.name,
      milestone: r.milestoneName,
      milestoneIcon: r.milestoneIcon,
      milestoneCategory: r.milestoneCategory,
      revenueAmount: r.revenueAmount ? parseFloat(r.revenueAmount) : null,
      testimonialText: r.testimonialText,
      winDate: r.winDate,
      proofVerified: r.proofVerified,
      proofImageUrl: r.proofImageUrl,
      createdAt: r.createdAt,
    };
  }));

  res.json({ data });
});

export default router;
