import { Router, type Request, type Response } from "express";
import {
  db,
  usersTable,
  communityPostsTable,
  communityCommentsTable,
  communityReactionsTable,
  communityCategoriesTable,
  userProductsTable,
  productsTable,
} from "@workspace/db";
import { eq, and, desc, asc, sql, gte } from "drizzle-orm";

const router = Router();

function requireAdmin(req: Request, res: Response, next: Function) {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  db.select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId))
    .limit(1)
    .then(([user]) => {
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      next();
    })
    .catch(() => {
      res.status(500).json({ error: "Failed to verify admin status" });
    });
}

router.get("/admin/community/categories", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const categories = await db
      .select()
      .from(communityCategoriesTable)
      .orderBy(asc(communityCategoriesTable.sortOrder));
    res.json(categories);
  } catch {
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

router.post("/admin/community/categories", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, slug, description, sortOrder, icon } = req.body;
    if (!name || !slug) {
      res.status(400).json({ error: "Name and slug are required" });
      return;
    }

    const slugRegex = /^[a-z0-9-]+$/;
    if (!slugRegex.test(slug)) {
      res.status(400).json({ error: "Slug must contain only lowercase letters, numbers, and hyphens" });
      return;
    }

    const [category] = await db
      .insert(communityCategoriesTable)
      .values({
        name,
        slug,
        description: description || null,
        sortOrder: sortOrder ?? 0,
      })
      .returning();

    res.status(201).json(category);
  } catch (error: any) {
    if (error?.code === "23505") {
      res.status(409).json({ error: "A category with this name or slug already exists" });
      return;
    }
    res.status(500).json({ error: "Failed to create category" });
  }
});

router.patch("/admin/community/categories/reorder", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) {
      res.status(400).json({ error: "Order must be an array of { id, sortOrder }" });
      return;
    }

    for (const item of order) {
      await db
        .update(communityCategoriesTable)
        .set({ sortOrder: item.sortOrder })
        .where(eq(communityCategoriesTable.id, item.id));
    }

    const categories = await db
      .select()
      .from(communityCategoriesTable)
      .orderBy(asc(communityCategoriesTable.sortOrder));

    res.json(categories);
  } catch {
    res.status(500).json({ error: "Failed to reorder categories" });
  }
});

router.patch("/admin/community/categories/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { name, slug, description, sortOrder, isActive } = req.body;

    if (slug) {
      const slugRegex = /^[a-z0-9-]+$/;
      if (!slugRegex.test(slug)) {
        res.status(400).json({ error: "Slug must contain only lowercase letters, numbers, and hyphens" });
        return;
      }
    }

    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (slug !== undefined) updates.slug = slug;
    if (description !== undefined) updates.description = description;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;
    if (isActive !== undefined) updates.isActive = isActive;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [updated] = await db
      .update(communityCategoriesTable)
      .set(updates)
      .where(eq(communityCategoriesTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    res.json(updated);
  } catch (error: any) {
    if (error?.code === "23505") {
      res.status(409).json({ error: "A category with this name or slug already exists" });
      return;
    }
    res.status(500).json({ error: "Failed to update category" });
  }
});

router.delete("/admin/community/categories/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);

    const [updated] = await db
      .update(communityCategoriesTable)
      .set({ isActive: false })
      .where(eq(communityCategoriesTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to deactivate category" });
  }
});

router.get("/admin/community/posts", requireAdmin, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const offset = (page - 1) * limit;

    const posts = await db
      .select({
        id: communityPostsTable.id,
        content: communityPostsTable.content,
        imageUrl: communityPostsTable.imageUrl,
        isPinned: communityPostsTable.isPinned,
        isFeatured: communityPostsTable.isFeatured,
        isDeleted: communityPostsTable.isDeleted,
        deletedBy: communityPostsTable.deletedBy,
        commentCount: communityPostsTable.commentCount,
        reactionCount: communityPostsTable.reactionCount,
        createdAt: communityPostsTable.createdAt,
        authorId: communityPostsTable.authorId,
        authorName: usersTable.name,
        authorEmail: usersTable.email,
        categoryId: communityPostsTable.categoryId,
        categoryName: communityCategoriesTable.name,
      })
      .from(communityPostsTable)
      .innerJoin(usersTable, eq(communityPostsTable.authorId, usersTable.id))
      .innerJoin(communityCategoriesTable, eq(communityPostsTable.categoryId, communityCategoriesTable.id))
      .orderBy(desc(communityPostsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(communityPostsTable);

    res.json({ posts, total, page, limit });
  } catch {
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

router.patch("/admin/community/posts/:id/pin", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const [post] = await db
      .select({ isPinned: communityPostsTable.isPinned })
      .from(communityPostsTable)
      .where(eq(communityPostsTable.id, id));

    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const [updated] = await db
      .update(communityPostsTable)
      .set({ isPinned: !post.isPinned })
      .where(eq(communityPostsTable.id, id))
      .returning();

    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to toggle pin" });
  }
});

router.patch("/admin/community/posts/:id/feature", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const [post] = await db
      .select({ isFeatured: communityPostsTable.isFeatured })
      .from(communityPostsTable)
      .where(eq(communityPostsTable.id, id));

    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const [updated] = await db
      .update(communityPostsTable)
      .set({ isFeatured: !post.isFeatured })
      .where(eq(communityPostsTable.id, id))
      .returning();

    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to toggle feature" });
  }
});

router.delete("/admin/community/posts/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);

    const [post] = await db
      .select()
      .from(communityPostsTable)
      .where(eq(communityPostsTable.id, id));

    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const [updated] = await db
      .update(communityPostsTable)
      .set({ isDeleted: true, deletedBy: "admin" })
      .where(eq(communityPostsTable.id, id))
      .returning();

    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to delete post" });
  }
});

router.get("/admin/community/comments", requireAdmin, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const offset = (page - 1) * limit;

    const comments = await db
      .select({
        id: communityCommentsTable.id,
        postId: communityCommentsTable.postId,
        content: communityCommentsTable.content,
        isDeleted: communityCommentsTable.isDeleted,
        deletedBy: communityCommentsTable.deletedBy,
        reactionCount: communityCommentsTable.reactionCount,
        createdAt: communityCommentsTable.createdAt,
        authorId: communityCommentsTable.authorId,
        authorName: usersTable.name,
        authorEmail: usersTable.email,
      })
      .from(communityCommentsTable)
      .innerJoin(usersTable, eq(communityCommentsTable.authorId, usersTable.id))
      .orderBy(desc(communityCommentsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(communityCommentsTable);

    res.json({ comments, total, page, limit });
  } catch {
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

router.delete("/admin/community/comments/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);

    const [comment] = await db
      .select()
      .from(communityCommentsTable)
      .where(eq(communityCommentsTable.id, id));

    if (!comment) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }

    const [updated] = await db
      .update(communityCommentsTable)
      .set({ isDeleted: true, deletedBy: "admin" })
      .where(eq(communityCommentsTable.id, id))
      .returning();

    if (!comment.isDeleted) {
      await db
        .update(communityPostsTable)
        .set({ commentCount: sql`${communityPostsTable.commentCount} - 1` })
        .where(eq(communityPostsTable.id, comment.postId));
    }

    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to delete comment" });
  }
});

router.get("/admin/community/analytics", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(todayStart);
    monthStart.setDate(monthStart.getDate() - 30);

    const [totalPosts] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(communityPostsTable)
      .where(eq(communityPostsTable.isDeleted, false));

    const [todayPosts] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(communityPostsTable)
      .where(and(eq(communityPostsTable.isDeleted, false), gte(communityPostsTable.createdAt, todayStart)));

    const [weekPosts] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(communityPostsTable)
      .where(and(eq(communityPostsTable.isDeleted, false), gte(communityPostsTable.createdAt, weekStart)));

    const [monthPosts] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(communityPostsTable)
      .where(and(eq(communityPostsTable.isDeleted, false), gte(communityPostsTable.createdAt, monthStart)));

    const [totalComments] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(communityCommentsTable)
      .where(eq(communityCommentsTable.isDeleted, false));

    const [todayComments] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(communityCommentsTable)
      .where(and(eq(communityCommentsTable.isDeleted, false), gte(communityCommentsTable.createdAt, todayStart)));

    const [weekComments] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(communityCommentsTable)
      .where(and(eq(communityCommentsTable.isDeleted, false), gte(communityCommentsTable.createdAt, weekStart)));

    const [monthComments] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(communityCommentsTable)
      .where(and(eq(communityCommentsTable.isDeleted, false), gte(communityCommentsTable.createdAt, monthStart)));

    const [totalReactions] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(communityReactionsTable);

    const [todayReactions] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(communityReactionsTable)
      .where(gte(communityReactionsTable.createdAt, todayStart));

    const [weekReactions] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(communityReactionsTable)
      .where(gte(communityReactionsTable.createdAt, weekStart));

    const [monthReactions] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(communityReactionsTable)
      .where(gte(communityReactionsTable.createdAt, monthStart));

    const activeCategories = await db
      .select({
        id: communityCategoriesTable.id,
        name: communityCategoriesTable.name,
        slug: communityCategoriesTable.slug,
        postCount: communityCategoriesTable.postsCount,
      })
      .from(communityCategoriesTable)
      .where(eq(communityCategoriesTable.isActive, true))
      .orderBy(desc(communityCategoriesTable.postsCount))
      .limit(10);

    const topPosters = await db
      .select({
        userId: communityPostsTable.authorId,
        name: usersTable.name,
        email: usersTable.email,
        postCount: sql<number>`count(*)::int`,
      })
      .from(communityPostsTable)
      .innerJoin(usersTable, eq(communityPostsTable.authorId, usersTable.id))
      .where(eq(communityPostsTable.isDeleted, false))
      .groupBy(communityPostsTable.authorId, usersTable.name, usersTable.email)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    const topCommenters = await db
      .select({
        userId: communityCommentsTable.authorId,
        name: usersTable.name,
        email: usersTable.email,
        commentCount: sql<number>`count(*)::int`,
      })
      .from(communityCommentsTable)
      .innerJoin(usersTable, eq(communityCommentsTable.authorId, usersTable.id))
      .where(eq(communityCommentsTable.isDeleted, false))
      .groupBy(communityCommentsTable.authorId, usersTable.name, usersTable.email)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    const [newMembers] = await db
      .select({ count: sql<number>`count(distinct ${userProductsTable.userId})::int` })
      .from(userProductsTable)
      .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
      .where(
        and(
          gte(userProductsTable.purchasedAt, monthStart),
          eq(userProductsTable.status, "active"),
          sql`${productsTable.entitlementKeys}::jsonb @> '"community:access"'::jsonb`
        )
      );

    res.json({
      posts: {
        total: totalPosts.count,
        today: todayPosts.count,
        thisWeek: weekPosts.count,
        thisMonth: monthPosts.count,
      },
      comments: {
        total: totalComments.count,
        today: todayComments.count,
        thisWeek: weekComments.count,
        thisMonth: monthComments.count,
      },
      reactions: {
        total: totalReactions.count,
        today: todayReactions.count,
        thisWeek: weekReactions.count,
        thisMonth: monthReactions.count,
      },
      activeCategories,
      topPosters,
      topCommenters,
      newMembersThisMonth: newMembers.count,
    });
  } catch (error) {
    console.error("Analytics error:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

export default router;
