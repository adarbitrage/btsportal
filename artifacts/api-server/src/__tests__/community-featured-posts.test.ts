import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import communityRouter from "../routes/community";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `feed-featured-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let memberCookie = "";
const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
let categoryId: number;
const seededPostIds: number[] = [];
let featuredPostId: number;
let plainPostId: number;

beforeAll(async () => {
  app = buildTestAppWithRouters([communityRouter]);

  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [member] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-member@example.test`,
      name: "Feed Featured Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededUserIds.push(member.id);
  memberCookie = `access_token=${jwt.sign({ userId: member.id, email: member.email }, JWT_SECRET, { expiresIn: "1h" })}`;

  const [product] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-prod`,
      name: `${TEST_TAG} community product`,
      type: "backend",
      entitlementKeys: ["community:access"] as unknown as string[],
      sortOrder: 99,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(product.id);
  await db.insert(userProductsTable).values({
    userId: member.id,
    productId: product.id,
    status: "active",
  });

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

  // The featured post is the OLDEST of the three. Without featured-first
  // ordering it would land at the bottom of the feed instead of the top.
  const base = Date.now() - 1000 * 60 * 60;
  const inserted = await db
    .insert(communityPostsTable)
    .values([
      {
        authorId: member.id,
        categoryId,
        title: "Featured post",
        content: "This is the admin-featured post",
        status: "active",
        isFeatured: true,
        createdAt: new Date(base),
      },
      {
        authorId: member.id,
        categoryId,
        title: "Plain post",
        content: "This is a normal post",
        status: "active",
        isFeatured: false,
        createdAt: new Date(base + 1000),
      },
      {
        authorId: member.id,
        categoryId,
        title: "Newer plain post",
        content: "This is a newer normal post",
        status: "active",
        isFeatured: false,
        createdAt: new Date(base + 2000),
      },
    ])
    .returning({ id: communityPostsTable.id });
  seededPostIds.push(...inserted.map((r) => r.id));
  featuredPostId = inserted[0].id;
  plainPostId = inserted[1].id;
});

afterAll(async () => {
  if (seededPostIds.length > 0) {
    await db.delete(communityPostsTable).where(inArray(communityPostsTable.id, seededPostIds));
  }
  if (categoryId) {
    await db.delete(communityCategoriesTable).where(eq(communityCategoriesTable.id, categoryId));
  }
  if (seededUserIds.length > 0) {
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  if (seededProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, seededProductIds));
  }
});

describe("community feed exposes isFeatured", () => {
  it("returns isFeatured on each post in the list feed", async () => {
    const res = await request(app)
      .get("/api/community/posts")
      .query({ categorySlug: `${TEST_TAG}-cat`, limit: 20 })
      .set("Cookie", memberCookie);
    expect(res.status).toBe(200);
    const posts = res.body.posts as Array<{ id: number; isFeatured: boolean }>;
    for (const p of posts) {
      expect(typeof p.isFeatured).toBe("boolean");
    }
    const featured = posts.find((p) => p.id === featuredPostId);
    const plain = posts.find((p) => p.id === plainPostId);
    expect(featured?.isFeatured).toBe(true);
    expect(plain?.isFeatured).toBe(false);
  });

  it("surfaces an old featured post at the very top of the feed", async () => {
    const res = await request(app)
      .get("/api/community/posts")
      .query({ categorySlug: `${TEST_TAG}-cat`, limit: 20 })
      .set("Cookie", memberCookie);
    expect(res.status).toBe(200);
    const posts = res.body.posts as Array<{ id: number; isFeatured: boolean }>;
    // Despite being the oldest post, the featured one leads the feed.
    expect(posts[0].id).toBe(featuredPostId);
    expect(posts[0].isFeatured).toBe(true);
    expect(posts.slice(1).every((p) => p.isFeatured === false)).toBe(true);
  });

  it("returns isFeatured on the single-post detail endpoint", async () => {
    const res = await request(app)
      .get(`/api/community/posts/${featuredPostId}`)
      .set("Cookie", memberCookie);
    expect(res.status).toBe(200);
    expect(res.body.isFeatured).toBe(true);
  });
});
