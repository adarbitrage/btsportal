import {
  db,
  usersTable,
  communityPostsTable,
  communityCommentsTable,
  communityReactionsTable,
  communityCategoriesTable,
} from "@workspace/db";
import { eq, and, desc, asc, lt, or, sql } from "drizzle-orm";

export type PostStatus = "active" | "hidden" | "deleted";
export type CommentStatus = "active" | "hidden" | "deleted";
export type ReactionType = "like";
export type TargetType = "post" | "comment";

export interface FeedPost {
  id: number;
  authorId: number;
  authorName: string | null;
  authorAvatarUrl: string | null;
  title: string;
  body: string;
  mediaUrls: unknown;
  status: string;
  commentCount: number;
  reactionCount: number;
  viewerHasReacted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PostWithComments extends FeedPost {
  comments: FeedComment[];
}

export interface FeedComment {
  id: number;
  postId: number;
  authorId: number;
  authorName: string | null;
  authorAvatarUrl: string | null;
  body: string;
  status: string;
  reactionCount: number;
  viewerHasReacted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListPostsOptions {
  userId: number;
  cursor?: { createdAt: Date; id: number } | null;
  limit?: number;
  isAdmin?: boolean;
  categorySlug?: string;
}

export interface ToggleReactionResult {
  toggled: "added" | "removed";
  reactionCount: number;
}

export async function listPosts(opts: ListPostsOptions): Promise<{ posts: FeedPost[]; nextCursor: string | null }> {
  const { userId, cursor, limit = 20, isAdmin = false, categorySlug } = opts;
  const take = Math.min(Math.max(1, limit), 50);

  const statusCondition = isAdmin
    ? sql`${communityPostsTable.status} != 'deleted'`
    : sql`(${communityPostsTable.status} = 'active' OR (${communityPostsTable.status} = 'shadow_hidden' AND ${communityPostsTable.authorId} = ${userId}))`;

  const cursorCondition = cursor
    ? or(
        lt(communityPostsTable.createdAt, cursor.createdAt),
        and(
          eq(communityPostsTable.createdAt, cursor.createdAt),
          lt(communityPostsTable.id, cursor.id),
        ),
      )
    : undefined;

  let categoryCondition: ReturnType<typeof eq> | undefined;
  if (categorySlug) {
    const [cat] = await db
      .select({ id: communityCategoriesTable.id })
      .from(communityCategoriesTable)
      .where(eq(communityCategoriesTable.slug, categorySlug))
      .limit(1);
    if (cat) {
      categoryCondition = eq(communityPostsTable.categoryId, cat.id);
    }
  }

  const conditions = and(statusCondition, cursorCondition, categoryCondition);

  const rows = await db
    .select({
      id: communityPostsTable.id,
      authorId: communityPostsTable.authorId,
      authorName: usersTable.name,
      title: communityPostsTable.title,
      body: communityPostsTable.content,
      mediaUrls: communityPostsTable.mediaUrls,
      status: communityPostsTable.status,
      commentCount: communityPostsTable.commentCount,
      reactionCount: communityPostsTable.reactionCount,
      createdAt: communityPostsTable.createdAt,
      updatedAt: communityPostsTable.updatedAt,
    })
    .from(communityPostsTable)
    .innerJoin(usersTable, eq(communityPostsTable.authorId, usersTable.id))
    .where(conditions)
    .orderBy(desc(communityPostsTable.createdAt), desc(communityPostsTable.id))
    .limit(take);

  const postIds = rows.map((r) => r.id);
  let reactedSet = new Set<number>();
  if (postIds.length > 0) {
    const reactions = await db
      .select({ targetId: communityReactionsTable.targetId })
      .from(communityReactionsTable)
      .where(
        and(
          eq(communityReactionsTable.userId, userId),
          eq(communityReactionsTable.targetType, "post"),
          sql`${communityReactionsTable.targetId} = ANY(ARRAY[${sql.join(postIds.map((id) => sql`${id}::int`), sql`, `)}])`,
        ),
      );
    reactedSet = new Set(reactions.map((r) => r.targetId).filter(Boolean) as number[]);
  }

  const posts: FeedPost[] = rows.map((r) => ({
    ...r,
    authorAvatarUrl: null,
    viewerHasReacted: reactedSet.has(r.id),
  }));

  const lastRow = rows[rows.length - 1];
  const nextCursor =
    rows.length === take && lastRow
      ? Buffer.from(JSON.stringify({ createdAt: lastRow.createdAt, id: lastRow.id })).toString("base64")
      : null;

  return { posts, nextCursor };
}

export function parseCursor(raw: string): { createdAt: Date; id: number } | null {
  try {
    const decoded = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    if (!decoded.createdAt || !decoded.id) return null;
    return { createdAt: new Date(decoded.createdAt), id: Number(decoded.id) };
  } catch {
    return null;
  }
}

export async function getPostById(
  postId: number,
  userId: number,
  isAdmin: boolean,
): Promise<PostWithComments | null> {
  const [row] = await db
    .select({
      id: communityPostsTable.id,
      authorId: communityPostsTable.authorId,
      authorName: usersTable.name,
      title: communityPostsTable.title,
      body: communityPostsTable.content,
      mediaUrls: communityPostsTable.mediaUrls,
      status: communityPostsTable.status,
      commentCount: communityPostsTable.commentCount,
      reactionCount: communityPostsTable.reactionCount,
      createdAt: communityPostsTable.createdAt,
      updatedAt: communityPostsTable.updatedAt,
    })
    .from(communityPostsTable)
    .innerJoin(usersTable, eq(communityPostsTable.authorId, usersTable.id))
    .where(eq(communityPostsTable.id, postId))
    .limit(1);

  if (!row) return null;
  if (row.status === "deleted") return null;
  if (row.status === "hidden" && !isAdmin) return null;
  if (row.status === "shadow_hidden" && !isAdmin && row.authorId !== userId) return null;

  const [reaction] = await db
    .select({ id: communityReactionsTable.id })
    .from(communityReactionsTable)
    .where(
      and(
        eq(communityReactionsTable.userId, userId),
        eq(communityReactionsTable.targetType, "post"),
        eq(communityReactionsTable.targetId, postId),
        eq(communityReactionsTable.type, "like"),
      ),
    )
    .limit(1);

  const commentStatusCondition = isAdmin
    ? sql`${communityCommentsTable.status} != 'deleted'`
    : sql`(${communityCommentsTable.status} = 'active' OR (${communityCommentsTable.status} = 'shadow_hidden' AND ${communityCommentsTable.authorId} = ${userId}))`;

  const commentRows = await db
    .select({
      id: communityCommentsTable.id,
      postId: communityCommentsTable.postId,
      authorId: communityCommentsTable.authorId,
      authorName: usersTable.name,
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

  const commentIds = commentRows.map((c) => c.id);
  let commentReactedSet = new Set<number>();
  if (commentIds.length > 0) {
    const creactions = await db
      .select({ targetId: communityReactionsTable.targetId })
      .from(communityReactionsTable)
      .where(
        and(
          eq(communityReactionsTable.userId, userId),
          eq(communityReactionsTable.targetType, "comment"),
          sql`${communityReactionsTable.targetId} = ANY(ARRAY[${sql.join(commentIds.map((id) => sql`${id}::int`), sql`, `)}])`,
        ),
      );
    commentReactedSet = new Set(creactions.map((r) => r.targetId).filter(Boolean) as number[]);
  }

  const comments: FeedComment[] = commentRows.map((c) => ({
    ...c,
    authorAvatarUrl: null,
    viewerHasReacted: commentReactedSet.has(c.id),
  }));

  return {
    ...row,
    authorAvatarUrl: null,
    viewerHasReacted: !!reaction,
    comments,
  };
}

export async function createPostInCategory(
  userId: number,
  title: string,
  body: string,
  categoryId: number,
  mediaUrls: string[] = [],
): Promise<typeof communityPostsTable.$inferSelect> {
  const [post] = await db
    .insert(communityPostsTable)
    .values({
      authorId: userId,
      categoryId,
      title,
      content: body,
      mediaUrls,
      status: "active",
    })
    .returning();
  return post;
}

export async function updatePost(
  postId: number,
  body: string,
): Promise<typeof communityPostsTable.$inferSelect | null> {
  const [updated] = await db
    .update(communityPostsTable)
    .set({ content: body })
    .where(eq(communityPostsTable.id, postId))
    .returning();
  return updated ?? null;
}

export async function softDeletePost(postId: number, deletedBy: string): Promise<void> {
  await db
    .update(communityPostsTable)
    .set({ status: "deleted", isDeleted: true, deletedBy })
    .where(eq(communityPostsTable.id, postId));
}

export async function setPostStatus(postId: number, status: PostStatus): Promise<void> {
  await db
    .update(communityPostsTable)
    .set({ status })
    .where(eq(communityPostsTable.id, postId));
}

export async function getRawPost(postId: number): Promise<typeof communityPostsTable.$inferSelect | null> {
  const [post] = await db
    .select()
    .from(communityPostsTable)
    .where(eq(communityPostsTable.id, postId))
    .limit(1);
  return post ?? null;
}

export async function createComment(
  postId: number,
  userId: number,
  body: string,
): Promise<typeof communityCommentsTable.$inferSelect> {
  const [comment] = await db
    .insert(communityCommentsTable)
    .values({
      postId,
      authorId: userId,
      content: body,
      status: "active",
    })
    .returning();

  await db
    .update(communityPostsTable)
    .set({ commentCount: sql`${communityPostsTable.commentCount} + 1` })
    .where(eq(communityPostsTable.id, postId));

  return comment;
}

export async function getRawComment(commentId: number): Promise<typeof communityCommentsTable.$inferSelect | null> {
  const [comment] = await db
    .select()
    .from(communityCommentsTable)
    .where(eq(communityCommentsTable.id, commentId))
    .limit(1);
  return comment ?? null;
}

export async function updateComment(
  commentId: number,
  body: string,
): Promise<typeof communityCommentsTable.$inferSelect | null> {
  const [updated] = await db
    .update(communityCommentsTable)
    .set({ content: body })
    .where(eq(communityCommentsTable.id, commentId))
    .returning();
  return updated ?? null;
}

export async function softDeleteComment(commentId: number, postId: number, deletedBy: string): Promise<void> {
  await db
    .update(communityCommentsTable)
    .set({ status: "deleted", isDeleted: true, deletedBy })
    .where(eq(communityCommentsTable.id, commentId));

  await db
    .update(communityPostsTable)
    .set({ commentCount: sql`GREATEST(${communityPostsTable.commentCount} - 1, 0)` })
    .where(eq(communityPostsTable.id, postId));
}

export async function setCommentStatus(commentId: number, status: CommentStatus): Promise<void> {
  await db
    .update(communityCommentsTable)
    .set({ status })
    .where(eq(communityCommentsTable.id, commentId));
}

export async function toggleReaction(
  userId: number,
  targetType: TargetType,
  targetId: number,
  type: ReactionType = "like",
): Promise<ToggleReactionResult> {
  const [existing] = await db
    .select({ id: communityReactionsTable.id })
    .from(communityReactionsTable)
    .where(
      and(
        eq(communityReactionsTable.userId, userId),
        eq(communityReactionsTable.targetType, targetType),
        eq(communityReactionsTable.targetId, targetId),
        eq(communityReactionsTable.type, type),
      ),
    )
    .limit(1);

  if (existing) {
    await db.delete(communityReactionsTable).where(eq(communityReactionsTable.id, existing.id));

    if (targetType === "post") {
      await db
        .update(communityPostsTable)
        .set({ reactionCount: sql`GREATEST(${communityPostsTable.reactionCount} - 1, 0)` })
        .where(eq(communityPostsTable.id, targetId));
      const [updated] = await db
        .select({ reactionCount: communityPostsTable.reactionCount })
        .from(communityPostsTable)
        .where(eq(communityPostsTable.id, targetId));
      return { toggled: "removed", reactionCount: updated?.reactionCount ?? 0 };
    } else {
      await db
        .update(communityCommentsTable)
        .set({ reactionCount: sql`GREATEST(${communityCommentsTable.reactionCount} - 1, 0)` })
        .where(eq(communityCommentsTable.id, targetId));
      const [updated] = await db
        .select({ reactionCount: communityCommentsTable.reactionCount })
        .from(communityCommentsTable)
        .where(eq(communityCommentsTable.id, targetId));
      return { toggled: "removed", reactionCount: updated?.reactionCount ?? 0 };
    }
  } else {
    const insertValues: {
      userId: number;
      targetType: string;
      targetId: number;
      type: string;
      postId?: number;
      commentId?: number;
    } = {
      userId,
      targetType,
      targetId,
      type,
    };

    if (targetType === "post") {
      insertValues.postId = targetId;
    } else {
      insertValues.commentId = targetId;
    }

    await db.insert(communityReactionsTable).values(insertValues);

    if (targetType === "post") {
      await db
        .update(communityPostsTable)
        .set({ reactionCount: sql`${communityPostsTable.reactionCount} + 1` })
        .where(eq(communityPostsTable.id, targetId));
      const [updated] = await db
        .select({ reactionCount: communityPostsTable.reactionCount })
        .from(communityPostsTable)
        .where(eq(communityPostsTable.id, targetId));
      return { toggled: "added", reactionCount: updated?.reactionCount ?? 0 };
    } else {
      await db
        .update(communityCommentsTable)
        .set({ reactionCount: sql`${communityCommentsTable.reactionCount} + 1` })
        .where(eq(communityCommentsTable.id, targetId));
      const [updated] = await db
        .select({ reactionCount: communityCommentsTable.reactionCount })
        .from(communityCommentsTable)
        .where(eq(communityCommentsTable.id, targetId));
      return { toggled: "added", reactionCount: updated?.reactionCount ?? 0 };
    }
  }
}
