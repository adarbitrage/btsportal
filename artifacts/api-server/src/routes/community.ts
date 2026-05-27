import { Router, type IRouter } from "express";
import {
  db, usersTable,
  communityPostsTable, communityCommentsTable, communityReactionsTable,
  communityCategoriesTable, communityBadgesTable, communityNotificationsTable,
  userProductsTable, productsTable, moderationQueueTable,
} from "@workspace/db";
import { eq, and, desc, asc, sql, or, isNull, gte, ilike } from "drizzle-orm";
import { hasEntitlement, getHighestProductLabel, getUserEntitlements } from "../lib/entitlements";
import { isAdminRole } from "../middleware/rbac";
import { requireNotBanned } from "../middleware/postingBan";
import { evaluate } from "../lib/moderation/engine";
import {
  listPosts,
  parseCursor,
  getPostById,
  createPostInCategory,
  updatePost,
  softDeletePost,
  getRawPost,
  createComment,
  getRawComment,
  updateComment,
  softDeleteComment,
  toggleReaction,
} from "../storage/community";

const router: IRouter = Router();

const EDIT_WINDOW_MS = 30 * 60 * 1000;

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

async function getIsAdmin(userId: number): Promise<boolean> {
  const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return !!(user && isAdminRole(user.role));
}

async function checkAndAwardBadges(userId: number) {
  const postCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communityPostsTable)
    .where(and(eq(communityPostsTable.authorId, userId), eq(communityPostsTable.status, "active")));
  const totalPosts = postCountResult[0]?.count ?? 0;

  const commentCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communityCommentsTable)
    .where(and(eq(communityCommentsTable.authorId, userId), eq(communityCommentsTable.status, "active")));
  const totalComments = commentCountResult[0]?.count ?? 0;

  const badgesToAward: string[] = [];

  if (totalPosts === 1 && totalComments === 0) {
    badgesToAward.push("newcomer");
  }

  if (totalPosts >= 10 || totalComments >= 20) {
    badgesToAward.push("contributor");
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

  const userId = req.userId!;
  const isAdmin = await getIsAdmin(userId);
  const limitParam = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
  const rawCursor = req.query.cursor as string | undefined;
  const cursor = rawCursor ? parseCursor(rawCursor) : null;

  const { posts, nextCursor } = await listPosts({ userId, cursor, limit: limitParam, isAdmin });

  res.json({ posts, nextCursor });
});

router.post("/community/posts", requireNotBanned, async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;
  const userId = req.userId!;

  const { body, media_urls, categoryId } = req.body;

  if (!body || typeof body !== "string" || body.length < 1 || body.length > 5000) {
    res.status(400).json({ error: "Post body must be between 1 and 5000 characters" });
    return;
  }

  if (media_urls !== undefined) {
    if (!Array.isArray(media_urls)) {
      res.status(400).json({ error: "media_urls must be an array" });
      return;
    }
    for (const url of media_urls) {
      if (typeof url !== "string") {
        res.status(400).json({ error: "media_urls must be an array of strings" });
        return;
      }
    }
  }

  const resolvedCategoryId = categoryId ?? 1;

  const [category] = await db
    .select()
    .from(communityCategoriesTable)
    .where(and(eq(communityCategoriesTable.id, resolvedCategoryId), eq(communityCategoriesTable.isActive, true)));
  if (!category) {
    res.status(400).json({ error: "Invalid or inactive category" });
    return;
  }

  const post = await createPostInCategory(userId, body, resolvedCategoryId, media_urls ?? []);

  let postEvalResult;
  try {
    postEvalResult = await evaluate({ body, targetType: "post", authorId: userId });
  } catch (err) {
    console.error("[Moderation] Engine error on post create, failing open:", err);
  }

  if (postEvalResult?.flagged) {
    await db
      .update(communityPostsTable)
      .set({ status: "shadow_hidden" })
      .where(eq(communityPostsTable.id, post.id));
    post.status = "shadow_hidden";

    await db.insert(moderationQueueTable).values({
      targetType: "post",
      targetId: post.id,
      authorId: userId,
      body,
      triggeredBy: postEvalResult.triggeredBy,
      wordlistMatches: postEvalResult.wordlistMatches,
      aiScores: postEvalResult.aiScores,
    });
  }

  await db
    .update(communityCategoriesTable)
    .set({ postsCount: sql`${communityCategoriesTable.postsCount} + 1` })
    .where(eq(communityCategoriesTable.id, resolvedCategoryId));

  await checkAndAwardBadges(userId);

  res.status(201).json({
    id: post.id,
    authorId: post.authorId,
    body: post.content,
    mediaUrls: post.mediaUrls,
    status: post.status,
    commentCount: post.commentCount,
    reactionCount: post.reactionCount,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  });
});

router.get("/community/posts/:id", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;

  const userId = req.userId!;
  const postId = parseInt(req.params.id);
  if (isNaN(postId)) {
    res.status(400).json({ error: "Invalid post id" });
    return;
  }

  const isAdmin = await getIsAdmin(userId);
  const post = await getPostById(postId, userId, isAdmin);

  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  res.json(post);
});

router.patch("/community/posts/:id", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;

  const userId = req.userId!;
  const postId = parseInt(req.params.id);
  if (isNaN(postId)) {
    res.status(400).json({ error: "Invalid post id" });
    return;
  }

  const existing = await getRawPost(postId);

  if (!existing || existing.status === "deleted") {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  if (existing.status === "hidden") {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  const isAdmin = await getIsAdmin(userId);

  if (existing.authorId !== userId && !isAdmin) {
    res.status(403).json({ error: "You can only edit your own posts" });
    return;
  }

  if (!isAdmin && existing.authorId === userId) {
    const elapsed = Date.now() - existing.createdAt.getTime();
    if (elapsed > EDIT_WINDOW_MS) {
      res.status(403).json({ error: "Posts can only be edited within 30 minutes of creation" });
      return;
    }
  }

  const { body } = req.body;
  if (!body || typeof body !== "string" || body.length < 1 || body.length > 5000) {
    res.status(400).json({ error: "Post body must be between 1 and 5000 characters" });
    return;
  }

  const updated = await updatePost(postId, body);
  if (!updated) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  res.json({
    id: updated.id,
    authorId: updated.authorId,
    body: updated.content,
    mediaUrls: updated.mediaUrls,
    status: updated.status,
    commentCount: updated.commentCount,
    reactionCount: updated.reactionCount,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  });
});

router.delete("/community/posts/:id", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;

  const userId = req.userId!;
  const postId = parseInt(req.params.id);
  if (isNaN(postId)) {
    res.status(400).json({ error: "Invalid post id" });
    return;
  }

  const existing = await getRawPost(postId);

  if (!existing || existing.status === "deleted") {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  const isAdmin = await getIsAdmin(userId);

  if (existing.authorId !== userId && !isAdmin) {
    res.status(403).json({ error: "You can only delete your own posts" });
    return;
  }

  const deletedBy = isAdmin && existing.authorId !== userId ? "admin" : "author";
  await softDeletePost(postId, deletedBy);

  res.json({ success: true });
});

router.get("/community/posts/:id/comments", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;
  const postId = parseInt(req.params.id);
  const userId = req.userId!;

  const post = await getRawPost(postId);
  const isAdmin = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId)).limit(1).then(rows => rows[0] && isAdminRole(rows[0].role));
  if (!post || post.status === "deleted" || (post.status === "hidden" && !isAdmin)) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  if (post.status === "shadow_hidden" && !isAdmin && post.authorId !== userId) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  const commentStatusCondition = isAdmin
    ? sql`${communityCommentsTable.status} != 'deleted'`
    : sql`(${communityCommentsTable.status} = 'active' OR (${communityCommentsTable.status} = 'shadow_hidden' AND ${communityCommentsTable.authorId} = ${userId}))`;

  const comments = await db
    .select({
      id: communityCommentsTable.id,
      postId: communityCommentsTable.postId,
      authorId: communityCommentsTable.authorId,
      authorName: usersTable.name,
      parentId: communityCommentsTable.parentId,
      body: communityCommentsTable.content,
      status: communityCommentsTable.status,
      reactionCount: communityCommentsTable.reactionCount,
      createdAt: communityCommentsTable.createdAt,
      updatedAt: communityCommentsTable.updatedAt,
    })
    .from(communityCommentsTable)
    .innerJoin(usersTable, eq(communityCommentsTable.authorId, usersTable.id))
    .where(and(eq(communityCommentsTable.postId, postId), commentStatusCondition))
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
    viewerHasReacted: userReactions.has(c.id),
  }));

  res.json(commentsWithReacted);
});

router.post("/community/posts/:id/comments", requireNotBanned, async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;
  const userId = req.userId!;
  const postId = parseInt(req.params.id);
  if (isNaN(postId)) {
    res.status(400).json({ error: "Invalid post id" });
    return;
  }

  const { body } = req.body;

  if (!body || typeof body !== "string" || body.length < 1 || body.length > 2000) {
    res.status(400).json({ error: "Comment body must be between 1 and 2000 characters" });
    return;
  }

  const existing = await getRawPost(postId);
  if (!existing || existing.status === "deleted") {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  if (existing.status === "hidden") {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  const commentingIsAdmin = await getIsAdmin(userId);
  if (existing.status === "shadow_hidden" && !commentingIsAdmin && existing.authorId !== userId) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  const comment = await createComment(postId, userId, body);

  let commentEvalResult;
  try {
    commentEvalResult = await evaluate({ body, targetType: "comment", authorId: userId });
  } catch (err) {
    console.error("[Moderation] Engine error on comment create, failing open:", err);
  }

  if (commentEvalResult?.flagged) {
    await db
      .update(communityCommentsTable)
      .set({ status: "shadow_hidden" })
      .where(eq(communityCommentsTable.id, comment.id));
    comment.status = "shadow_hidden";

    await db.insert(moderationQueueTable).values({
      targetType: "comment",
      targetId: comment.id,
      authorId: userId,
      body,
      triggeredBy: commentEvalResult.triggeredBy,
      wordlistMatches: commentEvalResult.wordlistMatches,
      aiScores: commentEvalResult.aiScores,
    });
  }

  const [author] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));

  if (existing.authorId !== userId) {
    await createNotification({
      userId: existing.authorId,
      actorId: userId,
      type: "comment",
      postId: existing.id,
      commentId: comment.id,
      message: `${author?.name ?? "Someone"} commented on your post`,
    });
  }

  await checkAndAwardBadges(userId);

  res.status(201).json({
    id: comment.id,
    postId: comment.postId,
    authorId: comment.authorId,
    body: comment.content,
    status: comment.status,
    reactionCount: comment.reactionCount,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  });
});

router.patch("/community/comments/:id", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;

  const userId = req.userId!;
  const commentId = parseInt(req.params.id);
  if (isNaN(commentId)) {
    res.status(400).json({ error: "Invalid comment id" });
    return;
  }

  const existing = await getRawComment(commentId);

  if (!existing || existing.status === "deleted") {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  if (existing.status === "hidden") {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  const isAdmin = await getIsAdmin(userId);

  if (existing.authorId !== userId && !isAdmin) {
    res.status(403).json({ error: "You can only edit your own comments" });
    return;
  }

  if (!isAdmin && existing.authorId === userId) {
    const elapsed = Date.now() - existing.createdAt.getTime();
    if (elapsed > EDIT_WINDOW_MS) {
      res.status(403).json({ error: "Comments can only be edited within 30 minutes of creation" });
      return;
    }
  }

  const { body } = req.body;
  if (!body || typeof body !== "string" || body.length < 1 || body.length > 2000) {
    res.status(400).json({ error: "Comment body must be between 1 and 2000 characters" });
    return;
  }

  const updated = await updateComment(commentId, body);
  if (!updated) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  res.json({
    id: updated.id,
    postId: updated.postId,
    authorId: updated.authorId,
    body: updated.content,
    status: updated.status,
    reactionCount: updated.reactionCount,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  });
});

router.delete("/community/comments/:id", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;

  const userId = req.userId!;
  const commentId = parseInt(req.params.id);
  if (isNaN(commentId)) {
    res.status(400).json({ error: "Invalid comment id" });
    return;
  }

  const existing = await getRawComment(commentId);

  if (!existing || existing.status === "deleted") {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  const isAdmin = await getIsAdmin(userId);

  if (existing.authorId !== userId && !isAdmin) {
    res.status(403).json({ error: "You can only delete your own comments" });
    return;
  }

  const deletedBy = isAdmin && existing.authorId !== userId ? "admin" : "author";
  await softDeleteComment(commentId, existing.postId, deletedBy);

  res.json({ success: true });
});

router.post("/community/reactions", requireNotBanned, async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;
  const userId = req.userId!;

  const { target_type, target_id, type } = req.body;

  if (!target_type || !["post", "comment"].includes(target_type)) {
    res.status(400).json({ error: "target_type must be 'post' or 'comment'" });
    return;
  }
  if (!target_id || typeof target_id !== "number") {
    res.status(400).json({ error: "target_id must be a number" });
    return;
  }
  if (type !== undefined && type !== "like") {
    res.status(400).json({ error: "type must be 'like'" });
    return;
  }

  const [userRow] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const userIsAdmin = userRow && isAdminRole(userRow.role);

  if (target_type === "post") {
    const post = await getRawPost(target_id);
    if (!post || post.status === "deleted" || post.status === "hidden") {
      res.status(404).json({ error: "Post not found" });
      return;
    }
    if (post.status === "shadow_hidden" && !userIsAdmin && post.authorId !== userId) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
  } else {
    const comment = await getRawComment(target_id);
    if (!comment || comment.status === "deleted" || comment.status === "hidden") {
      res.status(404).json({ error: "Comment not found" });
      return;
    }
    if (comment.status === "shadow_hidden" && !userIsAdmin && comment.authorId !== userId) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }
    const parentPost = await getRawPost(comment.postId);
    if (
      !parentPost ||
      parentPost.status === "deleted" ||
      (parentPost.status === "hidden" && !userIsAdmin) ||
      (parentPost.status === "shadow_hidden" && !userIsAdmin && parentPost.authorId !== userId)
    ) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
  }

  const result = await toggleReaction(userId, target_type, target_id, "like");
  res.json(result);
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
    .where(and(eq(communityPostsTable.authorId, targetUserId), eq(communityPostsTable.status, "active")));

  const commentCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communityCommentsTable)
    .where(and(eq(communityCommentsTable.authorId, targetUserId), eq(communityCommentsTable.status, "active")));

  const reactionCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communityReactionsTable)
    .where(eq(communityReactionsTable.userId, targetUserId));

  const recentPosts = await db
    .select({
      id: communityPostsTable.id,
      body: communityPostsTable.content,
      categoryName: communityCategoriesTable.name,
      commentCount: communityPostsTable.commentCount,
      reactionCount: communityPostsTable.reactionCount,
      createdAt: communityPostsTable.createdAt,
    })
    .from(communityPostsTable)
    .innerJoin(communityCategoriesTable, eq(communityPostsTable.categoryId, communityCategoriesTable.id))
    .where(and(eq(communityPostsTable.authorId, targetUserId), eq(communityPostsTable.status, "active")))
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
