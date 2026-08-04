/**
 * Blitz ownership enforcement lock-in tests (real shared dev DB, supertest).
 *
 * Covers:
 *  - /blitz/lessons + /blitz/guide: FE-only member 403, blitz owner 200,
 *    admin bypass 200.
 *  - /admin/blitz-archive-guide: members 403, admin 200.
 *  - Legacy course-progress path: blitz course ids (v2, legacy 1-18,
 *    21-day-blitz) 403 for non-owners on POST/DELETE, blitz rows hidden from
 *    GET; non-blitz ids unaffected.
 *  - Fail-closed missing-row behavior: with the `blitz` content_access_map
 *    row deleted, members (even blitz owners) get 403 while admins pass.
 *    The row is restored afterwards (the boot seed would also restore it).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  userProductsTable,
  productsTable,
  courseProgressTable,
  contentAccessMapTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "../../__tests__/test-app";
import blitzLessonsRouter from "../blitz-lessons";
import courseProgressRouter from "../course-progress";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `blitzgate-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];

async function seedUser(role: string): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-${randomUUID().slice(0, 6)}@example.test`,
      name: "Blitz Gate Test",
      passwordHash,
      role,
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

async function grant(userId: number, slug: string): Promise<void> {
  const [product] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.slug, slug));
  if (!product) throw new Error(`missing product slug ${slug} in dev DB`);
  await db
    .insert(userProductsTable)
    .values({ userId, productId: product.id, status: "active" });
}

function cookieFor(userId: number): string {
  const token = jwt.sign({ userId, email: `${TAG}@example.test` }, JWT_SECRET, {
    expiresIn: "1h",
  });
  return `access_token=${token}`;
}

let app: ReturnType<typeof buildTestAppWithRouters>;
let feCookie: string; // owns yse_front_end only
let ownerCookie: string; // owns yse_21_day_blitz
let adminCookie: string;
let feUserId: number;
let ownerUserId: number;

beforeAll(async () => {
  app = buildTestAppWithRouters([blitzLessonsRouter, courseProgressRouter]);
  feUserId = await seedUser("member");
  await grant(feUserId, "yse_front_end");
  ownerUserId = await seedUser("member");
  await grant(ownerUserId, "yse_21_day_blitz");
  const adminId = await seedUser("admin");
  feCookie = cookieFor(feUserId);
  ownerCookie = cookieFor(ownerUserId);
  adminCookie = cookieFor(adminId);
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db
      .delete(courseProgressTable)
      .where(inArray(courseProgressTable.userId, seededUserIds));
    await db
      .delete(userProductsTable)
      .where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("Blitz lesson + guide endpoints", () => {
  it("returns 403 CONTENT_NOT_OWNED for a front-end-only member", async () => {
    for (const path of ["/api/blitz/lessons", "/api/blitz/guide"]) {
      const res = await request(app).get(path).set("Cookie", feCookie);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("CONTENT_NOT_OWNED");
      expect(res.body.pageKey).toBe("blitz");
    }
  });

  it("serves a blitz owner", async () => {
    const lessons = await request(app)
      .get("/api/blitz/lessons")
      .set("Cookie", ownerCookie);
    expect(lessons.status).toBe(200);
    const guide = await request(app)
      .get("/api/blitz/guide")
      .set("Cookie", ownerCookie);
    expect(guide.status).toBe(200);
    expect(typeof guide.body.html).toBe("string");
    expect(guide.body.html.length).toBeGreaterThan(10_000);
  });

  it("serves admins via role bypass", async () => {
    const res = await request(app)
      .get("/api/blitz/guide")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
  });

  it("requires auth (401 unauthenticated)", async () => {
    const res = await request(app).get("/api/blitz/guide");
    expect(res.status).toBe(401);
  });
});

describe("archived guide endpoint", () => {
  it("is admin-only: members 403 (even blitz owners), admin 200", async () => {
    for (const cookie of [feCookie, ownerCookie]) {
      const res = await request(app)
        .get("/api/admin/blitz-archive-guide")
        .set("Cookie", cookie);
      expect(res.status).toBe(403);
    }
    const res = await request(app)
      .get("/api/admin/blitz-archive-guide")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(typeof res.body.html).toBe("string");
  });
});

describe("legacy course-progress path enforces Blitz ownership", () => {
  const BLITZ_IDS = ["blitz-hub-step-v2-3", "blitz-hub-step-7", "21-day-blitz"];

  it("rejects blitz course ids on POST for non-owners (all id families)", async () => {
    for (const courseId of BLITZ_IDS) {
      const res = await request(app)
        .post("/api/course-progress")
        .set("Cookie", feCookie)
        .send({ courseId });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("CONTENT_NOT_OWNED");
      expect(res.body.pageKey).toBe("blitz");
    }
  });

  it("rejects blitz course ids on DELETE for non-owners", async () => {
    const res = await request(app)
      .delete("/api/course-progress/blitz-hub-step-v2-3")
      .set("Cookie", feCookie);
    expect(res.status).toBe(403);
  });

  it("still allows non-blitz course ids for front-end members", async () => {
    const res = await request(app)
      .post("/api/course-progress")
      .set("Cookie", feCookie)
      .send({ courseId: "quick-start" });
    expect([200, 201]).toContain(res.status);
    expect(res.body.courseId).toBe("quick-start");
  });

  it("allows blitz course ids for blitz owners", async () => {
    const res = await request(app)
      .post("/api/course-progress")
      .set("Cookie", ownerCookie)
      .send({ courseId: "blitz-hub-step-v2-3" });
    expect([200, 201]).toContain(res.status);
    const del = await request(app)
      .delete("/api/course-progress/blitz-hub-step-v2-3")
      .set("Cookie", ownerCookie);
    expect(del.status).toBe(200);
  });

  it("hides pre-existing blitz rows from GET for non-owners, keeps other rows", async () => {
    // Simulate a row left over from before enforcement (or a revoked grant).
    await db
      .insert(courseProgressTable)
      .values({ userId: feUserId, courseId: "blitz-hub-step-v2-5" })
      .onConflictDoNothing();
    const res = await request(app)
      .get("/api/course-progress")
      .set("Cookie", feCookie);
    expect(res.status).toBe(200);
    const ids = res.body.map((r: { courseId: string }) => r.courseId);
    expect(ids).not.toContain("blitz-hub-step-v2-5");
    expect(ids).toContain("quick-start");
  });
});

describe("fail-closed when the blitz content_access_map row is missing", () => {
  it("denies members (even owners) and passes admins, then restores the row", async () => {
    const [saved] = await db
      .select()
      .from(contentAccessMapTable)
      .where(eq(contentAccessMapTable.pageKey, "blitz"));
    expect(saved).toBeTruthy();
    try {
      await db
        .delete(contentAccessMapTable)
        .where(eq(contentAccessMapTable.pageKey, "blitz"));

      for (const cookie of [feCookie, ownerCookie]) {
        const res = await request(app)
          .get("/api/blitz/lessons")
          .set("Cookie", cookie);
        expect(res.status).toBe(403);
        expect(res.body.error).toBe("CONTENT_NOT_OWNED");
      }
      // course-progress rides the same fail-closed helper.
      const post = await request(app)
        .post("/api/course-progress")
        .set("Cookie", ownerCookie)
        .send({ courseId: "blitz-hub-step-v2-3" });
      expect(post.status).toBe(403);

      const admin = await request(app)
        .get("/api/blitz/lessons")
        .set("Cookie", adminCookie);
      expect(admin.status).toBe(200);
    } finally {
      await db
        .insert(contentAccessMapTable)
        .values({ pageKey: "blitz", productSlugs: saved.productSlugs })
        .onConflictDoNothing();
    }
  });
});
