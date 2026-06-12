import { getParam } from "../lib/params";
import { Router, type IRouter } from "express";
import { db, usersTable, winsTable, winMilestonesTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";

const router: IRouter = Router();


router.get("/admin/wins", requirePermission("wins:view"), async (req, res): Promise<void> => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;
  const statusFilter = req.query.status as string | undefined;
  const testimonialFilter = req.query.testimonial as string | undefined;

  const conditions: any[] = [];

  if (statusFilter === "needs_review") {
    conditions.push(eq(winsTable.status, "published"));
    conditions.push(eq(winsTable.proofVerified, false));
  } else if (statusFilter === "featured") {
    conditions.push(eq(winsTable.status, "featured"));
  } else if (statusFilter === "hidden") {
    conditions.push(eq(winsTable.status, "hidden"));
  } else if (statusFilter) {
    conditions.push(eq(winsTable.status, statusFilter));
  }

  if (testimonialFilter === "requested") {
    conditions.push(eq(winsTable.testimonialRequested, true));
    conditions.push(eq(winsTable.testimonialApproved, false));
  } else if (testimonialFilter === "pending_approval") {
    conditions.push(eq(winsTable.testimonialRequested, true));
    conditions.push(eq(winsTable.testimonialApproved, false));
    conditions.push(sql`${winsTable.testimonialText} IS NOT NULL`);
  } else if (testimonialFilter === "approved") {
    conditions.push(eq(winsTable.testimonialApproved, true));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const totalResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(winsTable)
    .where(whereClause);
  const total = totalResult[0]?.count ?? 0;

  const wins = await db
    .select({
      id: winsTable.id,
      userId: winsTable.userId,
      userName: usersTable.name,
      userEmail: usersTable.email,
      milestoneId: winsTable.milestoneId,
      milestoneName: winMilestonesTable.name,
      milestoneIcon: winMilestonesTable.icon,
      milestoneSlug: winMilestonesTable.slug,
      milestoneCategory: winMilestonesTable.category,
      title: winsTable.title,
      description: winsTable.description,
      revenueAmount: winsTable.revenueAmount,
      metricLabel: winsTable.metricLabel,
      metricValue: winsTable.metricValue,
      proofImageUrl: winsTable.proofImageUrl,
      proofImage2Url: winsTable.proofImage2Url,
      proofVerified: winsTable.proofVerified,
      winDate: winsTable.winDate,
      status: winsTable.status,
      featuredAt: winsTable.featuredAt,
      allowTestimonial: winsTable.allowTestimonial,
      allowPublicName: winsTable.allowPublicName,
      testimonialRequested: winsTable.testimonialRequested,
      testimonialText: winsTable.testimonialText,
      testimonialApproved: winsTable.testimonialApproved,
      testimonialApprovedAt: winsTable.testimonialApprovedAt,
      createdAt: winsTable.createdAt,
      updatedAt: winsTable.updatedAt,
    })
    .from(winsTable)
    .innerJoin(winMilestonesTable, eq(winsTable.milestoneId, winMilestonesTable.id))
    .innerJoin(usersTable, eq(winsTable.userId, usersTable.id))
    .where(whereClause)
    .orderBy(desc(winsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({
    wins,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

router.patch("/admin/wins/:id/feature", requirePermission("wins:manage"), async (req, res): Promise<void> => {
  const adminId = req.userId!;
  const winId = parseInt(getParam(req.params.id));

  const [win] = await db.select().from(winsTable).where(eq(winsTable.id, winId));
  if (!win) {
    res.status(404).json({ error: "Win not found" });
    return;
  }

  const isFeatured = win.status === "featured";

  const [updated] = await db
    .update(winsTable)
    .set({
      status: isFeatured ? "published" : "featured",
      featuredAt: isFeatured ? null : new Date(),
      featuredBy: isFeatured ? null : adminId,
    })
    .where(eq(winsTable.id, winId))
    .returning();

  res.json(updated);
});

router.patch("/admin/wins/:id/verify", requirePermission("wins:manage"), async (req, res): Promise<void> => {
  const winId = parseInt(getParam(req.params.id));

  const [win] = await db.select().from(winsTable).where(eq(winsTable.id, winId));
  if (!win) {
    res.status(404).json({ error: "Win not found" });
    return;
  }

  const [updated] = await db
    .update(winsTable)
    .set({ proofVerified: !win.proofVerified })
    .where(eq(winsTable.id, winId))
    .returning();

  res.json(updated);
});

router.patch("/admin/wins/:id/hide", requirePermission("wins:manage"), async (req, res): Promise<void> => {
  const winId = parseInt(getParam(req.params.id));

  const [win] = await db.select().from(winsTable).where(eq(winsTable.id, winId));
  if (!win) {
    res.status(404).json({ error: "Win not found" });
    return;
  }

  const isHidden = win.status === "hidden";

  const [updated] = await db
    .update(winsTable)
    .set({ status: isHidden ? "published" : "hidden" })
    .where(eq(winsTable.id, winId))
    .returning();

  res.json(updated);
});

router.post("/admin/wins/:id/request-testimonial", requirePermission("wins:manage"), async (req, res): Promise<void> => {
  const winId = parseInt(getParam(req.params.id));

  const [win] = await db
    .select({
      id: winsTable.id,
      userId: winsTable.userId,
      title: winsTable.title,
      testimonialRequested: winsTable.testimonialRequested,
    })
    .from(winsTable)
    .where(eq(winsTable.id, winId));

  if (!win) {
    res.status(404).json({ error: "Win not found" });
    return;
  }

  if (win.testimonialRequested) {
    res.status(400).json({ error: "Testimonial already requested for this win" });
    return;
  }

  const [user] = await db
    .select({ name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, win.userId));

  const [updated] = await db
    .update(winsTable)
    .set({ testimonialRequested: true })
    .where(eq(winsTable.id, winId))
    .returning();

  console.log(`[TESTIMONIAL REQUEST] Win #${winId} - Would send email to ${user?.email} (${user?.name}) requesting testimonial for win: "${win.title}"`);

  res.json(updated);
});

router.patch("/admin/wins/:id/approve-testimonial", requirePermission("wins:manage"), async (req, res): Promise<void> => {
  const adminId = req.userId!;
  const winId = parseInt(getParam(req.params.id));

  const [win] = await db.select().from(winsTable).where(eq(winsTable.id, winId));
  if (!win) {
    res.status(404).json({ error: "Win not found" });
    return;
  }

  if (!win.testimonialText) {
    res.status(400).json({ error: "No testimonial text submitted yet" });
    return;
  }

  const isApproved = win.testimonialApproved;

  const [updated] = await db
    .update(winsTable)
    .set({
      testimonialApproved: !isApproved,
      testimonialApprovedBy: isApproved ? null : adminId,
      testimonialApprovedAt: isApproved ? null : new Date(),
    })
    .where(eq(winsTable.id, winId))
    .returning();

  res.json(updated);
});

export default router;
