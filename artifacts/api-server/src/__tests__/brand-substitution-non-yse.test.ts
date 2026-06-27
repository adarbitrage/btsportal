/**
 * Non-YSE brand substitution end-to-end test
 *
 * Proves the full resolution + substitution path for a non-YSE brand
 * (reserve_income) against the real helpers used by tracks.ts and dashboard.ts:
 *   resolveMemberBrand → brandStrings / brandTokens → substituteString / substituteTipTapDoc
 *
 * Assertions:
 *   1. Resolution  — reserve_income member resolves to "reserve_income" and
 *                    brandStrings returns the correct full/short names.
 *   2. Substitution — {{brand}} / {{brand.short}} are replaced with
 *                    Reserve Income strings; output never contains YSE copy.
 *   3. Contrast    — same inputs for a yse_front_end member yield YSE strings.
 *   4. Fallback    — a member with no frontend product resolves to "bts".
 *   5. No double-substitution — substituteTipTapDoc is idempotent; a second
 *                    pass over already-substituted output leaves it unchanged.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { db, usersTable, productsTable, userProductsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  brandStrings,
  brandTokens,
  substituteString,
  substituteTipTapDoc,
} from "@workspace/brand-config";
import { resolveMemberBrand } from "../lib/entitlements";

const TEST_TAG = `brand-sub-test-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];

let reserveIncomeUserId: number;
let yseUserId: number;
let noProductUserId: number;

let reserveIncomeProductId: number;
let yseProductId: number;

beforeAll(async () => {
  // Look up canonical products — they already exist in the DB with the
  // real slugs the BRAND_TABLE uses. We must not insert duplicates.
  const [riProduct] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.slug, "reserve_income"));
  if (!riProduct) throw new Error("reserve_income product not found in DB");
  reserveIncomeProductId = riProduct.id;

  const [yseProduct] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.slug, "yse_front_end"));
  if (!yseProduct) throw new Error("yse_front_end product not found in DB");
  yseProductId = yseProduct.id;

  // Seed three isolated test users.
  const [riUser] = await db
    .insert(usersTable)
    .values({
      name: "RI Member",
      email: `${TEST_TAG}-ri@example.test`,
      passwordHash: await bcrypt.hash("Test1234!", 4),
      role: "member",
      sourceProduct: "reserve_income",
      emailVerified: true,
    })
    .returning();
  seededUserIds.push(riUser.id);
  reserveIncomeUserId = riUser.id;

  const [yseUser] = await db
    .insert(usersTable)
    .values({
      name: "YSE Member",
      email: `${TEST_TAG}-yse@example.test`,
      passwordHash: await bcrypt.hash("Test1234!", 4),
      role: "member",
      sourceProduct: "yse_front_end",
      emailVerified: true,
    })
    .returning();
  seededUserIds.push(yseUser.id);
  yseUserId = yseUser.id;

  const [noProductUser] = await db
    .insert(usersTable)
    .values({
      name: "No-Product Member",
      email: `${TEST_TAG}-noproduct@example.test`,
      passwordHash: await bcrypt.hash("Test1234!", 4),
      role: "member",
      sourceProduct: "bts",
      emailVerified: true,
    })
    .returning();
  seededUserIds.push(noProductUser.id);
  noProductUserId = noProductUser.id;

  // Grant the real canonical products to the test users.
  await db.insert(userProductsTable).values({
    userId: reserveIncomeUserId,
    productId: reserveIncomeProductId,
    status: "active",
  });

  await db.insert(userProductsTable).values({
    userId: yseUserId,
    productId: yseProductId,
    status: "active",
  });
});

afterAll(async () => {
  // Delete user_products rows for our test users, then the users themselves.
  // Do NOT touch the shared canonical products rows.
  if (seededUserIds.length > 0) {
    await db
      .delete(userProductsTable)
      .where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

// ─── Assertion 1: Resolution ──────────────────────────────────────────────────

describe("Assertion 1 — brand resolution", () => {
  it("reserve_income member resolves to 'reserve_income'", async () => {
    const slug = await resolveMemberBrand(reserveIncomeUserId);
    expect(slug).toBe("reserve_income");
  });

  it("brandStrings('reserve_income') returns correct full and short names", () => {
    const strings = brandStrings("reserve_income");
    expect(strings.full).toBe("The Reserve Income System");
    expect(strings.short).toBe("Reserve Income");
  });
});

// ─── Assertion 2: Substitution (non-YSE) ─────────────────────────────────────

describe("Assertion 2 — substitution for reserve_income member", () => {
  it("{{brand}} resolves to 'The Reserve Income System' for the reserve_income member", async () => {
    const slug = await resolveMemberBrand(reserveIncomeUserId);
    const tokens = brandTokens(slug);
    const result = substituteString("Welcome to {{brand}}", tokens);
    expect(result).toBe("Welcome to The Reserve Income System");
    expect(result).not.toContain("Your Second Engine");
  });

  it("{{brand.short}} resolves to 'Reserve Income'", async () => {
    const slug = await resolveMemberBrand(reserveIncomeUserId);
    const tokens = brandTokens(slug);
    const result = substituteString("{{brand.short}}", tokens);
    expect(result).toBe("Reserve Income");
    expect(result).not.toContain("YSE");
  });

  it("output never contains 'Your Second Engine'", async () => {
    const slug = await resolveMemberBrand(reserveIncomeUserId);
    const tokens = brandTokens(slug);
    const result = substituteString(
      "{{brand}} — {{brand.short}} — {{brand.possessive}} — {{brand.short.possessive}}",
      tokens,
    );
    expect(result).not.toContain("Your Second Engine");
    expect(result).toContain("The Reserve Income System");
    expect(result).toContain("Reserve Income");
  });
});

// ─── Assertion 3: Contrast (YSE) ─────────────────────────────────────────────

describe("Assertion 3 — contrast: yse_front_end member yields YSE strings", () => {
  it("yse_front_end member resolves to 'yse_front_end'", async () => {
    const slug = await resolveMemberBrand(yseUserId);
    expect(slug).toBe("yse_front_end");
  });

  it("{{brand}} for YSE member yields 'Your Second Engine'", async () => {
    const slug = await resolveMemberBrand(yseUserId);
    const tokens = brandTokens(slug);
    const result = substituteString("Welcome to {{brand}}", tokens);
    expect(result).toBe("Welcome to Your Second Engine");
  });

  it("{{brand.short}} for YSE member yields 'YSE'", async () => {
    const slug = await resolveMemberBrand(yseUserId);
    const tokens = brandTokens(slug);
    const result = substituteString("{{brand.short}}", tokens);
    expect(result).toBe("YSE");
  });
});

// ─── Assertion 4: Fallback ────────────────────────────────────────────────────

describe("Assertion 4 — fallback for member with no frontend product", () => {
  it("no-product member resolves to 'bts'", async () => {
    const slug = await resolveMemberBrand(noProductUserId);
    expect(slug).toBe("bts");
  });

  it("brandStrings('bts') returns 'Build Test Scale' / 'BTS'", () => {
    const strings = brandStrings("bts");
    expect(strings.full).toBe("Build Test Scale");
    expect(strings.short).toBe("BTS");
  });

  it("{{brand}} for no-product member yields 'Build Test Scale'", async () => {
    const slug = await resolveMemberBrand(noProductUserId);
    const tokens = brandTokens(slug);
    const result = substituteString("Welcome to {{brand}}", tokens);
    expect(result).toBe("Welcome to Build Test Scale");
  });
});

// ─── Assertion 5: No double-substitution ─────────────────────────────────────

describe("Assertion 5 — no double-substitution via substituteTipTapDoc", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "{{brand}}",
          },
        ],
      },
    ],
  };

  it("first pass replaces {{brand}} with the resolved name exactly once", async () => {
    const slug = await resolveMemberBrand(reserveIncomeUserId);
    const tokens = brandTokens(slug);
    const result = substituteTipTapDoc(doc, tokens);
    const textNode = result.content![0].content![0];
    expect(textNode.text).toBe("The Reserve Income System");
    const count = (textNode.text as string).split("The Reserve Income System").length - 1;
    expect(count).toBe(1);
  });

  it("second pass over already-substituted output leaves text unchanged", async () => {
    const slug = await resolveMemberBrand(reserveIncomeUserId);
    const tokens = brandTokens(slug);
    const firstPass = substituteTipTapDoc(doc, tokens);
    const secondPass = substituteTipTapDoc(firstPass, tokens);
    const textAfterFirst = firstPass.content![0].content![0].text;
    const textAfterSecond = secondPass.content![0].content![0].text;
    expect(textAfterSecond).toBe(textAfterFirst);
    expect(textAfterSecond).toBe("The Reserve Income System");
  });
});
