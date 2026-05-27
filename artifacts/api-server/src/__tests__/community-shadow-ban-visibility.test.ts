import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
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
  communityReactionsTable,
  communityBadgesTable,
  communityNotificationsTable,
  moderationQueueTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const evaluateMock = vi.fn();

vi.mock("../lib/moderation/engine", () => ({
  evaluate: (...args: unknown[]) => evaluateMock(...args),
}));

import { buildTestAppWithRouters } from "./test-app";
import communityRouter from "../routes/community";
import { pendingModerationJobs } from "../lib/moderation/queue";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `shadow-ban-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
let categoryId: number;

interface Fixture {
  id: number;
  email: string;
  cookie: string;
}

let author: Fixture;
let otherMember: Fixture;
let admin: Fixture;
let bannedUser: Fixture;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function makeUser(opts: {
  suffix: string;
  role?: string;
  banned?: boolean;
}): Promise<Fixture> {
  const email = `${TEST_TAG}-${opts.suffix}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `User ${opts.suffix}`,
      passwordHash,
      role: opts.role ?? "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
      postingBannedAt: opts.banned ? new Date() : null,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededUserIds.push(row.id);
  return { id: row.id, email: row.email, cookie: signCookie(row.id, row.email) };
}

async function grantCommunityAccess(userId: number, productSuffix: string) {
  const [product] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-prod-${productSuffix}`,
      name: `${TEST_TAG} community product ${productSuffix}`,
      type: "backend",
      entitlementKeys: ["community:access"] as unknown as string[],
      sortOrder: 99,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(product.id);
  await db.insert(userProductsTable).values({
    userId,
    productId: product.id,
    status: "active",
  });
}

const NOT_FLAGGED = {
  flagged: false,
  triggeredBy: "none",
  wordlistMatches: [],
  aiScores: { toxicity: 0, spam: 0, harassment: 0, hate_speech: 0 },
};

const FLAGGED = {
  flagged: true,
  triggeredBy: "wordlist_hard",
  wordlistMatches: [{ word: "badword", category: "abuse", severity: "HARD" as const }],
  aiScores: { toxicity: 0, spam: 0, harassment: 0, hate_speech: 0 },
};

async function getPostStatus(id: number): Promise<string | undefined> {
  const [row] = await db
    .select({ status: communityPostsTable.status })
    .from(communityPostsTable)
    .where(eq(communityPostsTable.id, id));
  return row?.status;
}

async function getCommentStatus(id: number): Promise<string | undefined> {
  const [row] = await db
    .select({ status: communityCommentsTable.status })
    .from(communityCommentsTable)
    .where(eq(communityCommentsTable.id, id));
  return row?.status;
}

async function getQueueRowsForTarget(
  targetType: "post" | "comment",
  targetId: number,
) {
  return db
    .select()
    .from(moderationQueueTable)
    .where(
      eq(moderationQueueTable.targetId, targetId),
    )
    .then((rows) => rows.filter((r) => r.targetType === targetType));
}

beforeAll(async () => {
  app = buildTestAppWithRouters([communityRouter]);

  const [cat] = await db
    .insert(communityCategoriesTable)
    .values({
      name: `${TEST_TAG} Category`,
      slug: `${TEST_TAG}-cat`,
      description: "test",
      sortOrder: 1,
      isActive: true,
    })
    .returning({ id: communityCategoriesTable.id });
  categoryId = cat.id;

  author = await makeUser({ suffix: "author" });
  otherMember = await makeUser({ suffix: "other" });
  admin = await makeUser({ suffix: "admin", role: "super_admin" });
  bannedUser = await makeUser({ suffix: "banned", banned: true });

  await grantCommunityAccess(author.id, "author");
  await grantCommunityAccess(otherMember.id, "other");
  await grantCommunityAccess(admin.id, "admin");
  await grantCommunityAccess(bannedUser.id, "banned");
});

afterAll(async () => {
  await pendingModerationJobs();
  if (seededUserIds.length > 0) {
    await db.delete(communityReactionsTable).where(inArray(communityReactionsTable.userId, seededUserIds));
    await db.delete(communityNotificationsTable).where(inArray(communityNotificationsTable.userId, seededUserIds));
    await db.delete(communityBadgesTable).where(inArray(communityBadgesTable.userId, seededUserIds));
    await db.delete(moderationQueueTable).where(inArray(moderationQueueTable.authorId, seededUserIds));
    await db.delete(communityCommentsTable).where(inArray(communityCommentsTable.authorId, seededUserIds));
    await db.delete(communityPostsTable).where(inArray(communityPostsTable.authorId, seededUserIds));
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  if (seededProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, seededProductIds));
  }
  if (categoryId) {
    await db.delete(communityCategoriesTable).where(eq(communityCategoriesTable.id, categoryId));
  }
});

beforeEach(() => {
  evaluateMock.mockReset();
  evaluateMock.mockResolvedValue(NOT_FLAGGED);
});

async function createPostAs(actor: Fixture, body = "hello world") {
  const res = await request(app)
    .post("/api/community/posts")
    .set("Cookie", actor.cookie)
    .send({ title: body.slice(0, 100), body, categoryId });
  return res;
}

async function createCommentAs(actor: Fixture, postId: number, body = "nice post") {
  const res = await request(app)
    .post(`/api/community/posts/${postId}/comments`)
    .set("Cookie", actor.cookie)
    .send({ body });
  return res;
}

/**
 * Moderation runs asynchronously via setImmediate in
 * artifacts/api-server/src/lib/moderation/queue.ts — create responses return
 * the pre-moderation row (status: "active") and the engine updates it later.
 * Tests must await this drain before asserting on the final post/comment
 * state or on moderation_queue rows.
 */
async function drainModeration() {
  await pendingModerationJobs();
}

describe("Community shadow-ban moderation wiring", () => {
  describe("post creation flagging", () => {
    it("flagged post ends at status=shadow_hidden and inserts a moderation_queue row after moderation drains", async () => {
      evaluateMock.mockResolvedValueOnce(FLAGGED);

      const res = await createPostAs(author, "this should be flagged");
      expect(res.status).toBe(201);
      // Pre-moderation create response returns "active" — moderation runs async.
      expect(res.body.status).toBe("active");

      await drainModeration();

      expect(await getPostStatus(res.body.id)).toBe("shadow_hidden");

      const queueRows = await getQueueRowsForTarget("post", res.body.id);
      expect(queueRows).toHaveLength(1);
      expect(queueRows[0].authorId).toBe(author.id);
      expect(queueRows[0].triggeredBy).toBe("wordlist_hard");
    });

    it("non-flagged post stays active and creates no queue row", async () => {
      const res = await createPostAs(author, "totally fine post");
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("active");

      await drainModeration();

      expect(await getPostStatus(res.body.id)).toBe("active");
      expect(await getQueueRowsForTarget("post", res.body.id)).toHaveLength(0);
    });

    it("engine failure is fail-open: post stays active and no queue row is created when evaluate() throws", async () => {
      evaluateMock.mockRejectedValueOnce(new Error("engine boom"));

      const res = await createPostAs(author, "another post");
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("active");

      await drainModeration();

      expect(await getPostStatus(res.body.id)).toBe("active");
      expect(await getQueueRowsForTarget("post", res.body.id)).toHaveLength(0);
    });
  });

  describe("comment creation flagging", () => {
    it("flagged comment ends at status=shadow_hidden and inserts a moderation_queue row after moderation drains", async () => {
      const parent = await createPostAs(author, "parent post");
      expect(parent.status).toBe(201);

      evaluateMock.mockResolvedValueOnce(FLAGGED);
      const res = await createCommentAs(author, parent.body.id, "flagged comment");
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("active");

      await drainModeration();

      expect(await getCommentStatus(res.body.id)).toBe("shadow_hidden");

      const queueRows = await getQueueRowsForTarget("comment", res.body.id);
      expect(queueRows).toHaveLength(1);
      expect(queueRows[0].authorId).toBe(author.id);
    });
  });

  describe("feed visibility for shadow-hidden posts", () => {
    let shadowPostId: number;

    beforeAll(async () => {
      evaluateMock.mockReset();
      evaluateMock.mockResolvedValueOnce(FLAGGED);
      evaluateMock.mockResolvedValue(NOT_FLAGGED);

      const res = await createPostAs(author, "shadow post for visibility");
      expect(res.status).toBe(201);
      shadowPostId = res.body.id;

      await drainModeration();
      expect(await getPostStatus(shadowPostId)).toBe("shadow_hidden");
    });

    it("author can see their own shadow-hidden post in the feed", async () => {
      const res = await request(app)
        .get("/api/community/posts")
        .set("Cookie", author.cookie);
      expect(res.status).toBe(200);
      const ids = (res.body.posts as Array<{ id: number }>).map((p) => p.id);
      expect(ids).toContain(shadowPostId);
    });

    it("other members do NOT see the shadow-hidden post in the feed", async () => {
      const res = await request(app)
        .get("/api/community/posts")
        .set("Cookie", otherMember.cookie);
      expect(res.status).toBe(200);
      const ids = (res.body.posts as Array<{ id: number }>).map((p) => p.id);
      expect(ids).not.toContain(shadowPostId);
    });

    it("admins always see shadow-hidden posts in the feed", async () => {
      const res = await request(app)
        .get("/api/community/posts")
        .set("Cookie", admin.cookie);
      expect(res.status).toBe(200);
      const ids = (res.body.posts as Array<{ id: number }>).map((p) => p.id);
      expect(ids).toContain(shadowPostId);
    });

    it("other members get 404 on GET /community/posts/:id for a shadow-hidden post", async () => {
      const res = await request(app)
        .get(`/api/community/posts/${shadowPostId}`)
        .set("Cookie", otherMember.cookie);
      expect(res.status).toBe(404);
    });

    it("author and admin can fetch the shadow-hidden post detail", async () => {
      const authorRes = await request(app)
        .get(`/api/community/posts/${shadowPostId}`)
        .set("Cookie", author.cookie);
      expect(authorRes.status).toBe(200);

      const adminRes = await request(app)
        .get(`/api/community/posts/${shadowPostId}`)
        .set("Cookie", admin.cookie);
      expect(adminRes.status).toBe(200);
    });
  });

  describe("comment visibility in /community/posts/:id/comments", () => {
    let parentPostId: number;
    let shadowCommentId: number;

    beforeAll(async () => {
      evaluateMock.mockReset();
      evaluateMock.mockResolvedValue(NOT_FLAGGED);

      const parent = await createPostAs(author, "comment-visibility parent");
      expect(parent.status).toBe(201);
      parentPostId = parent.body.id;
      await drainModeration();

      evaluateMock.mockResolvedValueOnce(FLAGGED);
      const c = await createCommentAs(author, parentPostId, "shadow comment");
      expect(c.status).toBe(201);
      shadowCommentId = c.body.id;
      await drainModeration();
      expect(await getCommentStatus(shadowCommentId)).toBe("shadow_hidden");
    });

    it("author sees their own shadow-hidden comment", async () => {
      const res = await request(app)
        .get(`/api/community/posts/${parentPostId}/comments`)
        .set("Cookie", author.cookie);
      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: number }>).map((c) => c.id);
      expect(ids).toContain(shadowCommentId);
    });

    it("other members do NOT see another author's shadow-hidden comment", async () => {
      const res = await request(app)
        .get(`/api/community/posts/${parentPostId}/comments`)
        .set("Cookie", otherMember.cookie);
      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: number }>).map((c) => c.id);
      expect(ids).not.toContain(shadowCommentId);
    });

    it("admins always see shadow-hidden comments", async () => {
      const res = await request(app)
        .get(`/api/community/posts/${parentPostId}/comments`)
        .set("Cookie", admin.cookie);
      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: number }>).map((c) => c.id);
      expect(ids).toContain(shadowCommentId);
    });
  });

  describe("posting-ban gate", () => {
    let visiblePostId: number;

    beforeAll(async () => {
      evaluateMock.mockReset();
      evaluateMock.mockResolvedValue(NOT_FLAGGED);
      const res = await createPostAs(author, "post the banned user will try to react to");
      expect(res.status).toBe(201);
      visiblePostId = res.body.id;
      await drainModeration();
    });

    it("banned user is 403'd on POST /community/posts", async () => {
      const res = await request(app)
        .post("/api/community/posts")
        .set("Cookie", bannedUser.cookie)
        .send({ title: "I am banned but trying to post", body: "I am banned but trying to post", categoryId });
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe("POSTING_BANNED");
    });

    it("banned user is 403'd on POST /community/posts/:id/comments", async () => {
      const res = await request(app)
        .post(`/api/community/posts/${visiblePostId}/comments`)
        .set("Cookie", bannedUser.cookie)
        .send({ body: "I am banned but trying to comment" });
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe("POSTING_BANNED");
    });

    it("banned user is 403'd on POST /community/reactions", async () => {
      const res = await request(app)
        .post("/api/community/reactions")
        .set("Cookie", bannedUser.cookie)
        .send({ target_type: "post", target_id: visiblePostId, type: "like" });
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe("POSTING_BANNED");
    });

    it("non-banned member can still post (sanity check that the gate is targeted)", async () => {
      const res = await request(app)
        .post("/api/community/posts")
        .set("Cookie", otherMember.cookie)
        .send({ title: "not banned, posting fine", body: "not banned, posting fine", categoryId });
      expect(res.status).toBe(201);
      await drainModeration();
    });
  });
});
