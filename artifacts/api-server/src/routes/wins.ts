import { Router, type IRouter } from "express";
import {
  db, usersTable, winsTable, winMilestonesTable,
  communityCategoriesTable, communityPostsTable, communityBadgesTable,
} from "@workspace/db";
import { eq, and, desc, asc, sql, ne, inArray } from "drizzle-orm";
import { hasEntitlement, getHighestProductLabel, getUserEntitlements } from "../lib/entitlements";

const router: IRouter = Router();

router.get("/wins/milestones", async (req, res): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const milestones = await db
    .select()
    .from(winMilestonesTable)
    .where(eq(winMilestonesTable.isActive, true))
    .orderBy(asc(winMilestonesTable.sortOrder));

  res.json(milestones);
});

router.post("/wins", async (req, res): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const userId = req.userId;

  const {
    milestoneId, title, description, revenueAmount, metricLabel, metricValue,
    proofImageUrl, proofImage2Url, winDate, shareToCommunity, allowTestimonial,
    allowPublicName, status,
  } = req.body;

  if (!milestoneId || typeof milestoneId !== "number") {
    res.status(400).json({ error: "milestoneId is required" });
    return;
  }
  if (!title || typeof title !== "string" || title.length < 3 || title.length > 200) {
    res.status(400).json({ error: "Title must be between 3 and 200 characters" });
    return;
  }
  if (!description || typeof description !== "string" || description.length < 10 || description.length > 2000) {
    res.status(400).json({ error: "Description must be between 10 and 2000 characters" });
    return;
  }
  if (!winDate || typeof winDate !== "string") {
    res.status(400).json({ error: "winDate is required (YYYY-MM-DD)" });
    return;
  }

  const [milestone] = await db
    .select()
    .from(winMilestonesTable)
    .where(and(eq(winMilestonesTable.id, milestoneId), eq(winMilestonesTable.isActive, true)));
  if (!milestone) {
    res.status(400).json({ error: "Invalid milestone" });
    return;
  }

  const winStatus = status === "draft" ? "draft" : "published";

  const [win] = await db
    .insert(winsTable)
    .values({
      userId,
      milestoneId,
      title,
      description,
      revenueAmount: revenueAmount != null ? String(revenueAmount) : null,
      metricLabel: metricLabel || null,
      metricValue: metricValue || null,
      proofImageUrl: proofImageUrl || null,
      proofImage2Url: proofImage2Url || null,
      winDate,
      shareToCommunity: shareToCommunity !== false,
      allowTestimonial: allowTestimonial === true,
      allowPublicName: allowPublicName === true,
      status: winStatus,
    })
    .returning();

  if (winStatus === "published" && shareToCommunity !== false) {
    try {
      const [winsCategory] = await db
        .select()
        .from(communityCategoriesTable)
        .where(eq(communityCategoriesTable.slug, "wins"));

      if (winsCategory) {
        const postContent = `🏆 **${milestone.icon || "🏅"} ${milestone.name}**\n\n**${title}**\n\n${description}${revenueAmount ? `\n\nRevenue: $${Number(revenueAmount).toLocaleString()}` : ""}`;

        const [communityPost] = await db
          .insert(communityPostsTable)
          .values({
            authorId: userId,
            categoryId: winsCategory.id,
            content: postContent,
            imageUrl: proofImageUrl || null,
          })
          .returning();

        await db
          .update(winsTable)
          .set({ communityPostId: communityPost.id })
          .where(eq(winsTable.id, win.id));

        await db
          .update(communityCategoriesTable)
          .set({ postsCount: sql`${communityCategoriesTable.postsCount} + 1` })
          .where(eq(communityCategoriesTable.id, winsCategory.id));

        win.communityPostId = communityPost.id;
      }
    } catch (err) {
      console.error("Failed to create community post for win:", err);
    }
  }

  if (winStatus === "published") {
    try {
      await db
        .insert(communityBadgesTable)
        .values({ userId, badgeType: `milestone:${milestone.slug}` })
        .onConflictDoNothing();
    } catch (err) {
      console.error("Failed to award milestone badge:", err);
    }
  }

  res.status(201).json(win);
});

router.get("/wins", async (req, res): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const userId = req.userId;

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;

  const totalResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(winsTable)
    .where(eq(winsTable.userId, userId));
  const total = totalResult[0]?.count ?? 0;

  const wins = await db
    .select({
      id: winsTable.id,
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
      shareToCommunity: winsTable.shareToCommunity,
      communityPostId: winsTable.communityPostId,
      allowTestimonial: winsTable.allowTestimonial,
      allowPublicName: winsTable.allowPublicName,
      status: winsTable.status,
      featuredAt: winsTable.featuredAt,
      testimonialRequested: winsTable.testimonialRequested,
      testimonialText: winsTable.testimonialText,
      testimonialApproved: winsTable.testimonialApproved,
      createdAt: winsTable.createdAt,
      updatedAt: winsTable.updatedAt,
    })
    .from(winsTable)
    .innerJoin(winMilestonesTable, eq(winsTable.milestoneId, winMilestonesTable.id))
    .where(eq(winsTable.userId, userId))
    .orderBy(desc(winsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({
    wins,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

router.get("/wins/wall", async (req, res): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;
  const category = req.query.category as string | undefined;

  const conditions: any[] = [
    inArray(winsTable.status, ["published", "featured"]),
  ];

  if (category) {
    conditions.push(eq(winMilestonesTable.category, category));
  }

  const totalResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(winsTable)
    .innerJoin(winMilestonesTable, eq(winsTable.milestoneId, winMilestonesTable.id))
    .where(and(...conditions));
  const total = totalResult[0]?.count ?? 0;

  const wins = await db
    .select({
      id: winsTable.id,
      userId: winsTable.userId,
      userName: usersTable.name,
      milestoneId: winsTable.milestoneId,
      milestoneName: winMilestonesTable.name,
      milestoneIcon: winMilestonesTable.icon,
      milestoneSlug: winMilestonesTable.slug,
      milestoneCategory: winMilestonesTable.category,
      title: winsTable.title,
      description: winsTable.description,
      revenueAmount: winsTable.revenueAmount,
      proofImageUrl: winsTable.proofImageUrl,
      proofVerified: winsTable.proofVerified,
      winDate: winsTable.winDate,
      status: winsTable.status,
      featuredAt: winsTable.featuredAt,
      communityPostId: winsTable.communityPostId,
      createdAt: winsTable.createdAt,
    })
    .from(winsTable)
    .innerJoin(winMilestonesTable, eq(winsTable.milestoneId, winMilestonesTable.id))
    .innerJoin(usersTable, eq(winsTable.userId, usersTable.id))
    .where(and(...conditions))
    .orderBy(
      sql`CASE WHEN ${winsTable.status} = 'featured' THEN 0 ELSE 1 END`,
      desc(winsTable.createdAt)
    )
    .limit(limit)
    .offset(offset);

  res.json({
    wins,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

router.get("/wins/dashboard-stats", async (req, res): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const userId = req.userId;

  const totalMilestonesResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(winMilestonesTable)
    .where(eq(winMilestonesTable.isActive, true));
  const totalMilestones = totalMilestonesResult[0]?.count ?? 0;

  const achievedResult = await db
    .select({ milestoneId: winsTable.milestoneId })
    .from(winsTable)
    .where(and(
      eq(winsTable.userId, userId),
      ne(winsTable.status, "hidden"),
      ne(winsTable.status, "draft"),
    ))
    .groupBy(winsTable.milestoneId);
  const achievedCount = achievedResult.length;

  const percentage = totalMilestones > 0 ? Math.round((achievedCount / totalMilestones) * 100) : 0;

  const [latestWin] = await db
    .select({
      id: winsTable.id,
      title: winsTable.title,
      milestoneName: winMilestonesTable.name,
      milestoneIcon: winMilestonesTable.icon,
      winDate: winsTable.winDate,
      createdAt: winsTable.createdAt,
    })
    .from(winsTable)
    .innerJoin(winMilestonesTable, eq(winsTable.milestoneId, winMilestonesTable.id))
    .where(and(
      eq(winsTable.userId, userId),
      ne(winsTable.status, "hidden"),
      ne(winsTable.status, "draft"),
    ))
    .orderBy(desc(winsTable.createdAt))
    .limit(1);

  const achievedMilestoneIds = achievedResult.map(r => r.milestoneId);

  let nextMilestone = null;
  if (achievedMilestoneIds.length > 0) {
    const [next] = await db
      .select({
        id: winMilestonesTable.id,
        name: winMilestonesTable.name,
        icon: winMilestonesTable.icon,
        slug: winMilestonesTable.slug,
        category: winMilestonesTable.category,
      })
      .from(winMilestonesTable)
      .where(and(
        eq(winMilestonesTable.isActive, true),
        sql`${winMilestonesTable.id} NOT IN (${sql.join(achievedMilestoneIds.map(id => sql`${id}`), sql`, `)})`
      ))
      .orderBy(asc(winMilestonesTable.sortOrder))
      .limit(1);
    nextMilestone = next || null;
  } else {
    const [next] = await db
      .select({
        id: winMilestonesTable.id,
        name: winMilestonesTable.name,
        icon: winMilestonesTable.icon,
        slug: winMilestonesTable.slug,
        category: winMilestonesTable.category,
      })
      .from(winMilestonesTable)
      .where(eq(winMilestonesTable.isActive, true))
      .orderBy(asc(winMilestonesTable.sortOrder))
      .limit(1);
    nextMilestone = next || null;
  }

  res.json({
    achievedCount,
    totalMilestones,
    percentage,
    latestWin: latestWin || null,
    nextMilestone,
  });
});

router.get("/wins/:id", async (req, res): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const winId = parseInt(req.params.id);

  const [win] = await db
    .select({
      id: winsTable.id,
      userId: winsTable.userId,
      userName: usersTable.name,
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
      shareToCommunity: winsTable.shareToCommunity,
      communityPostId: winsTable.communityPostId,
      allowTestimonial: winsTable.allowTestimonial,
      allowPublicName: winsTable.allowPublicName,
      status: winsTable.status,
      featuredAt: winsTable.featuredAt,
      testimonialRequested: winsTable.testimonialRequested,
      testimonialText: winsTable.testimonialText,
      testimonialApproved: winsTable.testimonialApproved,
      createdAt: winsTable.createdAt,
      updatedAt: winsTable.updatedAt,
    })
    .from(winsTable)
    .innerJoin(winMilestonesTable, eq(winsTable.milestoneId, winMilestonesTable.id))
    .innerJoin(usersTable, eq(winsTable.userId, usersTable.id))
    .where(eq(winsTable.id, winId));

  if (!win) {
    res.status(404).json({ error: "Win not found" });
    return;
  }

  if (win.status === "hidden" && win.userId !== req.userId) {
    res.status(404).json({ error: "Win not found" });
    return;
  }
  if (win.status === "draft" && win.userId !== req.userId) {
    res.status(404).json({ error: "Win not found" });
    return;
  }

  res.json(win);
});

router.put("/wins/:id", async (req, res): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const userId = req.userId;
  const winId = parseInt(req.params.id);

  const [existing] = await db
    .select()
    .from(winsTable)
    .where(eq(winsTable.id, winId));

  if (!existing) {
    res.status(404).json({ error: "Win not found" });
    return;
  }
  if (existing.userId !== userId) {
    res.status(403).json({ error: "You can only edit your own wins" });
    return;
  }

  const {
    milestoneId, title, description, revenueAmount, metricLabel, metricValue,
    proofImageUrl, proofImage2Url, winDate, shareToCommunity, allowTestimonial,
    allowPublicName, status, testimonialText,
  } = req.body;

  const updates: Record<string, any> = {};

  if (milestoneId !== undefined) {
    const [milestone] = await db
      .select()
      .from(winMilestonesTable)
      .where(and(eq(winMilestonesTable.id, milestoneId), eq(winMilestonesTable.isActive, true)));
    if (!milestone) {
      res.status(400).json({ error: "Invalid milestone" });
      return;
    }
    updates.milestoneId = milestoneId;
  }
  if (title !== undefined) {
    if (typeof title !== "string" || title.length < 3 || title.length > 200) {
      res.status(400).json({ error: "Title must be between 3 and 200 characters" });
      return;
    }
    updates.title = title;
  }
  if (description !== undefined) {
    if (typeof description !== "string" || description.length < 10 || description.length > 2000) {
      res.status(400).json({ error: "Description must be between 10 and 2000 characters" });
      return;
    }
    updates.description = description;
  }
  if (revenueAmount !== undefined) updates.revenueAmount = revenueAmount != null ? String(revenueAmount) : null;
  if (metricLabel !== undefined) updates.metricLabel = metricLabel || null;
  if (metricValue !== undefined) updates.metricValue = metricValue || null;
  if (proofImageUrl !== undefined) updates.proofImageUrl = proofImageUrl || null;
  if (proofImage2Url !== undefined) updates.proofImage2Url = proofImage2Url || null;
  if (winDate !== undefined) updates.winDate = winDate;
  if (shareToCommunity !== undefined) updates.shareToCommunity = shareToCommunity;
  if (allowTestimonial !== undefined) updates.allowTestimonial = allowTestimonial;
  if (allowPublicName !== undefined) updates.allowPublicName = allowPublicName;
  if (testimonialText !== undefined) updates.testimonialText = testimonialText;
  if (status !== undefined && (status === "draft" || status === "published")) {
    updates.status = status;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [updated] = await db
    .update(winsTable)
    .set(updates)
    .where(eq(winsTable.id, winId))
    .returning();

  res.json(updated);
});

router.delete("/wins/:id", async (req, res): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const userId = req.userId;
  const winId = parseInt(req.params.id);

  const [existing] = await db
    .select()
    .from(winsTable)
    .where(eq(winsTable.id, winId));

  if (!existing) {
    res.status(404).json({ error: "Win not found" });
    return;
  }
  if (existing.userId !== userId) {
    res.status(403).json({ error: "You can only delete your own wins" });
    return;
  }

  await db.delete(winsTable).where(eq(winsTable.id, winId));

  res.json({ success: true });
});

export default router;
