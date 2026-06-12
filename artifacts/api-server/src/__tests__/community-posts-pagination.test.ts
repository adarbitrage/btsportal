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
const TEST_TAG = `feed-pagination-${randomUUID().slice(0, 8)}`;
const TOTAL_POSTS = 25; // intentionally not a multiple of the page size
const PAGE_SIZE = 10;

let app: ReturnType<typeof buildTestAppWithRouters>;
let memberCookie = "";
const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
let categoryId: number;
const seededPostIds: number[] = [];

beforeAll(async () => {
  app = buildTestAppWithRouters([communityRouter]);

  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [member] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-member@example.test`,
      name: "Feed Pagination Member",
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

  // Seed active posts with strictly increasing createdAt so the (createdAt
  // desc, id desc) ordering is deterministic and newest-first is well defined.
  const base = Date.now() - 1000 * 60 * 60;
  const rows = Array.from({ length: TOTAL_POSTS }, (_, i) => ({
    authorId: member.id,
    categoryId,
    title: `Post ${i}`,
    content: `Body for post ${i}`,
    status: "active",
    createdAt: new Date(base + i * 1000),
  }));
  const inserted = await db.insert(communityPostsTable).values(rows).returning({ id: communityPostsTable.id });
  seededPostIds.push(...inserted.map((r) => r.id));
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
  return res.body as { posts: Array<{ id: number }>; nextCursor: string | null };
}

describe("GET /community/posts pagination contract", () => {
  it("returns the { posts, nextCursor } shape (not a `pagination` object)", async () => {
    const body = await fetchPage({ limit: PAGE_SIZE });
    expect(Array.isArray(body.posts)).toBe(true);
    expect(body).toHaveProperty("nextCursor");
    expect(body).not.toHaveProperty("pagination");
    expect(body.posts.length).toBe(PAGE_SIZE);
    // A full page leaves more rows behind, so a cursor must be handed back.
    expect(typeof body.nextCursor).toBe("string");
    expect(body.nextCursor).toBeTruthy();
  });

  it("passing the returned cursor fetches the next page with no overlap", async () => {
    const first = await fetchPage({ limit: PAGE_SIZE });
    const second = await fetchPage({ limit: PAGE_SIZE, cursor: first.nextCursor! });

    const firstIds = first.posts.map((p) => p.id);
    const secondIds = second.posts.map((p) => p.id);

    expect(secondIds.length).toBe(PAGE_SIZE);
    // No post appears on both pages — the cursor advanced correctly.
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
  });

  it("walks every post exactly once and clears nextCursor on the final page", async () => {
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
    // Every seeded post seen, exactly once.
    expect(seen.length).toBe(TOTAL_POSTS);
    expect(new Set(seen).size).toBe(TOTAL_POSTS);
    expect([...seen].sort((a, b) => a - b)).toEqual([...seededPostIds].sort((a, b) => a - b));
  });
});
