import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  communityCategoriesTable,
  communityPostsTable,
  communityCommentsTable,
  communityBadgesTable,
  communityNotificationsTable,
  moderationQueueTable,
  moderationWordlistTable,
} from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import communityRouter from "../routes/community";
import { pendingModerationJobs } from "../lib/moderation/queue";
import { invalidateWordlistCache } from "../lib/moderation/wordlist";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `bg-mod-${randomUUID().slice(0, 8)}`;
// Use a unique non-English word so it cannot collide with real wordlist
// entries or anything a real user might post.
const HARD_TRIGGER = `zqxwflagword${randomUUID().slice(0, 6).replace(/-/g, "")}`;

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
const seededCategoryIds: number[] = [];
const seededPostIds: number[] = [];
const seededCommentIds: number[] = [];
const seededWordlistIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let memberId: number;
let memberCookie: string;
let categoryId: number;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([communityRouter]);

  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const email = `${TEST_TAG}-member@example.test`;
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      name: "BG Mod Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  memberId = user.id;
  seededUserIds.push(memberId);
  memberCookie = signCookie(memberId, email);

  const [product] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-product`,
      name: "BG Mod Test Product",
      type: "backend",
      entitlementKeys: ["community:access"] as unknown as string[],
      sortOrder: 99,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(product.id);

  await db.insert(userProductsTable).values({
    userId: memberId,
    productId: product.id,
    status: "active",
  });

  const [category] = await db
    .insert(communityCategoriesTable)
    .values({
      name: `${TEST_TAG}-cat`,
      slug: `${TEST_TAG}-cat`,
      sortOrder: 999,
      isActive: true,
    })
    .returning({ id: communityCategoriesTable.id });
  categoryId = category.id;
  seededCategoryIds.push(categoryId);

  const [wordRow] = await db
    .insert(moderationWordlistTable)
    .values({
      word: HARD_TRIGGER,
      category: "test",
      severity: "HARD",
    })
    .returning({ id: moderationWordlistTable.id });
  seededWordlistIds.push(wordRow.id);

  // Engine caches the wordlist for 60s; force a refresh so the seeded HARD
  // entry is visible to this test run.
  invalidateWordlistCache();
});

afterAll(async () => {
  if (seededCommentIds.length > 0) {
    await db.delete(moderationQueueTable).where(
      and(
        eq(moderationQueueTable.targetType, "comment"),
        inArray(moderationQueueTable.targetId, seededCommentIds),
      ),
    );
    await db.delete(communityCommentsTable).where(inArray(communityCommentsTable.id, seededCommentIds));
  }
  if (seededPostIds.length > 0) {
    await db.delete(moderationQueueTable).where(
      and(
        eq(moderationQueueTable.targetType, "post"),
        inArray(moderationQueueTable.targetId, seededPostIds),
      ),
    );
    await db.delete(communityPostsTable).where(inArray(communityPostsTable.id, seededPostIds));
  }
  if (seededCategoryIds.length > 0) {
    await db.delete(communityCategoriesTable).where(inArray(communityCategoriesTable.id, seededCategoryIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(communityBadgesTable).where(inArray(communityBadgesTable.userId, seededUserIds));
    await db.delete(communityNotificationsTable).where(inArray(communityNotificationsTable.userId, seededUserIds));
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
  }
  if (seededProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, seededProductIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  if (seededWordlistIds.length > 0) {
    await db.delete(moderationWordlistTable).where(inArray(moderationWordlistTable.id, seededWordlistIds));
  }
  invalidateWordlistCache();
});

describe("background moderation flow on community create endpoints", () => {
  it("returns active immediately, then shadow-hides flagged posts and enqueues a moderation_queue row", async () => {
    const res = await request(app)
      .post("/api/community/posts")
      .set("Cookie", memberCookie)
      .send({ body: `hello ${HARD_TRIGGER} world`, categoryId });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("active");
    const postId: number = res.body.id;
    seededPostIds.push(postId);

    await pendingModerationJobs();

    const [post] = await db
      .select()
      .from(communityPostsTable)
      .where(eq(communityPostsTable.id, postId));
    expect(post.status).toBe("shadow_hidden");

    const queueRows = await db
      .select()
      .from(moderationQueueTable)
      .where(
        and(
          eq(moderationQueueTable.targetType, "post"),
          eq(moderationQueueTable.targetId, postId),
        ),
      );
    expect(queueRows).toHaveLength(1);
    expect(queueRows[0].triggeredBy).toBe("wordlist_hard");
    expect(queueRows[0].authorId).toBe(memberId);
  });

  it("returns active immediately, then shadow-hides flagged comments and enqueues a moderation_queue row", async () => {
    // Seed a clean parent post so the comment route is reachable.
    const postRes = await request(app)
      .post("/api/community/posts")
      .set("Cookie", memberCookie)
      .send({ body: "clean parent post for comment moderation test", categoryId });
    expect(postRes.status).toBe(201);
    const parentPostId: number = postRes.body.id;
    seededPostIds.push(parentPostId);
    await pendingModerationJobs();

    const res = await request(app)
      .post(`/api/community/posts/${parentPostId}/comments`)
      .set("Cookie", memberCookie)
      .send({ body: `flagged ${HARD_TRIGGER} comment` });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("active");
    const commentId: number = res.body.id;
    seededCommentIds.push(commentId);

    await pendingModerationJobs();

    const [comment] = await db
      .select()
      .from(communityCommentsTable)
      .where(eq(communityCommentsTable.id, commentId));
    expect(comment.status).toBe("shadow_hidden");

    const queueRows = await db
      .select()
      .from(moderationQueueTable)
      .where(
        and(
          eq(moderationQueueTable.targetType, "comment"),
          eq(moderationQueueTable.targetId, commentId),
        ),
      );
    expect(queueRows).toHaveLength(1);
    expect(queueRows[0].triggeredBy).toBe("wordlist_hard");
    expect(queueRows[0].authorId).toBe(memberId);
  });

  it("leaves clean posts and comments active and does not create any moderation_queue rows", async () => {
    const postRes = await request(app)
      .post("/api/community/posts")
      .set("Cookie", memberCookie)
      .send({ body: "a totally benign post about affiliate marketing best practices", categoryId });
    expect(postRes.status).toBe(201);
    expect(postRes.body.status).toBe("active");
    const postId: number = postRes.body.id;
    seededPostIds.push(postId);

    const commentRes = await request(app)
      .post(`/api/community/posts/${postId}/comments`)
      .set("Cookie", memberCookie)
      .send({ body: "thanks, this was a helpful and clean comment" });
    expect(commentRes.status).toBe(201);
    expect(commentRes.body.status).toBe("active");
    const commentId: number = commentRes.body.id;
    seededCommentIds.push(commentId);

    await pendingModerationJobs();

    const [post] = await db
      .select()
      .from(communityPostsTable)
      .where(eq(communityPostsTable.id, postId));
    expect(post.status).toBe("active");

    const [comment] = await db
      .select()
      .from(communityCommentsTable)
      .where(eq(communityCommentsTable.id, commentId));
    expect(comment.status).toBe("active");

    const postQueueRows = await db
      .select()
      .from(moderationQueueTable)
      .where(
        and(
          eq(moderationQueueTable.targetType, "post"),
          eq(moderationQueueTable.targetId, postId),
        ),
      );
    expect(postQueueRows).toHaveLength(0);

    const commentQueueRows = await db
      .select()
      .from(moderationQueueTable)
      .where(
        and(
          eq(moderationQueueTable.targetType, "comment"),
          eq(moderationQueueTable.targetId, commentId),
        ),
      );
    expect(commentQueueRows).toHaveLength(0);
  });
});
