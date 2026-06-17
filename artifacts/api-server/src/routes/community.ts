import { getParam } from "../lib/params";
import { Router, type IRouter } from "express";
import {
  db, usersTable,
  communityPostsTable, communityCommentsTable, communityReactionsTable,
  communityCategoriesTable, communityBadgesTable, communityNotificationsTable,
  userProductsTable, productsTable,
} from "@workspace/db";
import { eq, and, desc, asc, sql, or, isNull, gte, ilike } from "drizzle-orm";
import { hasEntitlement, getHighestProductLabel, getUserEntitlements } from "../lib/entitlements";
import { isAdminRole, isCoachRole } from "../middleware/rbac";
import { requireNotBanned } from "../middleware/postingBan";
import { enqueueModerationJob } from "../lib/moderation/queue";
import {
  listPosts,
  parseCursor,
  getPostById,
  createPostInCategory,
  isMemberInGoodStanding,
  updatePost,
  softDeletePost,
  getRawPost,
  createComment,
  getRawComment,
  updateComment,
  softDeleteComment,
  toggleReaction,
  approvePost,
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
  if (!has && !(await getHasMemberBypass(userId))) {
    res.status(403).json({ error: "Community access required. Upgrade to a mentorship tier." });
    return false;
  }
  return true;
}

// Admins (member-feature support) and coaches (full member experience) bypass
// the community:access entitlement gate. Kept SEPARATE from getIsAdmin so that
// coaches do NOT inherit admin moderation powers — getIsAdmin stays admin-only.
async function getHasMemberBypass(userId: number): Promise<boolean> {
  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return !!user && (isAdminRole(user.role) || isCoachRole(user.role));
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

  const categorySlug = req.query.categorySlug as string | undefined;
  const { posts, nextCursor } = await listPosts({ userId, cursor, limit: limitParam, isAdmin, categorySlug });

  res.json({ posts, nextCursor });
});

router.post("/community/posts", requireNotBanned, async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;
  const userId = req.userId!;

  const { title, body, media_urls, categoryId } = req.body;

  if (!title || typeof title !== "string" || title.trim().length < 1 || title.length > 120) {
    res.status(400).json({ error: "Post title must be between 1 and 120 characters" });
    return;
  }

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

  // Publish-then-moderate for trusted authors: established members in good
  // standing (and admins) have their posts go live immediately and are then
  // moderated asynchronously. New/untrusted members keep the manual approval
  // gate (status="pending") and see a "pending review" indicator until an
  // admin approves their post.
  const trusted = (await getIsAdmin(userId)) || (await isMemberInGoodStanding(userId));
  const post = await createPostInCategory(
    userId,
    title.trim(),
    body,
    resolvedCategoryId,
    media_urls ?? [],
    trusted ? "active" : "pending",
  );

  enqueueModerationJob({
    targetType: "post",
    targetId: post.id,
    authorId: userId,
    body,
  });

  await db
    .update(communityCategoriesTable)
    .set({ postsCount: sql`${communityCategoriesTable.postsCount} + 1` })
    .where(eq(communityCategoriesTable.id, resolvedCategoryId));

  try {
    await checkAndAwardBadges(userId);
  } catch (badgeErr) {
    console.error("[community] checkAndAwardBadges failed (non-fatal):", badgeErr);
  }

  res.status(201).json({
    id: post.id,
    authorId: post.authorId,
    categoryId: post.categoryId,
    title: post.title,
    body: post.content,
    mediaUrls: post.mediaUrls,
    isPinned: post.isPinned,
    isFeatured: post.isFeatured,
    status: post.status,
    commentCount: post.commentCount,
    reactionCount: post.reactionCount,
    viewerHasReacted: false,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  });
});

router.get("/community/posts/:id", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;

  const userId = req.userId!;
  const postId = parseInt(getParam(req.params.id));
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
  const postId = parseInt(getParam(req.params.id));
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

  const { content: postContent } = req.body;
  if (!postContent || typeof postContent !== "string" || postContent.length < 1 || postContent.length > 5000) {
    res.status(400).json({ error: "Post body must be between 1 and 5000 characters" });
    return;
  }

  const updated = await updatePost(postId, postContent);
  if (!updated) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  res.json({
    id: updated.id,
    authorId: updated.authorId,
    title: updated.title,
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
  const postId = parseInt(getParam(req.params.id));
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
  const postId = parseInt(getParam(req.params.id));
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
  if (post.status === "pending" && !isAdmin && post.authorId !== userId) {
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

  const commentIdToAuthorName = new Map(comments.map(c => [c.id, c.authorName]));

  const normalizedComments = comments.map(c => ({
    id: c.id,
    postId: c.postId,
    author: {
      id: c.authorId,
      name: c.authorName ?? "Unknown",
      avatarUrl: null,
      highestProductSlug: null,
      badges: [],
    },
    body: c.body,
    parentCommentId: c.parentId ?? null,
    replyToName: c.parentId ? (commentIdToAuthorName.get(c.parentId) ?? null) : null,
    reactionCount: c.reactionCount,
    hasReacted: userReactions.has(c.id),
    isEdited: false,
    isDeleted: c.status === "deleted",
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));

  res.json(normalizedComments);
});

router.post("/community/posts/:id/comments", requireNotBanned, async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;
  const userId = req.userId!;
  const postId = parseInt(getParam(req.params.id));
  if (isNaN(postId)) {
    res.status(400).json({ error: "Invalid post id" });
    return;
  }

  const { content, parentId: rawParentId } = req.body;

  if (!content || typeof content !== "string" || content.length < 1 || content.length > 2000) {
    res.status(400).json({ error: "Comment body must be between 1 and 2000 characters" });
    return;
  }

  const parentId = rawParentId != null ? parseInt(String(rawParentId)) : null;
  if (parentId !== null && isNaN(parentId)) {
    res.status(400).json({ error: "Invalid parentId" });
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
  if (existing.status === "pending" && !commentingIsAdmin && existing.authorId !== userId) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  const comment = await createComment(postId, userId, content, parentId);

  enqueueModerationJob({
    targetType: "comment",
    targetId: comment.id,
    authorId: userId,
    body: content,
  });

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

  try {
    await checkAndAwardBadges(userId);
  } catch (badgeErr) {
    console.error("[community] checkAndAwardBadges failed (non-fatal):", badgeErr);
  }

  let replyToName: string | null = null;
  if (parentId) {
    const [parentComment] = await db
      .select({ authorName: usersTable.name })
      .from(communityCommentsTable)
      .innerJoin(usersTable, eq(communityCommentsTable.authorId, usersTable.id))
      .where(eq(communityCommentsTable.id, parentId))
      .limit(1);
    replyToName = parentComment?.authorName ?? null;
  }

  res.status(201).json({
    id: comment.id,
    postId: comment.postId,
    author: {
      id: comment.authorId,
      name: author?.name ?? "Unknown",
      avatarUrl: null,
      highestProductSlug: null,
      badges: [],
    },
    body: comment.content,
    parentCommentId: comment.parentId ?? null,
    replyToName,
    reactionCount: comment.reactionCount,
    hasReacted: false,
    isEdited: false,
    isDeleted: false,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  });
});

router.patch("/community/comments/:id", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;

  const userId = req.userId!;
  const commentId = parseInt(getParam(req.params.id));
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

  const { content: commentContent } = req.body;
  if (!commentContent || typeof commentContent !== "string" || commentContent.length < 1 || commentContent.length > 2000) {
    res.status(400).json({ error: "Comment body must be between 1 and 2000 characters" });
    return;
  }

  const updated = await updateComment(commentId, commentContent);
  if (!updated) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  const [updatedAuthor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, updated.authorId));

  res.json({
    id: updated.id,
    postId: updated.postId,
    author: {
      id: updated.authorId,
      name: updatedAuthor?.name ?? "Unknown",
      avatarUrl: null,
      highestProductSlug: null,
      badges: [],
    },
    body: updated.content,
    parentCommentId: updated.parentId ?? null,
    replyToName: null,
    reactionCount: updated.reactionCount,
    hasReacted: false,
    isEdited: true,
    isDeleted: false,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  });
});

router.delete("/community/comments/:id", async (req, res): Promise<void> => {
  if (!(await requireCommunityAccess(req, res))) return;

  const userId = req.userId!;
  const commentId = parseInt(getParam(req.params.id));
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
  const targetUserId = parseInt(getParam(req.params.userId));

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
  const notificationId = parseInt(getParam(req.params.id));

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
