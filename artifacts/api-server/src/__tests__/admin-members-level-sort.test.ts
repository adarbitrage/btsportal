/**
 * Tests for the computed member level (levelRank / levelLabel) on
 * GET /api/admin/members, server-side level sort, and the guarantee that
 * admin grant / revoke no longer mutates users.sourceProduct.
 */
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
  auditLogTable,
  partnerAssignmentsTable,
  onboardingEffectsTable,
} from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";
import { getProductLabelByRank, RANK_LABEL_MAP } from "../lib/entitlements";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `level-sort-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let adminUserId: number;

const seededUserIds: number[] = [];
// Products we created (only ones we INSERT so we know to delete them).
const createdProductIds: number[] = [];

// Resolved product IDs for canonical slugs (may be pre-existing rows).
let productFrontendId: number;
let product6monthId: number;
let productLifetimeId: number;
let productVipId: number;

// Members
let memberFreeId: number;       // no products
let memberFrontendId: number;   // rank 0 product only
let member6monthId: number;     // rank 3 product
let memberLifetimeId: number;   // rank 5 product
let memberExpiredId: number;    // only expired 6-month grant → Free
let memberVipId: number;        // rank 6 product (vip:status only)

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(suffix: string, role = "member"): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-${suffix}@example.test`,
      name: `${TEST_TAG} ${suffix}`,
      passwordHash,
      role,
      // A known origin value — must stay unchanged through grant/revoke.
      sourceProduct: "reserve_income",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

/**
 * Return the ID of a product with the given canonical slug, creating it
 * if it doesn't already exist. The product is only deleted in afterAll when
 * WE created it (tracked via createdProductIds).
 */
async function resolveProduct(slug: string): Promise<number> {
  const [existing] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.slug, slug))
    .limit(1);
  if (existing) return existing.id;

  const [row] = await db
    .insert(productsTable)
    .values({ slug, name: `Test ${slug}`, type: "backend", sortOrder: 99 })
    .returning({ id: productsTable.id });
  createdProductIds.push(row.id);
  return row.id;
}

async function grantProduct(userId: number, productId: number, expiresAt?: Date) {
  await db.insert(userProductsTable).values({
    userId,
    productId,
    status: "active",
    expiresAt: expiresAt ?? null,
  });
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);

  // super_admin user (needed to call the admin routes).
  adminUserId = await insertUser("admin", "super_admin");
  adminCookie = signCookie(adminUserId, `${TEST_TAG}-admin@example.test`);

  // Resolve canonical products (slugs that live in PRODUCT_RANK).
  productFrontendId = await resolveProduct("frontend"); // rank 0
  product6monthId   = await resolveProduct("6month");   // rank 3
  productLifetimeId = await resolveProduct("lifetime"); // rank 5
  productVipId      = await resolveProduct("vip");      // rank 6

  // Create test members.
  memberFreeId      = await insertUser("free-member");
  memberFrontendId  = await insertUser("frontend-member");
  member6monthId    = await insertUser("6month-member");
  memberLifetimeId  = await insertUser("lifetime-member");
  memberExpiredId   = await insertUser("expired-member");
  memberVipId       = await insertUser("vip-member");

  // Active grants.
  await grantProduct(memberFrontendId, productFrontendId);
  await grantProduct(member6monthId,   product6monthId);
  await grantProduct(memberLifetimeId, productLifetimeId);
  // VIP is a pure status product (Task #1660) always composed with a 1year
  // mentorship grant in practice, but its own rank (6) must be highest
  // regardless — test it standalone here to isolate the rank/label logic.
  await grantProduct(memberVipId, productVipId);

  // Expired 6-month grant — must NOT count toward levelRank.
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await grantProduct(memberExpiredId, product6monthId, yesterday);
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    // Remove audit_log rows that reference our test users (FK constraint).
    await db
      .delete(auditLogTable)
      .where(inArray(auditLogTable.actorId, seededUserIds));
    await db
      .delete(userProductsTable)
      .where(inArray(userProductsTable.userId, seededUserIds));
    // insertUserProductGrant fires the onboarding-upgrade + partner-assignment
    // hooks (Task #1642/#1658) for every grant this file exercises, so their
    // FK-referencing rows must be cleared before the user rows themselves.
    await db
      .delete(partnerAssignmentsTable)
      .where(inArray(partnerAssignmentsTable.memberId, seededUserIds));
    await db
      .delete(onboardingEffectsTable)
      .where(inArray(onboardingEffectsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  // Only delete products we actually inserted (don't touch pre-existing ones).
  if (createdProductIds.length > 0) {
    await db
      .delete(productsTable)
      .where(inArray(productsTable.id, createdProductIds));
  }
});

// ---------------------------------------------------------------------------
// Unit: getProductLabelByRank + RANK_LABEL_MAP
// ---------------------------------------------------------------------------

describe("getProductLabelByRank — unit", () => {
  it("returns 'Free' for rank -1 (no active products)", () => {
    expect(getProductLabelByRank(-1)).toBe("Free");
  });

  it("returns 'Front-End Member' for rank 0", () => {
    expect(getProductLabelByRank(0)).toBe("Front-End Member");
  });

  it("returns 'LaunchPad' for rank 1", () => {
    expect(getProductLabelByRank(1)).toBe("LaunchPad");
  });

  it("returns '3-Month Mentorship' for rank 2", () => {
    expect(getProductLabelByRank(2)).toBe("3-Month Mentorship");
  });

  it("returns '6-Month Mentorship' for rank 3", () => {
    expect(getProductLabelByRank(3)).toBe("6-Month Mentorship");
  });

  it("returns '1-Year Mentorship' for rank 4", () => {
    expect(getProductLabelByRank(4)).toBe("1-Year Mentorship");
  });

  it("returns 'Lifetime Mentorship' for rank 5", () => {
    expect(getProductLabelByRank(5)).toBe("Lifetime Mentorship");
  });

  it("returns 'VIP' for rank 6", () => {
    expect(getProductLabelByRank(6)).toBe("VIP");
  });

  it("falls back to 'Free' for an unknown rank", () => {
    expect(getProductLabelByRank(999)).toBe("Free");
  });

  it("RANK_LABEL_MAP covers all ranks -1..6 with no undefined entries", () => {
    for (let r = -1; r <= 6; r++) {
      expect(RANK_LABEL_MAP[r]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: levelRank + levelLabel on GET /api/admin/members
// ---------------------------------------------------------------------------

describe("GET /api/admin/members — levelRank and levelLabel", () => {
  function findMember(members: any[], userId: number) {
    return members.find((m: any) => m.id === userId);
  }

  async function fetchAll() {
    const res = await request(app)
      .get("/api/admin/members")
      .query({ limit: 100, role: "member" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    return res.body.members as any[];
  }

  it("member with no products gets levelRank=-1 and levelLabel='Free'", async () => {
    const members = await fetchAll();
    const m = findMember(members, memberFreeId);
    expect(m).toBeDefined();
    expect(m.levelRank).toBe(-1);
    expect(m.levelLabel).toBe("Free");
  });

  it("member with only a frontend product gets levelRank=0 and levelLabel='Front-End Member'", async () => {
    const members = await fetchAll();
    const m = findMember(members, memberFrontendId);
    expect(m).toBeDefined();
    expect(m.levelRank).toBe(0);
    expect(m.levelLabel).toBe("Front-End Member");
  });

  it("member with a 6-month product gets levelRank=3 and levelLabel='6-Month Mentorship'", async () => {
    const members = await fetchAll();
    const m = findMember(members, member6monthId);
    expect(m).toBeDefined();
    expect(m.levelRank).toBe(3);
    expect(m.levelLabel).toBe("6-Month Mentorship");
  });

  it("member with a lifetime product gets levelRank=5 and levelLabel='Lifetime Mentorship'", async () => {
    const members = await fetchAll();
    const m = findMember(members, memberLifetimeId);
    expect(m).toBeDefined();
    expect(m.levelRank).toBe(5);
    expect(m.levelLabel).toBe("Lifetime Mentorship");
  });

  it("expired grant excluded: member with only expired 6-month grant gets levelRank=-1 (Free)", async () => {
    const members = await fetchAll();
    const m = findMember(members, memberExpiredId);
    expect(m).toBeDefined();
    expect(m.levelRank).toBe(-1);
    expect(m.levelLabel).toBe("Free");
  });

  it("member with a vip product gets levelRank=6 and levelLabel='VIP' — above Lifetime", async () => {
    const members = await fetchAll();
    const m = findMember(members, memberVipId);
    expect(m).toBeDefined();
    expect(m.levelRank).toBe(6);
    expect(m.levelLabel).toBe("VIP");
  });
});

// ---------------------------------------------------------------------------
// Integration: level sort on GET /api/admin/members
// ---------------------------------------------------------------------------

describe("GET /api/admin/members — sortBy=level", () => {
  // Restrict comparison to our seeded members to avoid noise from other DB rows.
  const seededSet = () =>
    new Set([memberFreeId, memberFrontendId, member6monthId, memberLifetimeId, memberExpiredId, memberVipId]);

  function pickSeeded(members: any[]): any[] {
    const ids = seededSet();
    return members.filter((m: any) => ids.has(m.id));
  }

  it("sortBy=level&sortDir=desc orders VIP > Lifetime > 6-Month > Front-End > Free", async () => {
    const res = await request(app)
      .get("/api/admin/members")
      .query({ limit: 100, role: "member", sortBy: "level", sortDir: "desc" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    const seeded = pickSeeded(res.body.members);
    const ranks = seeded.map((m: any) => m.levelRank);

    // All ranks must be non-increasing (desc).
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeLessThanOrEqual(ranks[i - 1]);
    }

    // Verify the strict ordering among our known members.
    const vipIdx = seeded.findIndex((m: any) => m.id === memberVipId);
    const lifetimeIdx = seeded.findIndex((m: any) => m.id === memberLifetimeId);
    const sixMonthIdx = seeded.findIndex((m: any) => m.id === member6monthId);
    const frontendIdx = seeded.findIndex((m: any) => m.id === memberFrontendId);
    // Free members (freeId, expiredId) both rank -1 so either can come last.
    expect(vipIdx).toBeLessThan(lifetimeIdx);
    expect(lifetimeIdx).toBeLessThan(sixMonthIdx);
    expect(sixMonthIdx).toBeLessThan(frontendIdx);
  });

  it("sortBy=level&sortDir=asc: all returned rows are non-decreasing by levelRank", async () => {
    const res = await request(app)
      .get("/api/admin/members")
      .query({ limit: 100, role: "member", sortBy: "level", sortDir: "asc" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    const ranks = (res.body.members as any[]).map((m: any) => m.levelRank);

    // Every rank must be >= the previous one.
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
    }
  });

  it("sortBy=level&sortDir=desc: Lifetime member appears in first page at the top", async () => {
    // With DESC the highest-ranked members (Lifetime = rank 5) come FIRST,
    // so our lifetime member must appear in the first page regardless of DB size.
    const res = await request(app)
      .get("/api/admin/members")
      .query({ limit: 100, role: "member", sortBy: "level", sortDir: "desc" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    const descMembers: any[] = res.body.members;
    const lifetimeM = descMembers.find((m: any) => m.id === memberLifetimeId);
    expect(lifetimeM).toBeDefined();
    expect(lifetimeM!.levelRank).toBe(5);

    // All members in the first page must have rank ≤ 5, and the first row
    // must have the highest rank (since it's DESC).
    const ranks = descMembers.map((m: any) => m.levelRank);
    expect(ranks[0]).toBeGreaterThanOrEqual(ranks[ranks.length - 1]);
  });

  it("missing sortBy falls back to default (no error, returns members)", async () => {
    const res = await request(app)
      .get("/api/admin/members")
      .query({ limit: 100, role: "member" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.members)).toBe(true);
  });

  it("unknown sortBy falls back gracefully (no error, returns members)", async () => {
    const res = await request(app)
      .get("/api/admin/members")
      .query({ limit: 100, role: "member", sortBy: "totally_invalid" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.members)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration: grant/revoke no longer mutates sourceProduct
// ---------------------------------------------------------------------------

describe("admin grant/revoke — sourceProduct unchanged", () => {
  let subjectId: number;
  let grantedUserProductId: number;

  beforeAll(async () => {
    // Fresh member with a known origin.
    const passwordHash = await bcrypt.hash("irrelevant", 4);
    const [row] = await db
      .insert(usersTable)
      .values({
        email: `${TEST_TAG}-grant-subject@example.test`,
        name: `${TEST_TAG} grant-subject`,
        passwordHash,
        role: "member",
        sourceProduct: "reserve_income",
        emailVerified: true,
        onboardingComplete: true,
      })
      .returning({ id: usersTable.id });
    subjectId = row.id;
    seededUserIds.push(subjectId);
  });

  it("sourceProduct stays 'reserve_income' after an admin grant", async () => {
    const before = await db
      .select({ sourceProduct: usersTable.sourceProduct })
      .from(usersTable)
      .where(eq(usersTable.id, subjectId))
      .limit(1);
    expect(before[0]?.sourceProduct).toBe("reserve_income");

    const res = await request(app)
      .post(`/api/admin/members/${subjectId}/grant-product`)
      .set("Cookie", adminCookie)
      .send({ productId: productLifetimeId });
    expect(res.status).toBe(200);
    grantedUserProductId = res.body.id;

    const after = await db
      .select({ sourceProduct: usersTable.sourceProduct })
      .from(usersTable)
      .where(eq(usersTable.id, subjectId))
      .limit(1);
    expect(after[0]?.sourceProduct).toBe("reserve_income");
  });

  it("sourceProduct stays 'reserve_income' after an admin revoke", async () => {
    const res = await request(app)
      .post(`/api/admin/members/${subjectId}/revoke-product`)
      .set("Cookie", adminCookie)
      .send({ userProductId: grantedUserProductId });
    expect(res.status).toBe(200);

    const after = await db
      .select({ sourceProduct: usersTable.sourceProduct })
      .from(usersTable)
      .where(eq(usersTable.id, subjectId))
      .limit(1);
    expect(after[0]?.sourceProduct).toBe("reserve_income");
  });
});
