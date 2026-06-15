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
const TEST_TAG = `feed-pinned-${randomUUID().slice(0, 8)}`;
const PAGE_SIZE = 5;

let app: ReturnType<typeof buildTestAppWithRouters>;
let memberCookie = "";
const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
let categoryId: number;
const seededPostIds: number[] = [];
let pinnedOldPostId: number;

beforeAll(async () => {
  app = buildTestAppWithRouters([communityRouter]);

  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [member] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-member@example.test`,
      name: "Feed Pinned Member",
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

  // Seed 12 active posts with strictly increasing createdAt. The OLDEST post
  // is pinned — without pinned-first ordering it would land on the last page,
  // far below the page-1 fold.
  const base = Date.now() - 1000 * 60 * 60;
  const rows = Array.from({ length: 12 }, (_, i) => ({
    authorId: member.id,
    categoryId,
    title: `Post ${i}`,
    content: `Body for post ${i}`,
    status: "active",
    isPinned: i === 0,
    createdAt: new Date(base + i * 1000),
  }));
  const inserted = await db.insert(communityPostsTable).values(rows).returning({ id: communityPostsTable.id });
  seededPostIds.push(...inserted.map((r) => r.id));
  pinnedOldPostId = inserted[0].id;
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

async function fetchPage(query: Record<string, string | number>) {
  const res = await request(app)
    .get("/api/community/posts")
    .query({ categorySlug: `${TEST_TAG}-cat`, ...query })
    .set("Cookie", memberCookie);
  expect(res.status).toBe(200);
  return res.body as { posts: Array<{ id: number; isPinned: boolean }>; nextCursor: string | null };
}

describe("GET /community/posts pinned-first ordering", () => {
  it("exposes isPinned on each feed post", async () => {
    const body = await fetchPage({ limit: PAGE_SIZE });
    expect(body.posts.length).toBe(PAGE_SIZE);
    for (const p of body.posts) {
      expect(typeof p.isPinned).toBe("boolean");
    }
  });

  it("surfaces an old pinned post at the very top of page 1", async () => {
    const body = await fetchPage({ limit: PAGE_SIZE });
    // Despite being the oldest post, the pinned one leads the feed.
    expect(body.posts[0].id).toBe(pinnedOldPostId);
    expect(body.posts[0].isPinned).toBe(true);
    // The remaining page-1 posts are unpinned (only one pinned post exists).
    expect(body.posts.slice(1).every((p) => p.isPinned === false)).toBe(true);
  });

  it("paginates without dropping or duplicating the pinned post", async () => {
    const seen: number[] = [];
    let cursor: string | null = null;
    let last: { posts: Array<{ id: number }>; nextCursor: string | null } | null = null;
    let safety = 50;
    do {
      last = await fetchPage({ limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
      for (const p of last.posts) seen.push(p.id);
      cursor = last.nextCursor;
    } while (cursor && --safety > 0);

    expect(safety).toBeGreaterThan(0);
    expect(last!.nextCursor).toBeNull();
    expect(seen.length).toBe(seededPostIds.length);
    expect(new Set(seen).size).toBe(seededPostIds.length);
    expect(seen.filter((id) => id === pinnedOldPostId).length).toBe(1);
    expect([...seen].sort((a, b) => a - b)).toEqual([...seededPostIds].sort((a, b) => a - b));
  });
});
