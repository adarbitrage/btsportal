import {
  db,
  usersTable,
  communityPostsTable,
  communityReactionsTable,
  communityCommentsTable,
  communityNotificationsTable,
  communityCategoriesTable,
  winsTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

const SEED_EMAILS = ["marcus@example.com", "jake@example.com", "lisa@example.com"];

export async function purgeSeedCommunityPosts(): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;

  const seedUsers = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(inArray(usersTable.email, SEED_EMAILS));

  if (seedUsers.length === 0) {
    console.log("[SeedCleanup] No seed users found — skipping.");
    return;
  }

  const seedUserIds = seedUsers.map((u) => u.id);

  const seedPosts = await db
    .select({ id: communityPostsTable.id, categoryId: communityPostsTable.categoryId })
    .from(communityPostsTable)
    .where(inArray(communityPostsTable.authorId, seedUserIds));

  if (seedPosts.length === 0) {
    console.log("[SeedCleanup] No seed community posts found — already clean.");
    return;
  }

  const postIds = seedPosts.map((p) => p.id);
  console.log(`[SeedCleanup] Found ${postIds.length} seed posts (IDs: ${postIds.join(", ")}) — purging…`);

  await db.delete(communityReactionsTable).where(inArray(communityReactionsTable.postId, postIds));
  await db.delete(communityCommentsTable).where(inArray(communityCommentsTable.postId, postIds));
  await db.delete(communityNotificationsTable).where(inArray(communityNotificationsTable.postId, postIds));

  await db
    .update(winsTable)
    .set({ communityPostId: null })
    .where(inArray(winsTable.communityPostId, postIds));

  await db.delete(communityPostsTable).where(inArray(communityPostsTable.id, postIds));

  const categoryIds = [...new Set(seedPosts.map((p) => p.categoryId))];
  for (const catId of categoryIds) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(communityPostsTable)
      .where(eq(communityPostsTable.categoryId, catId));
    await db
      .update(communityCategoriesTable)
      .set({ postsCount: row?.count ?? 0 })
      .where(eq(communityCategoriesTable.id, catId));
  }

  console.log(`[SeedCleanup] Done — deleted ${postIds.length} seed posts and updated category counts.`);
}
