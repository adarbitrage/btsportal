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
} from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

// Partially mock the entitlements module: keep the real DB-backed
// `hasEntitlement` (used by requireCommunityAccess) so members still get
// community access, but replace `getUserEntitlements` — the only thing
// `checkAndAwardBadges` calls — so we can force the badge step to throw.
vi.mock("../lib/entitlements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/entitlements")>();
  return {
    ...actual,
    getUserEntitlements: vi.fn(actual.getUserEntitlements),
  };
});

import { buildTestAppWithRouters } from "./test-app";
import communityRouter from "../routes/community";
import { pendingModerationJobs } from "../lib/moderation/queue";
import { getUserEntitlements } from "../lib/entitlements";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `badge-fail-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
const seededCategoryIds: number[] = [];
const seededPostIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let categoryId: number;

interface SeededUser {
  id: number;
  cookie: string;
}

const users: Record<"member" | "admin" | "super_admin", SeededUser> = {} as any;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function seedUser(role: "member" | "admin" | "super_admin", productId: number): Promise<SeededUser> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const email = `${TEST_TAG}-${role}@example.test`;
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Badge Fail ${role}`,
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(user.id);

  await db.insert(userProductsTable).values({
    userId: user.id,
    productId,
    status: "active",
  });

  return { id: user.id, cookie: signCookie(user.id, email) };
}

beforeAll(async () => {
  app = buildTestAppWithRouters([communityRouter]);

  const [product] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-product`,
      name: "Badge Fail Test Product",
      type: "backend",
      entitlementKeys: ["community:access"] as unknown as string[],
      sortOrder: 99,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(product.id);

  users.member = await seedUser("member", product.id);
  users.admin = await seedUser("admin", product.id);
  users.super_admin = await seedUser("super_admin", product.id);

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
});

afterAll(async () => {
  vi.mocked(getUserEntitlements).mockRestore?.();
  // Delete every post in the seeded categories (not just tracked ids) so a
  // post created right before a failed assertion can't dangle and break the
  // category cleanup via the foreign-key constraint.
  if (seededCategoryIds.length > 0) {
    const postsInCats = await db
      .select({ id: communityPostsTable.id })
      .from(communityPostsTable)
      .where(inArray(communityPostsTable.categoryId, seededCategoryIds));
    const postIds = postsInCats.map((p) => p.id);
    if (postIds.length > 0) {
      await db.delete(moderationQueueTable).where(
        and(
          eq(moderationQueueTable.targetType, "post"),
          inArray(moderationQueueTable.targetId, postIds),
        ),
      );
      await db.delete(communityCommentsTable).where(inArray(communityCommentsTable.postId, postIds));
      await db.delete(communityPostsTable).where(inArray(communityPostsTable.id, postIds));
    }
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
});

describe("POST /community/posts isolates badge-awarding failures", () => {
  for (const role of ["member", "admin", "super_admin"] as const) {
    it(`still creates the post and returns 201 when badge awarding throws (${role})`, async () => {
      // Force the badge step to blow up for this request only.
      vi.mocked(getUserEntitlements).mockRejectedValueOnce(
        new Error("simulated badge-awarding failure"),
      );

      const res = await request(app)
        .post("/api/community/posts")
        .set("Cookie", users[role].cookie)
        .send({
          title: `badge fail ${role}`,
          body: `post body for ${role} while badge awarding fails`,
          categoryId,
        });

      expect(res.body.id).toBeTypeOf("number");
      // Track immediately so a later assertion failure can't leak the row.
      if (typeof res.body.id === "number") seededPostIds.push(res.body.id);

      expect(res.status).toBe(201);
      // New posts are created in the "pending" state; the only thing under
      // test is that the badge failure didn't turn this into a 500.
      expect(res.body.status).toBe("pending");

      // The post must actually persist, not just return a 201.
      const [post] = await db
        .select()
        .from(communityPostsTable)
        .where(eq(communityPostsTable.id, res.body.id));
      expect(post).toBeDefined();
      expect(post.authorId).toBe(users[role].id);
      expect(post.status).not.toBe("deleted");

      await pendingModerationJobs();
    });
  }

  it("still creates the post and returns 201 when badge awarding succeeds", async () => {
    // No mockRejectedValueOnce queued -> the real getUserEntitlements runs.
    const res = await request(app)
      .post("/api/community/posts")
      .set("Cookie", users.member.cookie)
      .send({
        title: "badge success control",
        body: "post body for the happy-path control case",
        categoryId,
      });

    expect(res.body.id).toBeTypeOf("number");
    if (typeof res.body.id === "number") seededPostIds.push(res.body.id);
    expect(res.status).toBe(201);

    await pendingModerationJobs();
  });
});
