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
import adminCommunityRouter from "../routes/admin-community";
import { pendingModerationJobs } from "../lib/moderation/queue";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `community-approval-${randomUUID().slice(0, 8)}`;

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

async function getPostStatus(id: number): Promise<string | undefined> {
  const [row] = await db
    .select({ status: communityPostsTable.status })
    .from(communityPostsTable)
    .where(eq(communityPostsTable.id, id));
  return row?.status;
}

async function drainModeration() {
  await pendingModerationJobs();
}

async function createPostAs(actor: Fixture, body = "hello world") {
  return request(app)
    .post("/api/community/posts")
    .set("Cookie", actor.cookie)
    .send({ title: body.slice(0, 100), body, categoryId });
}

async function feedIds(actor: Fixture): Promise<number[]> {
  const res = await request(app)
    .get("/api/community/posts")
    .set("Cookie", actor.cookie);
  expect(res.status).toBe(200);
  return (res.body.posts as Array<{ id: number }>).map((p) => p.id);
}

beforeAll(async () => {
  app = buildTestAppWithRouters([communityRouter, adminCommunityRouter]);

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

  await grantCommunityAccess(author.id, "author");
  await grantCommunityAccess(otherMember.id, "other");
  await grantCommunityAccess(admin.id, "admin");
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

/**
 * Approve a freshly-created pending post so it is `active` and usable as a
 * normal post target for comment tests.
 */
async function createApprovedPost(body = "approved post body"): Promise<number> {
  const res = await createPostAs(author, body);
  expect(res.status).toBe(201);
  await drainModeration();
  const approveRes = await request(app)
    .patch(`/api/admin/community/posts/${res.body.id}/approve`)
    .set("Cookie", admin.cookie);
  expect(approveRes.status).toBe(200);
  expect(approveRes.body.status).toBe("active");
  return res.body.id;
}

describe("Community comment creation contract (guards the {content, parentId} fix)", () => {
  it("POST /community/posts/:id/comments with { content } creates a properly shaped top-level comment", async () => {
    const postId = await createApprovedPost("post for top-level comment");

    const res = await request(app)
      .post(`/api/community/posts/${postId}/comments`)
      .set("Cookie", author.cookie)
      .send({ content: "this is a top-level comment" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTypeOf("number");
    expect(res.body.postId).toBe(postId);
    expect(res.body.body).toBe("this is a top-level comment");
    // Nested author object, not a flat authorId.
    expect(res.body.author).toMatchObject({ id: author.id, name: "User author" });
    expect(res.body).toHaveProperty("hasReacted", false);
    expect(res.body).toHaveProperty("parentCommentId", null);
    expect(res.body).toHaveProperty("replyToName", null);

    // Confirm it actually persisted.
    const [row] = await db
      .select({ content: communityCommentsTable.content, parentId: communityCommentsTable.parentId })
      .from(communityCommentsTable)
      .where(eq(communityCommentsTable.id, res.body.id));
    expect(row.content).toBe("this is a top-level comment");
    expect(row.parentId).toBeNull();
  });

  it("POST /community/posts/:id/comments with { content, parentId } nests the reply under the parent", async () => {
    const postId = await createApprovedPost("post for nested reply");

    const parentRes = await request(app)
      .post(`/api/community/posts/${postId}/comments`)
      .set("Cookie", author.cookie)
      .send({ content: "parent comment" });
    expect(parentRes.status).toBe(201);
    const parentId = parentRes.body.id;

    const replyRes = await request(app)
      .post(`/api/community/posts/${postId}/comments`)
      .set("Cookie", otherMember.cookie)
      .send({ content: "child reply", parentId });

    expect(replyRes.status).toBe(201);
    expect(replyRes.body.parentCommentId).toBe(parentId);
    expect(replyRes.body.replyToName).toBe("User author");
    expect(replyRes.body.author).toMatchObject({ id: otherMember.id, name: "User other" });
    expect(replyRes.body).toHaveProperty("hasReacted", false);

    const [row] = await db
      .select({ parentId: communityCommentsTable.parentId })
      .from(communityCommentsTable)
      .where(eq(communityCommentsTable.id, replyRes.body.id));
    expect(row.parentId).toBe(parentId);
  });

  it("rejects a comment with a missing content body (400)", async () => {
    const postId = await createApprovedPost("post for missing content");

    const res = await request(app)
      .post(`/api/community/posts/${postId}/comments`)
      .set("Cookie", author.cookie)
      .send({});

    expect(res.status).toBe(400);
  });
});

describe("Admin delete removes a post from the feed (guards the soft-delete fix)", () => {
  it("DELETE /admin/community/posts/:id sets status=deleted and the post disappears from the feed", async () => {
    const postId = await createApprovedPost("post that will be admin-deleted");

    // Visible in the feed before deletion.
    expect(await feedIds(author)).toContain(postId);
    expect(await feedIds(otherMember)).toContain(postId);

    const delRes = await request(app)
      .delete(`/api/admin/community/posts/${postId}`)
      .set("Cookie", admin.cookie);
    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);

    // Status flipped to "deleted" in the DB.
    expect(await getPostStatus(postId)).toBe("deleted");

    // No longer visible to anyone in the feed — including admins.
    expect(await feedIds(author)).not.toContain(postId);
    expect(await feedIds(otherMember)).not.toContain(postId);
    expect(await feedIds(admin)).not.toContain(postId);
  });

  it("returns 404 when deleting a non-existent post", async () => {
    const res = await request(app)
      .delete(`/api/admin/community/posts/99999999`)
      .set("Cookie", admin.cookie);
    expect(res.status).toBe(404);
  });
});

describe("New posts require admin approval before going public (guards the approval gate)", () => {
  it("a new post starts as pending: visible to its author, hidden from other members", async () => {
    const res = await createPostAs(author, "fresh pending post");
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    const postId = res.body.id;
    await drainModeration();

    // Persisted as pending.
    expect(await getPostStatus(postId)).toBe("pending");

    // Author sees their own pending post in the feed and detail.
    expect(await feedIds(author)).toContain(postId);
    const authorDetail = await request(app)
      .get(`/api/community/posts/${postId}`)
      .set("Cookie", author.cookie);
    expect(authorDetail.status).toBe(200);

    // A non-author member does NOT see it in the feed and 404s on detail.
    expect(await feedIds(otherMember)).not.toContain(postId);
    const otherDetail = await request(app)
      .get(`/api/community/posts/${postId}`)
      .set("Cookie", otherMember.cookie);
    expect(otherDetail.status).toBe(404);

    // Admins can always see pending posts.
    expect(await feedIds(admin)).toContain(postId);
  });

  it("after admin approval the post becomes active and is visible to all members", async () => {
    const res = await createPostAs(author, "pending until approved");
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    const postId = res.body.id;
    await drainModeration();

    // Hidden from other member while pending.
    expect(await feedIds(otherMember)).not.toContain(postId);

    const approveRes = await request(app)
      .patch(`/api/admin/community/posts/${postId}/approve`)
      .set("Cookie", admin.cookie);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("active");
    expect(await getPostStatus(postId)).toBe("active");

    // Now visible to a non-author member in feed and detail.
    expect(await feedIds(otherMember)).toContain(postId);
    const otherDetail = await request(app)
      .get(`/api/community/posts/${postId}`)
      .set("Cookie", otherMember.cookie);
    expect(otherDetail.status).toBe(200);
  });
});
