/**
 * Front-end curriculum enforcement — 403 suites per gated surface.
 *
 * Exercises the REAL requirePageAccess middleware through the REAL routers:
 *   1. /curriculum/<key> (4 keys)         — 401 unauthenticated, 403 for a
 *      no-product member, 200 + content for an owner, 200 for admin bypass.
 *   2. GET /affiliate-networks            — same fail-closed contract.
 *   3. course-progress families           — POST/DELETE 403 for gated course
 *      ids the member doesn't own; GET filters those families out.
 *   4. Prompt-layer guard (task: non-owners never see Blitz section names) —
 *      behavioral: hasPageAccessForUser fails closed for a no-product member;
 *      structural: every buildFuzzyBlitzBlock call site in chat.ts is gated.
 *
 * Isolation: page keys are expected to be mapped by the ownership-gating boot
 * seed; if a key is unmapped the suite THROWS (unmapped = requirePageAccess
 * denies members anyway, but the test should surface seed drift loudly).
 * Seeded users/grants removed in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  contentAccessMapTable,
  courseProgressTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import curriculumRouter from "../routes/curriculum";
import affiliateNetworksRouter from "../routes/admin-affiliate-networks";
import courseProgressRouter, { pageKeyForCourseId } from "../routes/course-progress";
import { hasPageAccessForUser } from "../middleware/require-page-access";
import { CURRICULUM_PAGE_KEYS, CURRICULUM_CONTENT } from "../lib/curriculum-content";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `curriculum-gate-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
let noProductUserId: number;
let ownerUserId: number;
let adminUserId: number;
let noProductCookie: string;
let ownerCookie: string;
let adminCookie: string;

let app: ReturnType<typeof buildTestAppWithRouters>;

/** Page keys that must be mapped for the fail-closed contract to be testable. */
const REQUIRED_KEYS = [...CURRICULUM_PAGE_KEYS];

/** An "owner product" that grants access to every required key. We derive it
 * from the live map rows instead of hardcoding a slug: the first slug shared
 * by all required keys' rows. */
let ownerSlug: string;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([
    curriculumRouter,
    affiliateNetworksRouter,
    courseProgressRouter,
  ]);

  // Every required key must be mapped (boot seed) — throw loudly on drift.
  const rows = await db
    .select({
      pageKey: contentAccessMapTable.pageKey,
      productSlugs: contentAccessMapTable.productSlugs,
    })
    .from(contentAccessMapTable)
    .where(inArray(contentAccessMapTable.pageKey, REQUIRED_KEYS));
  const byKey = new Map(rows.map((r) => [r.pageKey, r.productSlugs]));
  for (const key of REQUIRED_KEYS) {
    if (!byKey.has(key)) {
      throw new Error(
        `content_access_map has no row for "${key}" — ownership-gating boot seed missing; run the api-server boot first.`,
      );
    }
  }

  // Pick a product slug present in EVERY required key's allow-list.
  const slugSets = REQUIRED_KEYS.map((k) => new Set(byKey.get(k)!));
  const candidate = [...slugSets[0]].find((s) => slugSets.every((set) => set.has(s)));
  if (!candidate) {
    throw new Error(
      "No single product slug grants all required curriculum keys — update the test's owner-product derivation.",
    );
  }
  ownerSlug = candidate;

  const [ownerProduct] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.slug, ownerSlug));
  if (!ownerProduct) throw new Error(`Product "${ownerSlug}" not found in DB`);

  const passwordHash = await bcrypt.hash("irrelevant", 4);

  const [noProductUser] = await db
    .insert(usersTable)
    .values({
      name: "No Product Member",
      email: `${TAG}-noproduct@example.test`,
      passwordHash,
      role: "member",
      sourceProduct: "bts",
      emailVerified: true,
    })
    .returning();
  seededUserIds.push(noProductUser.id);
  noProductUserId = noProductUser.id;
  noProductCookie = signCookie(noProductUser.id, noProductUser.email);

  const [ownerUser] = await db
    .insert(usersTable)
    .values({
      name: "Curriculum Owner",
      email: `${TAG}-owner@example.test`,
      passwordHash,
      role: "member",
      sourceProduct: ownerSlug,
      emailVerified: true,
    })
    .returning();
  seededUserIds.push(ownerUser.id);
  ownerUserId = ownerUser.id;
  ownerCookie = signCookie(ownerUser.id, ownerUser.email);
  await db.insert(userProductsTable).values({
    userId: ownerUserId,
    productId: ownerProduct.id,
    status: "active",
  });

  const [adminUser] = await db
    .insert(usersTable)
    .values({
      name: "Curriculum Admin",
      email: `${TAG}-admin@example.test`,
      passwordHash,
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
    })
    .returning();
  seededUserIds.push(adminUser.id);
  adminUserId = adminUser.id;
  adminCookie = signCookie(adminUser.id, adminUser.email);
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

// ── 1. Curriculum endpoints ───────────────────────────────────────────────────

describe("gated curriculum endpoints", () => {
  for (const key of CURRICULUM_PAGE_KEYS) {
    it(`GET /curriculum/${key} → 401 unauthenticated`, async () => {
      const res = await request(app).get(`/api/curriculum/${key}`);
      expect(res.status).toBe(401);
    });

    it(`GET /curriculum/${key} → 403 CONTENT_NOT_OWNED for a no-product member`, async () => {
      const res = await request(app)
        .get(`/api/curriculum/${key}`)
        .set("Cookie", noProductCookie);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("CONTENT_NOT_OWNED");
      expect(res.body.pageKey).toBe(key);
      // Fail-closed body never includes the course content.
      expect(res.body.content).toBeUndefined();
    });

    it(`GET /curriculum/${key} → 200 + content for an owner`, async () => {
      const res = await request(app)
        .get(`/api/curriculum/${key}`)
        .set("Cookie", ownerCookie);
      expect(res.status).toBe(200);
      expect(res.body.content).toEqual(CURRICULUM_CONTENT[key]);
    });

    it(`GET /curriculum/${key} → 200 for admin bypass`, async () => {
      const res = await request(app)
        .get(`/api/curriculum/${key}`)
        .set("Cookie", adminCookie);
      expect(res.status).toBe(200);
    });
  }
});

// ── 2. Affiliate networks member endpoint ─────────────────────────────────────

describe("GET /affiliate-networks gate (page key retired from the registry — fail-closed for everyone)", () => {
  it("403 CONTENT_NOT_OWNED for a no-product member", async () => {
    const res = await request(app)
      .get("/api/affiliate-networks")
      .set("Cookie", noProductCookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("CONTENT_NOT_OWNED");
  });

  it("403 even for a product owner (member content retired)", async () => {
    const res = await request(app)
      .get("/api/affiliate-networks")
      .set("Cookie", ownerCookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("CONTENT_NOT_OWNED");
  });

  it("403 for admin too — the member endpoint is dead; admins use /admin/affiliate-networks", async () => {
    const res = await request(app)
      .get("/api/affiliate-networks")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(403);
  });
});

// ── 3. Course-progress family gating ──────────────────────────────────────────

describe("course-progress enforcement families", () => {
  it("maps gated course-id families to the right page keys", () => {
    expect(pageKeyForCourseId("7-pillars")).toBe("seven-pillars");
    expect(pageKeyForCourseId("quick-start")).toBe("quick-start");
    expect(pageKeyForCourseId("finding-your-edge")).toBe("core-training");
    expect(pageKeyForCourseId("live-coaching")).toBeNull();
    expect(pageKeyForCourseId("21-day-blitz")).toBe("blitz");
  });

  const gatedCourseId = "7-pillars";

  it("POST is 403 for a member without the family's page key", async () => {
    // A no-product member owns NO page keys (fail-closed middleware core).
    const res = await request(app)
      .post("/api/course-progress")
      .set("Cookie", noProductCookie)
      .send({ courseId: gatedCourseId });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("CONTENT_NOT_OWNED");
  });

  it("DELETE is 403 for a member without the family's page key", async () => {
    const res = await request(app)
      .delete(`/api/course-progress/${gatedCourseId}`)
      .set("Cookie", noProductCookie);
    expect(res.status).toBe(403);
  });

  it("POST succeeds for an owner and GET returns the row", async () => {
    const post = await request(app)
      .post("/api/course-progress")
      .set("Cookie", ownerCookie)
      .send({ courseId: gatedCourseId });
    expect(post.status).toBeLessThan(300);

    const get = await request(app)
      .get("/api/course-progress")
      .set("Cookie", ownerCookie);
    expect(get.status).toBe(200);
    const ids = (get.body as Array<{ courseId: string }>).map((r) => r.courseId);
    expect(ids).toContain(gatedCourseId);
  });

  it("GET read-filter hides gated families from a non-owner even if a row exists", async () => {
    // Insert directly (bypassing the write gate) to prove the READ filter.
    await db.insert(courseProgressTable).values({
      userId: noProductUserId,
      courseId: gatedCourseId,
    });
    const res = await request(app)
      .get("/api/course-progress")
      .set("Cookie", noProductCookie);
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ courseId: string }>).map((r) => r.courseId);
    expect(ids).not.toContain(gatedCourseId);
  });

  it("live-coaching stays ungated for any member", async () => {
    const res = await request(app)
      .post("/api/course-progress")
      .set("Cookie", noProductCookie)
      .send({ courseId: "live-coaching" });
    expect(res.status).toBeLessThan(300);
  });
});

// ── 4. Prompt-layer guard: non-owners never get Blitz section pointers ───────

describe("prompt-layer Blitz section pointer guard", () => {
  it("hasPageAccessForUser fails closed for a no-product member on 'blitz'", async () => {
    expect(await hasPageAccessForUser(noProductUserId, "blitz")).toBe(false);
  });

  it("an owner of the gating product family may differ — admin always passes", async () => {
    expect(await hasPageAccessForUser(adminUserId, "blitz")).toBe(true);
  });

  it("every buildFuzzyBlitzBlock call site in chat.ts is ownership-gated", () => {
    const chatSource = readFileSync(
      path.resolve(__dirname, "../routes/chat.ts"),
      "utf8",
    );
    const callSites = chatSource.split("buildFuzzyBlitzBlock(").length - 1;
    // Exclude the import line if present in the count basis.
    const gatedSites = chatSource
      .split("\n")
      .filter((line) => line.includes("buildFuzzyBlitzBlock(") && !line.includes("import"))
      .length;
    expect(gatedSites).toBeGreaterThan(0);
    // Each non-import call site must appear inside an if-block whose condition
    // includes hasPageAccessForUser(userId, "blitz"). Verify by scanning the
    // 6 lines preceding each call site.
    const lines = chatSource.split("\n");
    lines.forEach((line, idx) => {
      if (!line.includes("buildFuzzyBlitzBlock(") || line.includes("import")) return;
      const context = lines.slice(Math.max(0, idx - 6), idx + 1).join("\n");
      expect(
        context.includes('hasPageAccessForUser(userId, "blitz")'),
        `buildFuzzyBlitzBlock call at chat.ts line ${idx + 1} is not gated by hasPageAccessForUser`,
      ).toBe(true);
    });
    expect(callSites).toBeGreaterThanOrEqual(gatedSites);
  });
});
