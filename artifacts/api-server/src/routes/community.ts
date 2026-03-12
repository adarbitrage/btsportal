import { Router, type IRouter } from "express";
import {
  db, usersTable,
  communityPostsTable, communityCommentsTable, communityReactionsTable,
  communityCategoriesTable, communityBadgesTable, communityNotificationsTable,
  userProductsTable, productsTable,
} from "@workspace/db";
import { eq, and, desc, asc, sql, or, isNull, gte, ilike, count, ne } from "drizzle-orm";
import { hasEntitlement, getHighestProductLabel, getUserEntitlements } from "../lib/entitlements";

const router: IRouter = Router();

async function requireCommunityAccess(req: any, res: any): Promise<boolean> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }
  const has = await hasEntitlement(userId, "community:access");
  if (!has) {
    res.status(403).json({ error: "Community access required. Upgrade to a mentorship tier." });
    return false;
  }
  return true;
}

async function checkAndAwardBadges(userId: number) {
  const postCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communityPostsTable)
    .where(and(eq(communityPostsTable.authorId, userId), eq(communityPostsTable.isDeleted, false)));
  const totalPosts = postCountResult[0]?.count ?? 0;

  const commentCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communityCommentsTable)
    .where(and(eq(communityCommentsTable.authorId, userId), eq(communityCommentsTable.isDeleted, false)));
  const totalComments = commentCountResult[0]?.count ?? 0;

  const badgesToAward: string[] = [];

  if (totalPosts === 1 && totalComments === 0) {
    badgesToAward.push("newcomer");
  }

  if (totalPosts >= 10 || totalComments >= 20) {
    badgesToAward.push("contributor");
  }

  const winsCategory = await db
    .select({ id: communityCategoriesTable.id })
    .from(communityCategoriesTable)
    .where(eq(communityCategoriesTable.slug, "wins"))
    .limit(1);
  if (winsCategory.length > 0) {
    const winPosts = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(communityPostsTable)
      .where(and(
        eq(communityPostsTable.authorId, userId),
        eq(communityPostsTable.categoryId, winsCategory[0].id),
        eq(communityPostsTable.isDeleted, false),
      ));
    if ((winPosts[0]?.count ?? 0) >= 1) {
      badgesToAward.push("first_win");
    }
  }

  const entitlements = await getUserEntitlements(userId);
  if (entitlements.has("coaching:one_on_one:monthly") || entitlements.has("coaching:one_on_one:weekly")) {
    badgesToAward.push("mentor");
  }

  const [user] = await db.select({ currentStreak: usersTable.currentStreak }).from(usersTable).where(eq(usersTable.id, userId));
  if (user && user.currentStreak >= 7) {
    badgesToAward.push("streak");
  }

  for (const badgeType of badgesToAward) {
    await db
      .insert(communityBadgesTable)
      .values({ userId, badgeType })
      .onConflictDoNothing();
  }
}

async function createNotification(params: {
  userId: number;
  actorId: number;
  type: string;
  postId?: number;
  commentId?: number;
  message: string;
}) {
  if (params.userId === params.actorId) return;
  await db.insert(communityNotificationsTable).values({
    userId: params.userId,
    actorId: params.actorId,
    type: params.type,
    postId: params.postId ?? null,
    commentId: params.commentId ?? null,
    message: params.message,
  });
}

router.get("/community/categories", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;

  const categories = await db
    .select()
    .from(communityCategoriesTable)
    .where(eq(communityCategoriesTable.isActive, true))
    .orderBy(asc(communityCategoriesTable.sortOrder));

  res.json(categories);
});

router.get("/community/posts", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;
  const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string) : undefined;

  const conditions = [eq(communityPostsTable.isDeleted, false)];
  if (categoryId) {
    conditions.push(eq(communityPostsTable.categoryId, categoryId));
  }

  const totalResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communityPostsTable)
    .where(and(...conditions));
  const total = totalResult[0]?.count ?? 0;

  const posts = await db
    .select({
      id: communityPostsTable.id,
      authorId: communityPostsTable.authorId,
      authorName: usersTable.name,
      categoryId: communityPostsTable.categoryId,
      categoryName: communityCategoriesTable.name,
      categorySlug: communityCategoriesTable.slug,
      content: communityPostsTable.content,
      imageUrl: communityPostsTable.imageUrl,
      isPinned: communityPostsTable.isPinned,
      commentCount: communityPostsTable.commentCount,
      reactionCount: communityPostsTable.reactionCount,
      createdAt: communityPostsTable.createdAt,
      updatedAt: communityPostsTable.updatedAt,
    })
    .from(communityPostsTable)
    .innerJoin(usersTable, eq(communityPostsTable.authorId, usersTable.id))
    .innerJoin(communityCategoriesTable, eq(communityPostsTable.categoryId, communityCategoriesTable.id))
    .where(and(...conditions))
    .orderBy(desc(communityPostsTable.isPinned), desc(communityPostsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const userId = req.userId!;
  const postIds = posts.map(p => p.id);
  let userReactions: Set<number> = new Set();
  if (postIds.length > 0) {
    const reactions = await db
      .select({ postId: communityReactionsTable.postId })
      .from(communityReactionsTable)
      .where(and(
        eq(communityReactionsTable.userId, userId),
        sql`${communityReactionsTable.postId} IN (${sql.join(postIds.map(id => sql`${id}`), sql`, `)})`
      ));
    userReactions = new Set(reactions.map(r => r.postId!).filter(Boolean));
  }

  const postsWithReacted = posts.map(p => ({
    ...p,
    hasReacted: userReactions.has(p.id),
  }));

  res.json({
    posts: postsWithReacted,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

router.post("/community/posts", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;
  const userId = req.userId!;

  const { content, categoryId, imageUrl } = req.body;

  if (!content || typeof content !== "string" || content.length < 10 || content.length > 5000) {
    res.status(400).json({ error: "Post content must be between 10 and 5000 characters" });
    return;
  }
  if (!categoryId || typeof categoryId !== "number") {
    res.status(400).json({ error: "categoryId is required" });
    return;
  }

  if (imageUrl && typeof imageUrl === "string") {
    const allowedExts = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    const lowerUrl = imageUrl.toLowerCase();
    if (!allowedExts.some(ext => lowerUrl.includes(ext))) {
      res.status(400).json({ error: "Image must be JPEG, PNG, GIF, or WebP" });
      return;
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const postsToday = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communityPostsTable)
    .where(and(
      eq(communityPostsTable.authorId, userId),
      gte(communityPostsTable.createdAt, today),
    ));
  if ((postsToday[0]?.count ?? 0) >= 10) {
    res.status(429).json({ error: "Rate limit: maximum 10 posts per day" });
    return;
  }

  const [category] = await db
    .select()
    .from(communityCategoriesTable)
    .where(and(eq(communityCategoriesTable.id, categoryId), eq(communityCategoriesTable.isActive, true)));
  if (!category) {
    res.status(400).json({ error: "Invalid category" });
    return;
  }

  const [post] = await db
    .insert(communityPostsTable)
    .values({
      authorId: userId,
      categoryId,
      content,
      imageUrl: imageUrl || null,
    })
    .returning();

  await db
    .update(communityCategoriesTable)
    .set({ postsCount: sql`${communityCategoriesTable.postsCount} + 1` })
    .where(eq(communityCategoriesTable.id, categoryId));

  await checkAndAwardBadges(userId);

  const mentionRegex = /@(\w+)/g;
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    const mentionedName = match[1];
    const [mentionedUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(ilike(usersTable.name, `%${mentionedName}%`))
      .limit(1);
    if (mentionedUser) {
      const [author] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      await createNotification({
        userId: mentionedUser.id,
        actorId: userId,
        type: "mention",
        postId: post.id,
        message: `${author?.name ?? "Someone"} mentioned you in a post`,
      });
    }
  }

  res.status(201).json(post);
});

router.patch("/community/posts/:postId", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;
  const userId = req.userId!;
  const postId = parseInt(req.params.postId);

  const [post] = await db
    .select()
    .from(communityPostsTable)
    .where(and(eq(communityPostsTable.id, postId), eq(communityPostsTable.isDeleted, false)));

  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  if (post.authorId !== userId) {
    res.status(403).json({ error: "You can only edit your own posts" });
    return;
  }

  const minutesSinceCreation = (Date.now() - post.createdAt.getTime()) / (1000 * 60);
  if (minutesSinceCreation > 15) {
    res.status(403).json({ error: "Posts can only be edited within 15 minutes of creation" });
    return;
  }

  const { content } = req.body;
  if (!content || typeof content !== "string" || content.length < 10 || content.length > 5000) {
    res.status(400).json({ error: "Post content must be between 10 and 5000 characters" });
    return;
  }

  const [updated] = await db
    .update(communityPostsTable)
    .set({ content })
    .where(eq(communityPostsTable.id, postId))
    .returning();

  res.json(updated);
});

router.delete("/community/posts/:postId", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;
  const userId = req.userId!;
  const postId = parseInt(req.params.postId);

  const [post] = await db
    .select()
    .from(communityPostsTable)
    .where(and(eq(communityPostsTable.id, postId), eq(communityPostsTable.isDeleted, false)));

  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  const isAdmin = user?.role === "admin";

  if (post.authorId !== userId && !isAdmin) {
    res.status(403).json({ error: "You can only delete your own posts" });
    return;
  }

  await db
    .update(communityPostsTable)
    .set({ isDeleted: true, deletedBy: isAdmin && post.authorId !== userId ? "admin" : "author" })
    .where(eq(communityPostsTable.id, postId));

  await db
    .update(communityCategoriesTable)
    .set({ postsCount: sql`GREATEST(${communityCategoriesTable.postsCount} - 1, 0)` })
    .where(eq(communityCategoriesTable.id, post.categoryId));

  res.json({ success: true });
});

router.get("/community/posts/:postId/comments", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;
  const postId = parseInt(req.params.postId);
  const userId = req.userId!;

  const comments = await db
    .select({
      id: communityCommentsTable.id,
      postId: communityCommentsTable.postId,
      authorId: communityCommentsTable.authorId,
      authorName: usersTable.name,
      parentId: communityCommentsTable.parentId,
      content: communityCommentsTable.content,
      reactionCount: communityCommentsTable.reactionCount,
      createdAt: communityCommentsTable.createdAt,
      updatedAt: communityCommentsTable.updatedAt,
    })
    .from(communityCommentsTable)
    .innerJoin(usersTable, eq(communityCommentsTable.authorId, usersTable.id))
    .where(and(eq(communityCommentsTable.postId, postId), eq(communityCommentsTable.isDeleted, false)))
    .orderBy(asc(communityCommentsTable.createdAt));

  const commentIds = comments.map(c => c.id);
  let userReactions: Set<number> = new Set();
  if (commentIds.length > 0) {
    const reactions = await db
      .select({ commentId: communityReactionsTable.commentId })
      .from(communityReactionsTable)
      .where(and(
        eq(communityReactionsTable.userId, userId),
        sql`${communityReactionsTable.commentId} IN (${sql.join(commentIds.map(id => sql`${id}`), sql`, `)})`
      ));
    userReactions = new Set(reactions.map(r => r.commentId!).filter(Boolean));
  }

  const commentsWithReacted = comments.map(c => ({
    ...c,
    hasReacted: userReactions.has(c.id),
  }));

  res.json(commentsWithReacted);
});

router.post("/community/posts/:postId/comments", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;
  const userId = req.userId!;
  const postId = parseInt(req.params.postId);

  const { content, parentId } = req.body;

  if (!content || typeof content !== "string" || content.length > 2000) {
    res.status(400).json({ error: "Comment content must be at most 2000 characters" });
    return;
  }
  if (content.length < 1) {
    res.status(400).json({ error: "Comment content is required" });
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const commentsToday = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communityCommentsTable)
    .where(and(
      eq(communityCommentsTable.authorId, userId),
      gte(communityCommentsTable.createdAt, today),
    ));
  if ((commentsToday[0]?.count ?? 0) >= 30) {
    res.status(429).json({ error: "Rate limit: maximum 30 comments per day" });
    return;
  }

  const [post] = await db
    .select()
    .from(communityPostsTable)
    .where(and(eq(communityPostsTable.id, postId), eq(communityPostsTable.isDeleted, false)));
  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  if (parentId) {
    const [parent] = await db
      .select()
      .from(communityCommentsTable)
      .where(and(
        eq(communityCommentsTable.id, parentId),
        eq(communityCommentsTable.postId, postId),
        eq(communityCommentsTable.isDeleted, false),
      ));
    if (!parent) {
      res.status(400).json({ error: "Parent comment not found" });
      return;
    }
    if (parent.parentId !== null) {
      res.status(400).json({ error: "Only one level of replies is allowed" });
      return;
    }
  }

  const [comment] = await db
    .insert(communityCommentsTable)
    .values({
      postId,
      authorId: userId,
      parentId: parentId || null,
      content,
    })
    .returning();

  await db
    .update(communityPostsTable)
    .set({ commentCount: sql`${communityPostsTable.commentCount} + 1` })
    .where(eq(communityPostsTable.id, postId));

  const [author] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));

  if (post.authorId !== userId) {
    await createNotification({
      userId: post.authorId,
      actorId: userId,
      type: "comment",
      postId: post.id,
      commentId: comment.id,
      message: `${author?.name ?? "Someone"} commented on your post`,
    });
  }

  if (parentId) {
    const [parentComment] = await db
      .select({ authorId: communityCommentsTable.authorId })
      .from(communityCommentsTable)
      .where(eq(communityCommentsTable.id, parentId));
    if (parentComment && parentComment.authorId !== userId) {
      await createNotification({
        userId: parentComment.authorId,
        actorId: userId,
        type: "reply",
        postId: post.id,
        commentId: comment.id,
        message: `${author?.name ?? "Someone"} replied to your comment`,
      });
    }
  }

  const mentionRegex = /@(\w+)/g;
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    const mentionedName = match[1];
    const [mentionedUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(ilike(usersTable.name, `%${mentionedName}%`))
      .limit(1);
    if (mentionedUser && mentionedUser.id !== userId) {
      await createNotification({
        userId: mentionedUser.id,
        actorId: userId,
        type: "mention",
        postId: post.id,
        commentId: comment.id,
        message: `${author?.name ?? "Someone"} mentioned you in a comment`,
      });
    }
  }

  await checkAndAwardBadges(userId);

  res.status(201).json(comment);
});

router.patch("/community/comments/:commentId", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;
  const userId = req.userId!;
  const commentId = parseInt(req.params.commentId);

  const [comment] = await db
    .select()
    .from(communityCommentsTable)
    .where(and(eq(communityCommentsTable.id, commentId), eq(communityCommentsTable.isDeleted, false)));

  if (!comment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }
  if (comment.authorId !== userId) {
    res.status(403).json({ error: "You can only edit your own comments" });
    return;
  }

  const minutesSinceCreation = (Date.now() - comment.createdAt.getTime()) / (1000 * 60);
  if (minutesSinceCreation > 5) {
    res.status(403).json({ error: "Comments can only be edited within 5 minutes of creation" });
    return;
  }

  const { content } = req.body;
  if (!content || typeof content !== "string" || content.length > 2000) {
    res.status(400).json({ error: "Comment content must be at most 2000 characters" });
    return;
  }

  const [updated] = await db
    .update(communityCommentsTable)
    .set({ content })
    .where(eq(communityCommentsTable.id, commentId))
    .returning();

  res.json(updated);
});

router.delete("/community/comments/:commentId", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;
  const userId = req.userId!;
  const commentId = parseInt(req.params.commentId);

  const [comment] = await db
    .select()
    .from(communityCommentsTable)
    .where(and(eq(communityCommentsTable.id, commentId), eq(communityCommentsTable.isDeleted, false)));

  if (!comment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  const isAdmin = user?.role === "admin";

  if (comment.authorId !== userId && !isAdmin) {
    res.status(403).json({ error: "You can only delete your own comments" });
    return;
  }

  await db
    .update(communityCommentsTable)
    .set({ isDeleted: true, deletedBy: isAdmin && comment.authorId !== userId ? "admin" : "author" })
    .where(eq(communityCommentsTable.id, commentId));

  await db
    .update(communityPostsTable)
    .set({ commentCount: sql`GREATEST(${communityPostsTable.commentCount} - 1, 0)` })
    .where(eq(communityPostsTable.id, comment.postId));

  res.json({ success: true });
});

router.post("/community/reactions", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;
  const userId = req.userId!;

  const { postId, commentId } = req.body;

  if (!postId && !commentId) {
    res.status(400).json({ error: "Either postId or commentId is required" });
    return;
  }
  if (postId && commentId) {
    res.status(400).json({ error: "Provide either postId or commentId, not both" });
    return;
  }

  if (postId) {
    const [post] = await db
      .select()
      .from(communityPostsTable)
      .where(and(eq(communityPostsTable.id, postId), eq(communityPostsTable.isDeleted, false)));
    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const [existing] = await db
      .select()
      .from(communityReactionsTable)
      .where(and(
        eq(communityReactionsTable.userId, userId),
        eq(communityReactionsTable.postId, postId),
      ));

    if (existing) {
      await db.delete(communityReactionsTable).where(eq(communityReactionsTable.id, existing.id));
      await db
        .update(communityPostsTable)
        .set({ reactionCount: sql`GREATEST(${communityPostsTable.reactionCount} - 1, 0)` })
        .where(eq(communityPostsTable.id, postId));
      const [updated] = await db.select({ reactionCount: communityPostsTable.reactionCount }).from(communityPostsTable).where(eq(communityPostsTable.id, postId));
      res.json({ toggled: "removed", reactionCount: updated?.reactionCount ?? 0 });
    } else {
      await db.insert(communityReactionsTable).values({ userId, postId, reactionType: "fire" });
      await db
        .update(communityPostsTable)
        .set({ reactionCount: sql`${communityPostsTable.reactionCount} + 1` })
        .where(eq(communityPostsTable.id, postId));
      const [updated] = await db.select({ reactionCount: communityPostsTable.reactionCount }).from(communityPostsTable).where(eq(communityPostsTable.id, postId));

      if (post.authorId !== userId) {
        const [author] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
        await createNotification({
          userId: post.authorId,
          actorId: userId,
          type: "reaction",
          postId,
          message: `${author?.name ?? "Someone"} reacted to your post`,
        });
      }

      res.json({ toggled: "added", reactionCount: updated?.reactionCount ?? 0 });
    }
  } else {
    const [comment] = await db
      .select()
      .from(communityCommentsTable)
      .where(and(eq(communityCommentsTable.id, commentId), eq(communityCommentsTable.isDeleted, false)));
    if (!comment) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }

    const [existing] = await db
      .select()
      .from(communityReactionsTable)
      .where(and(
        eq(communityReactionsTable.userId, userId),
        eq(communityReactionsTable.commentId, commentId),
      ));

    if (existing) {
      await db.delete(communityReactionsTable).where(eq(communityReactionsTable.id, existing.id));
      await db
        .update(communityCommentsTable)
        .set({ reactionCount: sql`GREATEST(${communityCommentsTable.reactionCount} - 1, 0)` })
        .where(eq(communityCommentsTable.id, commentId));
      const [updated] = await db.select({ reactionCount: communityCommentsTable.reactionCount }).from(communityCommentsTable).where(eq(communityCommentsTable.id, commentId));
      res.json({ toggled: "removed", reactionCount: updated?.reactionCount ?? 0 });
    } else {
      await db.insert(communityReactionsTable).values({ userId, commentId, reactionType: "fire" });
      await db
        .update(communityCommentsTable)
        .set({ reactionCount: sql`${communityCommentsTable.reactionCount} + 1` })
        .where(eq(communityCommentsTable.id, commentId));
      const [updated] = await db.select({ reactionCount: communityCommentsTable.reactionCount }).from(communityCommentsTable).where(eq(communityCommentsTable.id, commentId));
      res.json({ toggled: "added", reactionCount: updated?.reactionCount ?? 0 });
    }
  }
});

router.get("/community/members", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;
  const search = req.query.search as string | undefined;
  const badge = req.query.badge as string | undefined;
  const sort = (req.query.sort as string) || "newest";

  const communityUserIds = db
    .selectDistinct({ userId: userProductsTable.userId })
    .from(userProductsTable)
    .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
    .where(and(
      eq(userProductsTable.status, "active"),
      sql`${productsTable.entitlementKeys}::text LIKE '%community:access%'`,
      or(
        isNull(userProductsTable.expiresAt),
        gte(userProductsTable.expiresAt, new Date()),
      ),
    ));

  let query = db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      communityBio: usersTable.communityBio,
      memberSince: usersTable.memberSince,
      currentStreak: usersTable.currentStreak,
    })
    .from(usersTable)
    .where(and(
      sql`${usersTable.id} IN (${communityUserIds})`,
      ...(search ? [ilike(usersTable.name, `%${search}%`)] : []),
    ))
    .$dynamic();

  if (badge) {
    query = query.where(
      sql`${usersTable.id} IN (SELECT user_id FROM community_badges WHERE badge_type = ${badge})`
    );
  }

  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(and(
      sql`${usersTable.id} IN (${communityUserIds})`,
      ...(search ? [ilike(usersTable.name, `%${search}%`)] : []),
      ...(badge ? [sql`${usersTable.id} IN (SELECT user_id FROM community_badges WHERE badge_type = ${badge})`] : []),
    ));
  const total = countResult[0]?.count ?? 0;

  let orderByClause;
  switch (sort) {
    case "alpha":
      orderByClause = asc(usersTable.name);
      break;
    case "activity":
      orderByClause = desc(usersTable.currentStreak);
      break;
    case "newest":
    default:
      orderByClause = desc(usersTable.memberSince);
      break;
  }

  const members = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      communityBio: usersTable.communityBio,
      memberSince: usersTable.memberSince,
      currentStreak: usersTable.currentStreak,
    })
    .from(usersTable)
    .where(and(
      sql`${usersTable.id} IN (${communityUserIds})`,
      ...(search ? [ilike(usersTable.name, `%${search}%`)] : []),
      ...(badge ? [sql`${usersTable.id} IN (SELECT user_id FROM community_badges WHERE badge_type = ${badge})`] : []),
    ))
    .orderBy(orderByClause)
    .limit(limit)
    .offset(offset);

  const memberIds = members.map(m => m.id);
  let badgesMap: Record<number, string[]> = {};
  if (memberIds.length > 0) {
    const badges = await db
      .select({ userId: communityBadgesTable.userId, badgeType: communityBadgesTable.badgeType })
      .from(communityBadgesTable)
      .where(sql`${communityBadgesTable.userId} IN (${sql.join(memberIds.map(id => sql`${id}`), sql`, `)})`);
    for (const b of badges) {
      if (!badgesMap[b.userId]) badgesMap[b.userId] = [];
      badgesMap[b.userId].push(b.badgeType);
    }
  }

  const membersWithBadges = members.map(m => ({
    ...m,
    badges: badgesMap[m.id] || [],
  }));

  res.json({
    members: membersWithBadges,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

router.get("/community/members/:userId", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;
  const targetUserId = parseInt(req.params.userId);

  const targetHasAccess = await hasEntitlement(targetUserId, "community:access");
  if (!targetHasAccess) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  const [user] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      communityBio: usersTable.communityBio,
      memberSince: usersTable.memberSince,
      currentStreak: usersTable.currentStreak,
    })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId));

  if (!user) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  const badges = await db
    .select({ badgeType: communityBadgesTable.badgeType, awardedAt: communityBadgesTable.awardedAt })
    .from(communityBadgesTable)
    .where(eq(communityBadgesTable.userId, targetUserId));

  const postCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communityPostsTable)
    .where(and(eq(communityPostsTable.authorId, targetUserId), eq(communityPostsTable.isDeleted, false)));

  const commentCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communityCommentsTable)
    .where(and(eq(communityCommentsTable.authorId, targetUserId), eq(communityCommentsTable.isDeleted, false)));

  const reactionCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communityReactionsTable)
    .where(eq(communityReactionsTable.userId, targetUserId));

  const recentPosts = await db
    .select({
      id: communityPostsTable.id,
      content: communityPostsTable.content,
      categoryName: communityCategoriesTable.name,
      commentCount: communityPostsTable.commentCount,
      reactionCount: communityPostsTable.reactionCount,
      createdAt: communityPostsTable.createdAt,
    })
    .from(communityPostsTable)
    .innerJoin(communityCategoriesTable, eq(communityPostsTable.categoryId, communityCategoriesTable.id))
    .where(and(eq(communityPostsTable.authorId, targetUserId), eq(communityPostsTable.isDeleted, false)))
    .orderBy(desc(communityPostsTable.createdAt))
    .limit(5);

  const entitlements = await getUserEntitlements(targetUserId);
  const product = getHighestProductLabel(entitlements);

  res.json({
    ...user,
    badges,
    activityStats: {
      postsCount: postCountResult[0]?.count ?? 0,
      commentsCount: commentCountResult[0]?.count ?? 0,
      reactionsCount: reactionCountResult[0]?.count ?? 0,
    },
    recentPosts,
    tier: product.name,
    tierSlug: product.slug,
  });
});

router.get("/community/notifications", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;
  const userId = req.userId!;

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;

  const totalResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communityNotificationsTable)
    .where(eq(communityNotificationsTable.userId, userId));
  const total = totalResult[0]?.count ?? 0;

  const unreadResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communityNotificationsTable)
    .where(and(eq(communityNotificationsTable.userId, userId), eq(communityNotificationsTable.isRead, false)));
  const unreadCount = unreadResult[0]?.count ?? 0;

  const notifications = await db
    .select({
      id: communityNotificationsTable.id,
      actorId: communityNotificationsTable.actorId,
      actorName: usersTable.name,
      type: communityNotificationsTable.type,
      postId: communityNotificationsTable.postId,
      commentId: communityNotificationsTable.commentId,
      message: communityNotificationsTable.message,
      isRead: communityNotificationsTable.isRead,
      createdAt: communityNotificationsTable.createdAt,
    })
    .from(communityNotificationsTable)
    .leftJoin(usersTable, eq(communityNotificationsTable.actorId, usersTable.id))
    .where(eq(communityNotificationsTable.userId, userId))
    .orderBy(desc(communityNotificationsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({
    notifications,
    unreadCount,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

router.patch("/community/notifications/:id/read", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;
  const userId = req.userId!;
  const notificationId = parseInt(req.params.id);

  const [notification] = await db
    .select()
    .from(communityNotificationsTable)
    .where(and(
      eq(communityNotificationsTable.id, notificationId),
      eq(communityNotificationsTable.userId, userId),
    ));

  if (!notification) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }

  await db
    .update(communityNotificationsTable)
    .set({ isRead: true })
    .where(eq(communityNotificationsTable.id, notificationId));

  res.json({ success: true });
});

router.post("/community/notifications/read-all", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;
  const userId = req.userId!;

  await db
    .update(communityNotificationsTable)
    .set({ isRead: true })
    .where(and(
      eq(communityNotificationsTable.userId, userId),
      eq(communityNotificationsTable.isRead, false),
    ));

  res.json({ success: true });
});

export default router;
