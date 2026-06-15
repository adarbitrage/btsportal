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
import adminCommunityRouter from "../routes/admin-community";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `admin-pin-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
let categoryId: number;
const seededPostIds: number[] = [];

interface Fixture {
  id: number;
  email: string;
  cookie: string;
}

let admin: Fixture;
let member: Fixture;
let oldPostId: number;
let newPostId: number;

function signCookie(userId: number, email: string): string {
  return `access_token=${jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" })}`;
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
  await db.insert(userProductsTable).values({ userId, productId: product.id, status: "active" });
}

async function feed(): Promise<Array<{ id: number; isPinned: boolean }>> {
  const res = await request(app)
    .get("/api/community/posts")
    .query({ categorySlug: `${TEST_TAG}-cat` })
    .set("Cookie", member.cookie);
  expect(res.status).toBe(200);
  return res.body.posts as Array<{ id: number; isPinned: boolean }>;
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

  admin = await makeUser({ suffix: "admin", role: "super_admin" });
  member = await makeUser({ suffix: "member" });
  await grantCommunityAccess(admin.id, "admin");
  await grantCommunityAccess(member.id, "member");

  // An older post and a newer post, both active and unpinned. By recency the
  // newer post leads the feed until an admin pins the older one.
  const base = Date.now() - 1000 * 60 * 60;
  const inserted = await db
    .insert(communityPostsTable)
    .values([
      { authorId: member.id, categoryId, title: "Old starter", content: "old", status: "active", createdAt: new Date(base) },
      { authorId: member.id, categoryId, title: "New post", content: "new", status: "active", createdAt: new Date(base + 1000) },
    ])
    .returning({ id: communityPostsTable.id });
  seededPostIds.push(...inserted.map((r) => r.id));
  oldPostId = inserted[0].id;
  newPostId = inserted[1].id;
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

describe("admin pin toggle -> feed visibility", () => {
  it("rejects pin toggles from non-admin members", async () => {
    const res = await request(app)
      .patch(`/api/admin/community/posts/${oldPostId}/pin`)
      .set("Cookie", member.cookie);
    expect(res.status).toBe(403);
  });

  it("starts with the newer post on top (no pins yet)", async () => {
    const ids = (await feed()).map((p) => p.id);
    expect(ids.indexOf(newPostId)).toBeLessThan(ids.indexOf(oldPostId));
  });

  it("pins an older post via the admin endpoint and floats it to the top", async () => {
    const pin = await request(app)
      .patch(`/api/admin/community/posts/${oldPostId}/pin`)
      .set("Cookie", admin.cookie);
    expect(pin.status).toBe(200);
    expect(pin.body.isPinned).toBe(true);

    const posts = await feed();
    expect(posts[0].id).toBe(oldPostId);
    expect(posts[0].isPinned).toBe(true);
  });

  it("unpins via the admin endpoint and restores recency order", async () => {
    const unpin = await request(app)
      .patch(`/api/admin/community/posts/${oldPostId}/pin`)
      .set("Cookie", admin.cookie);
    expect(unpin.status).toBe(200);
    expect(unpin.body.isPinned).toBe(false);

    const ids = (await feed()).map((p) => p.id);
    expect(ids.indexOf(newPostId)).toBeLessThan(ids.indexOf(oldPostId));
  });
});
