/**
 * Content-access gating end-to-end test
 *
 * Exercises the REAL `getAccessiblePageKeys` resolver and the REAL
 * POST /api/admin/content-access (upsert/delete) route — no reimplementation
 * of gating logic inside this file.
 *
 * Assertions:
 *   1. Open-by-default     — an unmapped page is accessible to a member with no products.
 *   2. Gated / allowed     — a ["6month"]-mapped page is blocked for a yse_front_end-only
 *                            member and allowed for a 6month-owning member.
 *   3. Admin/coach bypass  — an admin gets every registry page key back.
 *   4. Empty-array delete  — POST { productSlugs: [] } through the real route deletes the
 *                            row, reverting the page to open-by-default.
 *   5. Expired-grant scope — a member with an active-status but past-expiresAt 6month grant
 *                            does NOT get the gated page.
 *
 * Isolation:
 *   - Canonical product rows are looked up by slug, never inserted.
 *   - Any pre-existing content_access_map row for GATED_PAGE is snapshotted in
 *     beforeAll and restored (not deleted) in afterAll, so we never drop state
 *     we did not create.
 *   - OPEN_PAGE is verified to have no mapping at setup time; if one exists the
 *     suite throws rather than producing a false green.
 *   - All seeded users and user_products rows are deleted in afterAll.
 */

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
  contentAccessMapTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import contentAccessRouter from "../routes/content-access";
import { getAccessiblePageKeys } from "../lib/content-access-resolver";
import { GATEABLE_PAGE_KEYS } from "@workspace/content-access-registry";

// ── Constants ─────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `ca-gating-${randomUUID().slice(0, 8)}`;

/** Page that will be mapped to ["6month"] during tests. */
const GATED_PAGE = "tips-and-tricks";

/** Page that will never have a content_access_map row — open by default. */
const OPEN_PAGE = "affiliate-networks";

// ── Test state ────────────────────────────────────────────────────────────────

const seededUserIds: number[] = [];

let noProductUserId: number;
let frontEndOnlyUserId: number;
let sixMonthUserId: number;
let adminUserId: number;
let expiredSixMonthUserId: number;

let sixMonthProductId: number;
let yseFrontEndProductId: number;

let adminCookie: string;

let app: ReturnType<typeof buildTestAppWithRouters>;

/**
 * Snapshot of the GATED_PAGE row that existed before this suite ran (if any).
 * Restored verbatim in afterAll so we never drop state we didn't create.
 */
let preExistingGatedPageRow: {
  productSlugs: string[];
  updatedBy: string | null;
} | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

/** Upsert a ["6month"] mapping for GATED_PAGE (idempotent). */
async function gatePageFor6Month(tag: string): Promise<void> {
  await db
    .insert(contentAccessMapTable)
    .values({ pageKey: GATED_PAGE, productSlugs: ["6month"], updatedBy: tag })
    .onConflictDoUpdate({
      target: contentAccessMapTable.pageKey,
      set: {
        productSlugs: ["6month"],
        updatedBy: tag,
        updatedAt: new Date(),
      },
    });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  app = buildTestAppWithRouters([contentAccessRouter]);

  // -- Precondition: OPEN_PAGE must not already be mapped ----------------------
  const [openPageRow] = await db
    .select({ id: contentAccessMapTable.id })
    .from(contentAccessMapTable)
    .where(eq(contentAccessMapTable.pageKey, OPEN_PAGE));
  if (openPageRow) {
    throw new Error(
      `${OPEN_PAGE} already has a content_access_map row — cannot use it as the ` +
        `open-by-default control; choose a different OPEN_PAGE constant.`,
    );
  }

  // -- Snapshot any existing GATED_PAGE row so we can restore it in afterAll --
  const [existingGatedRow] = await db
    .select({
      productSlugs: contentAccessMapTable.productSlugs,
      updatedBy: contentAccessMapTable.updatedBy,
    })
    .from(contentAccessMapTable)
    .where(eq(contentAccessMapTable.pageKey, GATED_PAGE));
  preExistingGatedPageRow = existingGatedRow ?? null;

  // -- Look up canonical products (never insert duplicates) --------------------
  const [sixMonthProduct] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.slug, "6month"));
  if (!sixMonthProduct) throw new Error("6month product not found in DB");
  sixMonthProductId = sixMonthProduct.id;

  const [yseProduct] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.slug, "yse_front_end"));
  if (!yseProduct) throw new Error("yse_front_end product not found in DB");
  yseFrontEndProductId = yseProduct.id;

  const passwordHash = await bcrypt.hash("irrelevant", 4);

  // -- Seed test users ---------------------------------------------------------
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

  const [frontEndUser] = await db
    .insert(usersTable)
    .values({
      name: "Front End Only Member",
      email: `${TAG}-frontend@example.test`,
      passwordHash,
      role: "member",
      sourceProduct: "yse_front_end",
      emailVerified: true,
    })
    .returning();
  seededUserIds.push(frontEndUser.id);
  frontEndOnlyUserId = frontEndUser.id;

  const [sixMonthUser] = await db
    .insert(usersTable)
    .values({
      name: "Six Month Member",
      email: `${TAG}-sixmonth@example.test`,
      passwordHash,
      role: "member",
      sourceProduct: "6month",
      emailVerified: true,
    })
    .returning();
  seededUserIds.push(sixMonthUser.id);
  sixMonthUserId = sixMonthUser.id;

  const [adminUser] = await db
    .insert(usersTable)
    .values({
      name: "Admin User",
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

  const [expiredUser] = await db
    .insert(usersTable)
    .values({
      name: "Expired Grant Member",
      email: `${TAG}-expired@example.test`,
      passwordHash,
      role: "member",
      sourceProduct: "6month",
      emailVerified: true,
    })
    .returning();
  seededUserIds.push(expiredUser.id);
  expiredSixMonthUserId = expiredUser.id;

  // -- Seed user_products grants -----------------------------------------------
  await db.insert(userProductsTable).values({
    userId: frontEndOnlyUserId,
    productId: yseFrontEndProductId,
    status: "active",
  });

  await db.insert(userProductsTable).values({
    userId: sixMonthUserId,
    productId: sixMonthProductId,
    status: "active",
  });

  // Active status but expiry in the past — isolates the expiry-filter branch.
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db.insert(userProductsTable).values({
    userId: expiredSixMonthUserId,
    productId: sixMonthProductId,
    status: "active",
    expiresAt: pastDate,
  });

  // -- Seed the content_access_map row for GATED_PAGE -------------------------
  await gatePageFor6Month(`${TAG}-setup`);
});

// ── Teardown ──────────────────────────────────────────────────────────────────

afterAll(async () => {
  // Restore GATED_PAGE to its pre-test state.
  if (preExistingGatedPageRow) {
    // A row existed before we ran — restore it rather than deleting it.
    await db
      .update(contentAccessMapTable)
      .set({
        productSlugs: preExistingGatedPageRow.productSlugs,
        updatedBy: preExistingGatedPageRow.updatedBy,
        updatedAt: new Date(),
      })
      .where(eq(contentAccessMapTable.pageKey, GATED_PAGE));
  } else {
    // We created the row — remove it (delete is idempotent if assertion 4
    // already removed it and assertion 5 re-inserted it).
    await db
      .delete(contentAccessMapTable)
      .where(eq(contentAccessMapTable.pageKey, GATED_PAGE));
  }

  // Remove user_products then users (leave canonical products untouched).
  if (seededUserIds.length > 0) {
    await db
      .delete(userProductsTable)
      .where(inArray(userProductsTable.userId, seededUserIds));
    await db
      .delete(usersTable)
      .where(inArray(usersTable.id, seededUserIds));
  }
});

// ── Assertion 1: Open-by-default ──────────────────────────────────────────────

describe("Assertion 1 — open-by-default", () => {
  it("an unmapped page is accessible to a member with no products", async () => {
    const accessible = await getAccessiblePageKeys(noProductUserId);
    expect(accessible).toContain(OPEN_PAGE);
  });
});

// ── Assertion 2: Gated page blocks / allows ───────────────────────────────────

describe("Assertion 2 — gated page blocks and allows", () => {
  it("a front-end-only member does NOT get the 6month-gated page", async () => {
    const accessible = await getAccessiblePageKeys(frontEndOnlyUserId);
    expect(accessible).not.toContain(GATED_PAGE);
  });

  it("a 6month-owning member DOES get the 6month-gated page", async () => {
    const accessible = await getAccessiblePageKeys(sixMonthUserId);
    expect(accessible).toContain(GATED_PAGE);
  });
});

// ── Assertion 3: Admin bypass ─────────────────────────────────────────────────

describe("Assertion 3 — admin bypass", () => {
  it("an admin gets every registry page key back", async () => {
    const accessible = await getAccessiblePageKeys(adminUserId);
    const expectedKeys = [...GATEABLE_PAGE_KEYS].sort();
    expect([...accessible].sort()).toEqual(expectedKeys);
  });
});

// ── Assertion 4: Empty-array reverts via the real route ───────────────────────

describe("Assertion 4 — empty-array delete via real POST route", () => {
  it("the page is gated before sending the empty-array POST", async () => {
    const accessible = await getAccessiblePageKeys(noProductUserId);
    expect(accessible).not.toContain(GATED_PAGE);
  });

  it("POSTing productSlugs:[] through the real route returns deleted:true", async () => {
    const res = await request(app)
      .post("/api/admin/content-access")
      .set("Cookie", adminCookie)
      .send({ pageKey: GATED_PAGE, productSlugs: [] });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, deleted: true, pageKey: GATED_PAGE });
  });

  it("after the empty-array POST the resolver returns the page as open again", async () => {
    const accessible = await getAccessiblePageKeys(noProductUserId);
    expect(accessible).toContain(GATED_PAGE);
  });
});

// ── Assertion 5: Expired-grant scoping ───────────────────────────────────────

describe("Assertion 5 — active-status but past-expiresAt grant is excluded", () => {
  // Assertion 4 deleted the mapping row via the route; re-gate it so this
  // assertion can test the expiry-filter branch in isolation.
  beforeAll(async () => {
    await gatePageFor6Month(`${TAG}-a5`);
  });

  it("a member with an active-status but past-expiresAt 6month grant does NOT get the gated page", async () => {
    const accessible = await getAccessiblePageKeys(expiredSixMonthUserId);
    expect(accessible).not.toContain(GATED_PAGE);
  });
});
