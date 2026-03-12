import { Router, type Request, type Response } from "express";
import {
  db, affiliateProfilesTable, commissionsTable, commissionRatesTable,
  referralLinksTable, commissionPayoutsTable, affiliateResourcesTable,
  productsTable, usersTable
} from "@workspace/db";
import { eq, and, desc, sql, lte, asc, ne } from "drizzle-orm";

const router = Router();

const PAYOUT_THRESHOLD = parseInt(process.env.PAYOUT_THRESHOLD_CENTS || "5000", 10);
const APPROVAL_WINDOW_DAYS = parseInt(process.env.COMMISSION_APPROVAL_DAYS || "30", 10);

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

router.post("/admin/commissions/run-approval", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const cutoff = new Date(Date.now() - APPROVAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const approved = await db.update(commissionsTable)
    .set({ status: "approved", approvedAt: new Date() })
    .where(and(
      eq(commissionsTable.status, "pending"),
      lte(commissionsTable.createdAt, cutoff)
    ))
    .returning();

  for (const commission of approved) {
    await db.update(affiliateProfilesTable)
      .set({
        pendingBalance: sql`pending_balance - ${commission.commissionAmount}`,
        approvedBalance: sql`approved_balance + ${commission.commissionAmount}`,
      })
      .where(eq(affiliateProfilesTable.id, commission.affiliateId));
  }

  res.json({ approved: approved.length, cutoffDate: cutoff.toISOString() });
});

router.post("/admin/commissions/generate-payouts", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const affiliatesWithApproved = await db
    .select({
      affiliateId: commissionsTable.affiliateId,
      total: sql<number>`sum(${commissionsTable.commissionAmount})::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(commissionsTable)
    .where(eq(commissionsTable.status, "approved"))
    .groupBy(commissionsTable.affiliateId);

  const payouts: { affiliateId: number; amount: number; commissionCount: number }[] = [];

  for (const aff of affiliatesWithApproved) {
    if (aff.total >= PAYOUT_THRESHOLD) {
      const [profile] = await db
        .select({ paypalEmail: affiliateProfilesTable.paypalEmail })
        .from(affiliateProfilesTable)
        .where(eq(affiliateProfilesTable.id, aff.affiliateId))
        .limit(1);

      const [payout] = await db.insert(commissionPayoutsTable).values({
        affiliateId: aff.affiliateId,
        amount: aff.total,
        commissionCount: aff.count,
        status: "pending",
        paypalEmail: profile?.paypalEmail || null,
      }).returning();

      await db.update(commissionsTable)
        .set({ status: "in_payout", payoutId: payout.id })
        .where(and(
          eq(commissionsTable.affiliateId, aff.affiliateId),
          eq(commissionsTable.status, "approved")
        ));

      await db.update(affiliateProfilesTable)
        .set({ approvedBalance: sql`approved_balance - ${aff.total}` })
        .where(eq(affiliateProfilesTable.id, aff.affiliateId));

      payouts.push({ affiliateId: aff.affiliateId, amount: aff.total, commissionCount: aff.count });
    }
  }

  res.json({ payoutsGenerated: payouts.length, payouts, threshold: PAYOUT_THRESHOLD });
});

router.get("/admin/commissions", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset = (page - 1) * limit;
  const status = req.query.status as string;

  const conditions = [];
  if (status) conditions.push(eq(commissionsTable.status, status));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(commissionsTable)
    .where(whereClause);

  const commissions = await db
    .select({
      id: commissionsTable.id,
      orderId: commissionsTable.orderId,
      customerEmail: commissionsTable.customerEmail,
      saleAmount: commissionsTable.saleAmount,
      commissionRate: commissionsTable.commissionRate,
      commissionAmount: commissionsTable.commissionAmount,
      status: commissionsTable.status,
      tier: commissionsTable.tier,
      fraudFlag: commissionsTable.fraudFlag,
      affiliateName: usersTable.name,
      affiliateEmail: usersTable.email,
      productName: productsTable.name,
      createdAt: commissionsTable.createdAt,
      approvedAt: commissionsTable.approvedAt,
      paidAt: commissionsTable.paidAt,
    })
    .from(commissionsTable)
    .leftJoin(affiliateProfilesTable, eq(commissionsTable.affiliateId, affiliateProfilesTable.id))
    .leftJoin(usersTable, eq(affiliateProfilesTable.userId, usersTable.id))
    .leftJoin(productsTable, eq(commissionsTable.productId, productsTable.id))
    .where(whereClause)
    .orderBy(desc(commissionsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({
    commissions,
    pagination: { page, limit, total: countResult.count, totalPages: Math.ceil(countResult.count / limit) },
  });
});

router.post("/admin/commissions/:id/approve", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const id = parseInt(req.params.id);
  const [commission] = await db.update(commissionsTable)
    .set({ status: "approved", approvedAt: new Date() })
    .where(and(eq(commissionsTable.id, id), eq(commissionsTable.status, "pending")))
    .returning();

  if (!commission) {
    res.status(404).json({ error: "Commission not found or not pending" });
    return;
  }

  await db.update(affiliateProfilesTable)
    .set({
      pendingBalance: sql`pending_balance - ${commission.commissionAmount}`,
      approvedBalance: sql`approved_balance + ${commission.commissionAmount}`,
    })
    .where(eq(affiliateProfilesTable.id, commission.affiliateId));

  res.json({ commission });
});

router.post("/admin/commissions/:id/reject", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const id = parseInt(req.params.id);
  const { reason } = req.body;

  const [commission] = await db.update(commissionsTable)
    .set({ status: "rejected", reversalReason: reason || "Rejected by admin", reversedAt: new Date() })
    .where(and(eq(commissionsTable.id, id), eq(commissionsTable.status, "pending")))
    .returning();

  if (!commission) {
    res.status(404).json({ error: "Commission not found or not pending" });
    return;
  }

  await db.update(affiliateProfilesTable)
    .set({ pendingBalance: sql`pending_balance - ${commission.commissionAmount}` })
    .where(eq(affiliateProfilesTable.id, commission.affiliateId));

  res.json({ commission });
});

router.post("/admin/commissions/:id/reverse", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const id = parseInt(req.params.id);
  const { reason } = req.body;

  const [commission] = await db
    .select()
    .from(commissionsTable)
    .where(eq(commissionsTable.id, id))
    .limit(1);

  if (!commission) {
    res.status(404).json({ error: "Commission not found" });
    return;
  }

  if (commission.status !== "pending" && commission.status !== "approved") {
    res.status(400).json({ error: `Cannot reverse commission with status '${commission.status}'. Only pending or approved commissions can be reversed.` });
    return;
  }

  const balanceCol = commission.status === "pending" ? "pending_balance" : "approved_balance";
  const balanceField = commission.status === "pending" ? "pendingBalance" : "approvedBalance";

  const [updated] = await db.update(commissionsTable)
    .set({ status: "reversed", reversalReason: reason || "Reversed by admin", reversedAt: new Date() })
    .where(eq(commissionsTable.id, id))
    .returning();

  await db.update(affiliateProfilesTable)
    .set({ [balanceField]: sql`${sql.identifier(balanceCol)} - ${commission.commissionAmount}` })
    .where(eq(affiliateProfilesTable.id, commission.affiliateId));

  res.json({ commission: updated });
});

router.get("/admin/commissions/payouts", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const payouts = await db
    .select({
      id: commissionPayoutsTable.id,
      affiliateId: commissionPayoutsTable.affiliateId,
      affiliateName: usersTable.name,
      affiliateEmail: usersTable.email,
      amount: commissionPayoutsTable.amount,
      commissionCount: commissionPayoutsTable.commissionCount,
      status: commissionPayoutsTable.status,
      paypalEmail: commissionPayoutsTable.paypalEmail,
      paypalTransactionId: commissionPayoutsTable.paypalTransactionId,
      notes: commissionPayoutsTable.notes,
      generatedAt: commissionPayoutsTable.generatedAt,
      paidAt: commissionPayoutsTable.paidAt,
    })
    .from(commissionPayoutsTable)
    .leftJoin(affiliateProfilesTable, eq(commissionPayoutsTable.affiliateId, affiliateProfilesTable.id))
    .leftJoin(usersTable, eq(affiliateProfilesTable.userId, usersTable.id))
    .orderBy(desc(commissionPayoutsTable.generatedAt));

  res.json({ payouts });
});

router.post("/admin/commissions/payouts/:id/mark-paid", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const id = parseInt(req.params.id);
  const { paypalTransactionId, notes } = req.body;

  const [payout] = await db.update(commissionPayoutsTable)
    .set({
      status: "paid",
      paidAt: new Date(),
      paypalTransactionId: paypalTransactionId || null,
      notes: notes || null,
    })
    .where(and(eq(commissionPayoutsTable.id, id), eq(commissionPayoutsTable.status, "pending")))
    .returning();

  if (!payout) {
    res.status(404).json({ error: "Payout not found or not pending" });
    return;
  }

  await db.update(commissionsTable)
    .set({ status: "paid", paidAt: new Date() })
    .where(eq(commissionsTable.payoutId, payout.id));

  await db.update(affiliateProfilesTable)
    .set({
      totalPaid: sql`total_paid + ${payout.amount}`,
    })
    .where(eq(affiliateProfilesTable.id, payout.affiliateId));

  res.json({ payout });
});

router.get("/admin/affiliates", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const affiliates = await db
    .select({
      id: affiliateProfilesTable.id,
      userId: affiliateProfilesTable.userId,
      name: usersTable.name,
      email: usersTable.email,
      affiliateCode: affiliateProfilesTable.affiliateCode,
      tier: affiliateProfilesTable.tier,
      status: affiliateProfilesTable.status,
      totalEarnings: affiliateProfilesTable.totalEarnings,
      totalPaid: affiliateProfilesTable.totalPaid,
      pendingBalance: affiliateProfilesTable.pendingBalance,
      approvedBalance: affiliateProfilesTable.approvedBalance,
      lifetimeClicks: affiliateProfilesTable.lifetimeClicks,
      lifetimeConversions: affiliateProfilesTable.lifetimeConversions,
      fraudFlag: affiliateProfilesTable.fraudFlag,
      fraudReason: affiliateProfilesTable.fraudReason,
      paypalEmail: affiliateProfilesTable.paypalEmail,
      taxFormSubmitted: affiliateProfilesTable.taxFormSubmitted,
      createdAt: affiliateProfilesTable.createdAt,
    })
    .from(affiliateProfilesTable)
    .innerJoin(usersTable, eq(affiliateProfilesTable.userId, usersTable.id))
    .orderBy(desc(affiliateProfilesTable.totalEarnings));

  res.json({ affiliates });
});

router.patch("/admin/affiliates/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const id = parseInt(req.params.id);
  const { status, tier, fraudFlag, fraudReason } = req.body;
  const updates: Record<string, unknown> = {};

  if (status !== undefined) updates.status = status;
  if (tier !== undefined) updates.tier = tier;
  if (fraudFlag !== undefined) updates.fraudFlag = fraudFlag;
  if (fraudReason !== undefined) updates.fraudReason = fraudReason;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [updated] = await db.update(affiliateProfilesTable)
    .set(updates)
    .where(eq(affiliateProfilesTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Affiliate not found" });
    return;
  }

  res.json({ affiliate: updated });
});

router.get("/admin/commissions/rates", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const rates = await db
    .select({
      id: commissionRatesTable.id,
      tier: commissionRatesTable.tier,
      productId: commissionRatesTable.productId,
      productName: productsTable.name,
      productSlug: productsTable.slug,
      ratePercent: commissionRatesTable.ratePercent,
      flatBonus: commissionRatesTable.flatBonus,
      createdAt: commissionRatesTable.createdAt,
    })
    .from(commissionRatesTable)
    .leftJoin(productsTable, eq(commissionRatesTable.productId, productsTable.id))
    .orderBy(asc(commissionRatesTable.tier), asc(productsTable.sortOrder));

  res.json({ rates });
});

router.post("/admin/commissions/rates", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const { tier, productId, ratePercent, flatBonus } = req.body;
  if (!tier || !productId || ratePercent === undefined) {
    res.status(400).json({ error: "tier, productId, and ratePercent are required" });
    return;
  }

  const [rate] = await db.insert(commissionRatesTable).values({
    tier,
    productId: parseInt(productId),
    ratePercent: ratePercent.toString(),
    flatBonus: parseInt(flatBonus) || 0,
  }).returning();

  res.json({ rate });
});

router.put("/admin/commissions/rates/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const id = parseInt(req.params.id);
  const { ratePercent, flatBonus } = req.body;
  const updates: Record<string, unknown> = {};

  if (ratePercent !== undefined) updates.ratePercent = ratePercent.toString();
  if (flatBonus !== undefined) updates.flatBonus = parseInt(flatBonus) || 0;

  const [updated] = await db.update(commissionRatesTable)
    .set(updates)
    .where(eq(commissionRatesTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Rate not found" });
    return;
  }

  res.json({ rate: updated });
});

router.delete("/admin/commissions/rates/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const id = parseInt(req.params.id);
  const [deleted] = await db.delete(commissionRatesTable)
    .where(eq(commissionRatesTable.id, id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Rate not found" });
    return;
  }

  res.json({ deleted: true });
});

router.get("/admin/commissions/resources", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const resources = await db
    .select()
    .from(affiliateResourcesTable)
    .orderBy(asc(affiliateResourcesTable.type), asc(affiliateResourcesTable.sortOrder));

  res.json({ resources });
});

router.post("/admin/commissions/resources", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const { type, title, description, content, fileUrl, thumbnailUrl, productSlug, sortOrder } = req.body;
  if (!type || !title) {
    res.status(400).json({ error: "type and title are required" });
    return;
  }

  const [resource] = await db.insert(affiliateResourcesTable).values({
    type, title, description, content, fileUrl, thumbnailUrl, productSlug,
    sortOrder: parseInt(sortOrder) || 0,
  }).returning();

  res.json({ resource });
});

router.put("/admin/commissions/resources/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const id = parseInt(req.params.id);
  const { type, title, description, content, fileUrl, thumbnailUrl, productSlug, sortOrder, status } = req.body;
  const updates: Record<string, unknown> = {};

  if (type !== undefined) updates.type = type;
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (content !== undefined) updates.content = content;
  if (fileUrl !== undefined) updates.fileUrl = fileUrl;
  if (thumbnailUrl !== undefined) updates.thumbnailUrl = thumbnailUrl;
  if (productSlug !== undefined) updates.productSlug = productSlug;
  if (sortOrder !== undefined) updates.sortOrder = parseInt(sortOrder) || 0;
  if (status !== undefined) updates.status = status;

  const [updated] = await db.update(affiliateResourcesTable)
    .set(updates)
    .where(eq(affiliateResourcesTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Resource not found" });
    return;
  }

  res.json({ resource: updated });
});

router.delete("/admin/commissions/resources/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const id = parseInt(req.params.id);
  const [deleted] = await db.delete(affiliateResourcesTable)
    .where(eq(affiliateResourcesTable.id, id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Resource not found" });
    return;
  }

  res.json({ deleted: true });
});

router.get("/admin/commissions/fraud-alerts", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const flaggedCommissions = await db
    .select({
      id: commissionsTable.id,
      orderId: commissionsTable.orderId,
      customerEmail: commissionsTable.customerEmail,
      commissionAmount: commissionsTable.commissionAmount,
      fraudFlag: commissionsTable.fraudFlag,
      status: commissionsTable.status,
      affiliateName: usersTable.name,
      affiliateEmail: usersTable.email,
      productName: productsTable.name,
      createdAt: commissionsTable.createdAt,
    })
    .from(commissionsTable)
    .leftJoin(affiliateProfilesTable, eq(commissionsTable.affiliateId, affiliateProfilesTable.id))
    .leftJoin(usersTable, eq(affiliateProfilesTable.userId, usersTable.id))
    .leftJoin(productsTable, eq(commissionsTable.productId, productsTable.id))
    .where(sql`${commissionsTable.fraudFlag} IS NOT NULL`)
    .orderBy(desc(commissionsTable.createdAt));

  const flaggedAffiliates = await db
    .select({
      id: affiliateProfilesTable.id,
      name: usersTable.name,
      email: usersTable.email,
      affiliateCode: affiliateProfilesTable.affiliateCode,
      fraudFlag: affiliateProfilesTable.fraudFlag,
      fraudReason: affiliateProfilesTable.fraudReason,
      lifetimeClicks: affiliateProfilesTable.lifetimeClicks,
      lifetimeConversions: affiliateProfilesTable.lifetimeConversions,
    })
    .from(affiliateProfilesTable)
    .innerJoin(usersTable, eq(affiliateProfilesTable.userId, usersTable.id))
    .where(eq(affiliateProfilesTable.fraudFlag, true));

  const HIGH_CLICK_THRESHOLD = 100;
  const LOW_CONVERSION_RATE = 0.5;

  const highClickLowConversion = await db
    .select({
      id: affiliateProfilesTable.id,
      name: usersTable.name,
      email: usersTable.email,
      affiliateCode: affiliateProfilesTable.affiliateCode,
      lifetimeClicks: affiliateProfilesTable.lifetimeClicks,
      lifetimeConversions: affiliateProfilesTable.lifetimeConversions,
      tier: affiliateProfilesTable.tier,
    })
    .from(affiliateProfilesTable)
    .innerJoin(usersTable, eq(affiliateProfilesTable.userId, usersTable.id))
    .where(and(
      sql`${affiliateProfilesTable.lifetimeClicks} >= ${HIGH_CLICK_THRESHOLD}`,
      sql`(${affiliateProfilesTable.lifetimeConversions}::float / NULLIF(${affiliateProfilesTable.lifetimeClicks}, 0) * 100) < ${LOW_CONVERSION_RATE}`
    ));

  res.json({
    flaggedCommissions,
    flaggedAffiliates,
    highClickLowConversion: highClickLowConversion.map(a => ({
      ...a,
      conversionRate: a.lifetimeClicks > 0
        ? ((a.lifetimeConversions / a.lifetimeClicks) * 100).toFixed(2)
        : "0.00",
      reason: "high_clicks_low_conversions",
    })),
  });
});

export default router;
