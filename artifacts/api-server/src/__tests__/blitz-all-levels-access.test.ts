/**
 * Blitz unlocked for all member levels (front-ends + funnel Blitz + every
 * mentorship tier incl. vip).
 *
 * Covers:
 *   1. defaultSlugsForPageKey("blitz") contains the full owner set.
 *   2. ensureBlitzOwnerSlugsRepair is additive + idempotent on an existing
 *      (old-default / admin-edited) row: adds missing defaults, never removes
 *      admin-added slugs, and is a no-op when run twice.
 *   3. The REAL resolver grants `blitz` to a member owning ONLY a front-end
 *      product, and keeps it for a funnel-Blitz-only member.
 *
 * SHARED DEV DB: the pre-existing `blitz` map row is snapshotted in beforeAll
 * and restored verbatim in afterAll. Run vitest with --pool=threads
 * --no-file-parallelism.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

import {
  BLITZ_OWNER_SLUGS,
  defaultSlugsForPageKey,
  ensureBlitzOwnerSlugsRepair,
} from "../lib/seed-content-access-map";
import { getAccessiblePageKeys } from "../lib/content-access-resolver";

const TAG = `blitz-levels-${randomUUID().slice(0, 8)}`;

const FRONTEND_SLUGS = [
  "yse_front_end",
  "backroad",
  "offmarket",
  "reserve_income",
  "silent_partner",
  "test_like_mad",
];
const MENTORSHIP_SLUGS = ["launchpad", "3month", "6month", "1year", "lifetime", "vip"];

const seededUserIds: number[] = [];
let frontEndOnlyUserId: number;
let blitzFunnelOnlyUserId: number;

let preExistingBlitzRow: {
  productSlugs: string[];
  updatedBy: string | null;
} | null = null;

async function readBlitzRow() {
  const [row] = await db
    .select({
      productSlugs: contentAccessMapTable.productSlugs,
      updatedBy: contentAccessMapTable.updatedBy,
    })
    .from(contentAccessMapTable)
    .where(eq(contentAccessMapTable.pageKey, "blitz"));
  return row ?? null;
}

async function setBlitzRow(productSlugs: string[], updatedBy: string) {
  await db
    .insert(contentAccessMapTable)
    .values({ pageKey: "blitz", productSlugs, updatedBy })
    .onConflictDoUpdate({
      target: contentAccessMapTable.pageKey,
      set: { productSlugs, updatedBy, updatedAt: new Date() },
    });
}

beforeAll(async () => {
  preExistingBlitzRow = await readBlitzRow();

  const passwordHash = await bcrypt.hash("irrelevant", 4);

  const [feProduct] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.slug, "backroad"));
  if (!feProduct) throw new Error("backroad product not found in DB");

  const [blitzProduct] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.slug, "yse_21_day_blitz"));
  if (!blitzProduct) throw new Error("yse_21_day_blitz product not found in DB");

  const [feUser] = await db
    .insert(usersTable)
    .values({
      name: "FE Only Blitz Member",
      email: `${TAG}-fe@example.test`,
      passwordHash,
      role: "member",
      sourceProduct: "backroad",
      emailVerified: true,
    })
    .returning();
  seededUserIds.push(feUser.id);
  frontEndOnlyUserId = feUser.id;
  await db.insert(userProductsTable).values({
    userId: feUser.id,
    productId: feProduct.id,
    status: "active",
  });

  const [funnelUser] = await db
    .insert(usersTable)
    .values({
      name: "Funnel Blitz Member",
      email: `${TAG}-funnel@example.test`,
      passwordHash,
      role: "member",
      sourceProduct: "yse_front_end",
      emailVerified: true,
    })
    .returning();
  seededUserIds.push(funnelUser.id);
  blitzFunnelOnlyUserId = funnelUser.id;
  await db.insert(userProductsTable).values({
    userId: funnelUser.id,
    productId: blitzProduct.id,
    status: "active",
  });
});

afterAll(async () => {
  // Restore the blitz row exactly as we found it.
  if (preExistingBlitzRow) {
    await setBlitzRow(
      preExistingBlitzRow.productSlugs,
      preExistingBlitzRow.updatedBy ?? "restore",
    );
  } else {
    await db
      .delete(contentAccessMapTable)
      .where(eq(contentAccessMapTable.pageKey, "blitz"));
  }

  if (seededUserIds.length > 0) {
    await db
      .delete(userProductsTable)
      .where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("defaultSlugsForPageKey('blitz')", () => {
  it("includes every front-end, the funnel Blitz, and every mentorship tier incl. vip", () => {
    const defaults = defaultSlugsForPageKey("blitz");
    for (const slug of [...FRONTEND_SLUGS, "yse_21_day_blitz", ...MENTORSHIP_SLUGS]) {
      expect(defaults).toContain(slug);
    }
    expect(defaults).toEqual([...BLITZ_OWNER_SLUGS]);
  });

  it("does NOT change other pages' defaults (LaunchPad+ pages stay tier-only)", () => {
    const resourceHub = defaultSlugsForPageKey("resource-hub");
    for (const slug of FRONTEND_SLUGS) expect(resourceHub).not.toContain(slug);
  });
});

describe("ensureBlitzOwnerSlugsRepair", () => {
  it("adds missing default slugs to an old-default row while preserving admin-added slugs", async () => {
    // Simulate the pre-change seeded row plus an admin-added custom slug.
    const oldRow = [
      "yse_21_day_blitz",
      "launchpad",
      "3month",
      "6month",
      "1year",
      "lifetime",
      "admin_custom_slug",
    ];
    await setBlitzRow(oldRow, `${TAG}-old`);

    await ensureBlitzOwnerSlugsRepair();

    const row = await readBlitzRow();
    expect(row).not.toBeNull();
    for (const slug of BLITZ_OWNER_SLUGS) expect(row!.productSlugs).toContain(slug);
    // Additive only — the admin's custom slug survives.
    expect(row!.productSlugs).toContain("admin_custom_slug");
  });

  it("is idempotent — a second run changes nothing", async () => {
    const before = await readBlitzRow();
    await ensureBlitzOwnerSlugsRepair();
    const after = await readBlitzRow();
    expect(after!.productSlugs).toEqual(before!.productSlugs);
    expect(after!.updatedBy).toEqual(before!.updatedBy);
  });
});

describe("resolver grants blitz across member levels", () => {
  beforeAll(async () => {
    // Ensure the row holds exactly the new defaults for these assertions.
    await setBlitzRow([...BLITZ_OWNER_SLUGS], `${TAG}-defaults`);
  });

  it("a member owning ONLY a front-end product gets `blitz`", async () => {
    const accessible = await getAccessiblePageKeys(frontEndOnlyUserId);
    expect(accessible).toContain("blitz");
  });

  it("a funnel-Blitz-only member keeps `blitz`", async () => {
    const accessible = await getAccessiblePageKeys(blitzFunnelOnlyUserId);
    expect(accessible).toContain("blitz");
  });
});
