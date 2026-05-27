import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  communityCategoriesTable,
  communityPostsTable,
  communityCommentsTable,
  moderationQueueTable,
  userStrikesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { authenticate } from "../middleware/auth";
import { requestIdMiddleware, apiErrorHandler } from "../lib/api-errors";
import adminModerationQueueRouter from "../routes/admin/moderation";
import adminStrikesRouter from "../routes/admin/strikes";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `mod-review-${randomUUID().slice(0, 8)}`;

let app: Express;

const seededUserIds: number[] = [];
const seededPostIds: number[] = [];
const seededCommentIds: number[] = [];
const seededQueueIds: number[] = [];
let categoryId: number;

interface Fixture {
  id: number;
  email: string;
  cookie: string;
}

let admin: Fixture;
let member: Fixture;
let author: Fixture;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function makeUser(opts: { suffix: string; role?: string }): Promise<Fixture> {
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
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededUserIds.push(row.id);
  return { id: row.id, email: row.email, cookie: signCookie(row.id, row.email) };
}

async function insertShadowHiddenPost(authorId: number, body = "flagged body"): Promise<number> {
  const [row] = await db
    .insert(communityPostsTable)
    .values({
      authorId,
      categoryId,
      content: body,
      status: "shadow_hidden",
    })
    .returning({ id: communityPostsTable.id });
  seededPostIds.push(row.id);
  return row.id;
}

async function insertShadowHiddenComment(authorId: number, postId: number, body = "flagged comment"): Promise<number> {
  const [row] = await db
    .insert(communityCommentsTable)
    .values({
      authorId,
      postId,
      content: body,
      status: "shadow_hidden",
    })
    .returning({ id: communityCommentsTable.id });
  seededCommentIds.push(row.id);
  return row.id;
}

async function insertQueueRow(opts: {
  targetType: "post" | "comment";
  targetId: number;
  authorId: number;
  body?: string;
}): Promise<number> {
  const [row] = await db
    .insert(moderationQueueTable)
    .values({
      targetType: opts.targetType,
      targetId: opts.targetId,
      authorId: opts.authorId,
      body: opts.body ?? "queued body",
      status: "pending",
      triggeredBy: "wordlist_hard",
      wordlistMatches: [{ word: "badword", category: "abuse", severity: "HARD" }] as unknown as object,
      aiScores: { toxicity: 0, spam: 0, harassment: 0, hate_speech: 0 } as unknown as object,
    })
    .returning({ id: moderationQueueTable.id });
  seededQueueIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  // The admin routers declare their paths relative to the prefix they're mounted at
  // (e.g. router.post("/:id/approve")), so mount them at production-style prefixes
  // rather than using buildTestAppWithRouters which mounts everything at /api.
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", requestIdMiddleware);
  app.use("/api", authenticate);
  app.use("/api/admin/moderation/queue", adminModerationQueueRouter);
  app.use("/api/admin/strikes", adminStrikesRouter);
  app.use("/api", apiErrorHandler);

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

  admin = await makeUser({ suffix: "admin", role: "super_admin" });
  member = await makeUser({ suffix: "member" });
});

beforeEach(async () => {
  // Each test creates a fresh author so strike-count assertions are independent.
  author = await makeUser({ suffix: `author-${randomUUID().slice(0, 6)}` });
});

afterAll(async () => {
  if (seededQueueIds.length > 0) {
    await db.delete(userStrikesTable).where(inArray(userStrikesTable.queueId, seededQueueIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(userStrikesTable).where(inArray(userStrikesTable.userId, seededUserIds));
    await db.delete(moderationQueueTable).where(inArray(moderationQueueTable.authorId, seededUserIds));
    await db.delete(communityCommentsTable).where(inArray(communityCommentsTable.authorId, seededUserIds));
    await db.delete(communityPostsTable).where(inArray(communityPostsTable.authorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  if (categoryId) {
    await db.delete(communityCategoriesTable).where(eq(communityCategoriesTable.id, categoryId));
  }
});

describe("Admin moderation queue review actions", () => {
  describe("POST /admin/moderation/queue/:id/approve", () => {
    it("flips a shadow-hidden post back to active and marks the queue row reviewed by the admin", async () => {
      const postId = await insertShadowHiddenPost(author.id);
      const queueId = await insertQueueRow({ targetType: "post", targetId: postId, authorId: author.id });

      const res = await request(app)
        .post(`/api/admin/moderation/queue/${queueId}/approve`)
        .set("Cookie", admin.cookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });

      const [post] = await db
        .select({ status: communityPostsTable.status })
        .from(communityPostsTable)
        .where(eq(communityPostsTable.id, postId));
      expect(post?.status).toBe("active");

      const [queueRow] = await db
        .select()
        .from(moderationQueueTable)
        .where(eq(moderationQueueTable.id, queueId));
      expect(queueRow.status).toBe("approved");
      expect(queueRow.reviewedBy).toBe(admin.id);
      expect(queueRow.reviewedAt).toBeInstanceOf(Date);

      // Approving must not produce a strike.
      const strikes = await db
        .select()
        .from(userStrikesTable)
        .where(eq(userStrikesTable.queueId, queueId));
      expect(strikes).toHaveLength(0);
    });

    it("flips a shadow-hidden comment back to active when approved", async () => {
      const postId = await insertShadowHiddenPost(author.id, "parent for comment");
      await db.update(communityPostsTable).set({ status: "active" }).where(eq(communityPostsTable.id, postId));
      const commentId = await insertShadowHiddenComment(author.id, postId);
      const queueId = await insertQueueRow({ targetType: "comment", targetId: commentId, authorId: author.id });

      const res = await request(app)
        .post(`/api/admin/moderation/queue/${queueId}/approve`)
        .set("Cookie", admin.cookie);

      expect(res.status).toBe(200);
      const [comment] = await db
        .select({ status: communityCommentsTable.status })
        .from(communityCommentsTable)
        .where(eq(communityCommentsTable.id, commentId));
      expect(comment?.status).toBe("active");
    });
  });

  describe("POST /admin/moderation/queue/:id/reject (confirm hide)", () => {
    it("leaves the post shadow-hidden, records reviewer + reviewedAt, and inserts a user_strike tied to the queue entry", async () => {
      const postId = await insertShadowHiddenPost(author.id);
      const queueId = await insertQueueRow({ targetType: "post", targetId: postId, authorId: author.id });

      const res = await request(app)
        .post(`/api/admin/moderation/queue/${queueId}/reject`)
        .set("Cookie", admin.cookie)
        .send({ reason: "Clear policy violation" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.strikeCount).toBe(1);

      // Post stays shadow-hidden — confirming a hide should not change content visibility.
      const [post] = await db
        .select({ status: communityPostsTable.status })
        .from(communityPostsTable)
        .where(eq(communityPostsTable.id, postId));
      expect(post?.status).toBe("shadow_hidden");

      const [queueRow] = await db
        .select()
        .from(moderationQueueTable)
        .where(eq(moderationQueueTable.id, queueId));
      expect(queueRow.status).toBe("rejected");
      expect(queueRow.reviewedBy).toBe(admin.id);
      expect(queueRow.reviewedAt).toBeInstanceOf(Date);

      const strikes = await db
        .select()
        .from(userStrikesTable)
        .where(eq(userStrikesTable.queueId, queueId));
      expect(strikes).toHaveLength(1);
      expect(strikes[0].userId).toBe(author.id);
      expect(strikes[0].reason).toBe("Clear policy violation");
      expect(strikes[0].targetType).toBe("post");
      expect(strikes[0].targetId).toBe(postId);

      // Author must not be banned at one strike.
      const [user] = await db
        .select({ postingBannedAt: usersTable.postingBannedAt })
        .from(usersTable)
        .where(eq(usersTable.id, author.id));
      expect(user?.postingBannedAt).toBeNull();
    });

    it("sets postingBannedAt on the author when the strike threshold (3) is reached", async () => {
      const queueIds: number[] = [];
      for (let i = 0; i < 3; i++) {
        const postId = await insertShadowHiddenPost(author.id, `flagged ${i}`);
        queueIds.push(await insertQueueRow({ targetType: "post", targetId: postId, authorId: author.id }));
      }

      // First two rejects: not yet banned.
      for (let i = 0; i < 2; i++) {
        const res = await request(app)
          .post(`/api/admin/moderation/queue/${queueIds[i]}/reject`)
          .set("Cookie", admin.cookie)
          .send({});
        expect(res.status).toBe(200);
        expect(res.body.strikeCount).toBe(i + 1);
      }

      const [beforeBan] = await db
        .select({ postingBannedAt: usersTable.postingBannedAt })
        .from(usersTable)
        .where(eq(usersTable.id, author.id));
      expect(beforeBan?.postingBannedAt).toBeNull();

      // Third reject crosses the threshold.
      const finalRes = await request(app)
        .post(`/api/admin/moderation/queue/${queueIds[2]}/reject`)
        .set("Cookie", admin.cookie)
        .send({});
      expect(finalRes.status).toBe(200);
      expect(finalRes.body.strikeCount).toBe(3);

      const [afterBan] = await db
        .select({ postingBannedAt: usersTable.postingBannedAt })
        .from(usersTable)
        .where(eq(usersTable.id, author.id));
      expect(afterBan?.postingBannedAt).toBeInstanceOf(Date);
    });
  });

  describe("RBAC: non-admin members get 403 on every moderation review endpoint", () => {
    let postId: number;
    let queueId: number;

    beforeEach(async () => {
      postId = await insertShadowHiddenPost(author.id);
      queueId = await insertQueueRow({ targetType: "post", targetId: postId, authorId: author.id });
    });

    it("GET /admin/moderation/queue is 403 for plain member", async () => {
      const res = await request(app)
        .get("/api/admin/moderation/queue")
        .set("Cookie", member.cookie);
      expect(res.status).toBe(403);
    });

    it("GET /admin/moderation/queue/:id is 403 for plain member", async () => {
      const res = await request(app)
        .get(`/api/admin/moderation/queue/${queueId}`)
        .set("Cookie", member.cookie);
      expect(res.status).toBe(403);
    });

    it("POST /admin/moderation/queue/:id/approve is 403 for plain member and does not change post status", async () => {
      const res = await request(app)
        .post(`/api/admin/moderation/queue/${queueId}/approve`)
        .set("Cookie", member.cookie);
      expect(res.status).toBe(403);

      const [post] = await db
        .select({ status: communityPostsTable.status })
        .from(communityPostsTable)
        .where(eq(communityPostsTable.id, postId));
      expect(post?.status).toBe("shadow_hidden");

      const [queueRow] = await db
        .select({ status: moderationQueueTable.status, reviewedBy: moderationQueueTable.reviewedBy })
        .from(moderationQueueTable)
        .where(eq(moderationQueueTable.id, queueId));
      expect(queueRow.status).toBe("pending");
      expect(queueRow.reviewedBy).toBeNull();
    });

    it("POST /admin/moderation/queue/:id/reject is 403 for plain member and inserts no strike", async () => {
      const res = await request(app)
        .post(`/api/admin/moderation/queue/${queueId}/reject`)
        .set("Cookie", member.cookie)
        .send({ reason: "should not apply" });
      expect(res.status).toBe(403);

      const strikes = await db
        .select()
        .from(userStrikesTable)
        .where(eq(userStrikesTable.queueId, queueId));
      expect(strikes).toHaveLength(0);
    });

    it("GET /admin/strikes/users is 403 for plain member", async () => {
      const res = await request(app)
        .get("/api/admin/strikes/users")
        .set("Cookie", member.cookie);
      expect(res.status).toBe(403);
    });

    it("GET /admin/strikes/users/:userId is 403 for plain member", async () => {
      const res = await request(app)
        .get(`/api/admin/strikes/users/${author.id}`)
        .set("Cookie", member.cookie);
      expect(res.status).toBe(403);
    });

    it("POST /admin/strikes/users/:userId/ban is 403 for plain member and does not ban the user", async () => {
      const res = await request(app)
        .post(`/api/admin/strikes/users/${author.id}/ban`)
        .set("Cookie", member.cookie);
      expect(res.status).toBe(403);

      const [user] = await db
        .select({ postingBannedAt: usersTable.postingBannedAt })
        .from(usersTable)
        .where(eq(usersTable.id, author.id));
      expect(user?.postingBannedAt).toBeNull();
    });

    it("POST /admin/strikes/users/:userId/unban is 403 for plain member", async () => {
      // Ban via admin first so the unban path has something real to attempt.
      await db.update(usersTable).set({ postingBannedAt: new Date() }).where(eq(usersTable.id, author.id));

      const res = await request(app)
        .post(`/api/admin/strikes/users/${author.id}/unban`)
        .set("Cookie", member.cookie);
      expect(res.status).toBe(403);

      const [user] = await db
        .select({ postingBannedAt: usersTable.postingBannedAt })
        .from(usersTable)
        .where(eq(usersTable.id, author.id));
      expect(user?.postingBannedAt).toBeInstanceOf(Date);
    });
  });
});
