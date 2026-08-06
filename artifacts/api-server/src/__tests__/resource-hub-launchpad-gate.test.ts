/**
 * Resource Hub LaunchPad+ gating (view-only hub task)
 *
 * Locks in:
 *   1. The boot-seed default for `resource-hub` is mentorship tiers only
 *      (LaunchPad and above) — no front-end or funnel slugs.
 *   2. The one-time tighten repair strips front-end/funnel slugs from an
 *      already-seeded resource-hub row, is marker-gated (admin edits AFTER
 *      it ran are never clobbered), and never touches mentorship slugs.
 *   3. End-to-end resolver checks against the REAL getAccessiblePageKeys:
 *      a front-end-only member is denied `resource-hub`, a LaunchPad member
 *      is allowed, and an admin bypasses.
 *
 * SHARED DEV DB — run vitest with --pool=threads --no-file-parallelism.
 * The resource-hub map row and the tighten marker are snapshotted and
 * restored so live browsing/other suites aren't left with mutated state.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  contentAccessMapTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { defaultSlugsForPageKey } from "../lib/seed-content-access-map";
import { ensureResourceHubLaunchpadTighten } from "../lib/resource-hub-setup";
import { getAccessiblePageKeys } from "../lib/content-access-resolver";

const HUB_KEY = "resource-hub";
const MARKER = "resource_hub_launchpad_tighten_2026_08";
const MENTORSHIP = ["launchpad", "3month", "6month", "1year", "lifetime"];
const TAG = `rh-gate-${randomUUID().slice(0, 8)}`;

let preExistingHubRow: { productSlugs: string[]; updatedBy: string | null } | null = null;
let preExistingMarker: unknown | null = null;
const seededUserIds: number[] = [];
let frontEndUserId: number;
let launchpadUserId: number;
let adminUserId: number;

async function clearMarker() {
  await db.execute(sql`DELETE FROM system_settings WHERE key = ${MARKER}`);
}

async function setHubRow(productSlugs: string[], updatedBy: string) {
  await db
    .insert(contentAccessMapTable)
    .values({ pageKey: HUB_KEY, productSlugs, updatedBy })
    .onConflictDoUpdate({
      target: contentAccessMapTable.pageKey,
      set: { productSlugs, updatedBy, updatedAt: new Date() },
    });
}

async function getHubRow() {
  const [row] = await db
    .select({
      productSlugs: contentAccessMapTable.productSlugs,
      updatedBy: contentAccessMapTable.updatedBy,
    })
    .from(contentAccessMapTable)
    .where(eq(contentAccessMapTable.pageKey, HUB_KEY));
  return row ?? null;
}

beforeAll(async () => {
  preExistingHubRow = await getHubRow();
  const markerRes = await db.execute(
    sql`SELECT value FROM system_settings WHERE key = ${MARKER}`,
  );
  const rows = (markerRes as unknown as { rows: Array<{ value: unknown }> }).rows;
  preExistingMarker = rows.length > 0 ? rows[0].value : null;

  const productBySlug = async (slug: string) => {
    const [p] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(eq(productsTable.slug, slug));
    if (!p) throw new Error(`product ${slug} not found in DB`);
    return p.id;
  };
  const yseId = await productBySlug("yse_front_end");
  const launchpadId = await productBySlug("launchpad");

  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const mkUser = async (name: string, role: string, sourceProduct: string) => {
    const [u] = await db
      .insert(usersTable)
      .values({
        name,
        email: `${TAG}-${name.toLowerCase().replace(/\s+/g, "-")}@example.test`,
        passwordHash,
        role,
        sourceProduct,
        emailVerified: true,
      })
      .returning();
    seededUserIds.push(u.id);
    return u.id;
  };
  frontEndUserId = await mkUser("FrontEnd Member", "member", "yse_front_end");
  launchpadUserId = await mkUser("LaunchPad Member", "member", "launchpad");
  adminUserId = await mkUser("Admin User", "admin", "lifetime");

  await db.insert(userProductsTable).values([
    { userId: frontEndUserId, productId: yseId, status: "active" },
    { userId: launchpadUserId, productId: launchpadId, status: "active" },
  ]);
});

afterAll(async () => {
  // Restore hub row.
  if (preExistingHubRow) {
    await setHubRow(preExistingHubRow.productSlugs, preExistingHubRow.updatedBy ?? "restore");
  } else {
    await db.delete(contentAccessMapTable).where(eq(contentAccessMapTable.pageKey, HUB_KEY));
  }
  // Restore marker.
  await clearMarker();
  if (preExistingMarker !== null) {
    await db.execute(sql`
      INSERT INTO system_settings (key, value)
      VALUES (${MARKER}, ${JSON.stringify(preExistingMarker)})
      ON CONFLICT (key) DO NOTHING`);
  }
  if (seededUserIds.length > 0) {
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("seed default — resource-hub is LaunchPad+ only", () => {
  it("defaultSlugsForPageKey('resource-hub') is exactly the five mentorship tiers", () => {
    expect([...defaultSlugsForPageKey(HUB_KEY)].sort()).toEqual([...MENTORSHIP].sort());
  });
});

describe("ensureResourceHubLaunchpadTighten (one-time boot repair)", () => {
  it("strips front-end and funnel slugs, keeps mentorship slugs, records the marker", async () => {
    await clearMarker();
    await setHubRow(
      ["yse_front_end", "backroad", "yse_21_day_blitz", ...MENTORSHIP],
      `${TAG}-pre`,
    );

    await ensureResourceHubLaunchpadTighten();

    const row = await getHubRow();
    expect(row?.productSlugs).toEqual(MENTORSHIP);
    expect(row?.updatedBy).toBe("boot:resource-hub-launchpad-tighten");

    const marker = await db.execute(sql`SELECT value FROM system_settings WHERE key = ${MARKER}`);
    expect((marker as unknown as { rows: unknown[] }).rows.length).toBe(1);
  });

  it("is marker-gated: admin edits AFTER the repair ran are never clobbered", async () => {
    // Marker exists from the previous test. Admin deliberately re-opens the
    // hub to a front-end product.
    await setHubRow(["yse_front_end", ...MENTORSHIP], `${TAG}-admin`);

    await ensureResourceHubLaunchpadTighten();

    const row = await getHubRow();
    expect(row?.productSlugs).toEqual(["yse_front_end", ...MENTORSHIP]);
    expect(row?.updatedBy).toBe(`${TAG}-admin`);
  });

  it("no-ops gracefully when no resource-hub row exists (fresh env; still records marker)", async () => {
    await clearMarker();
    await db.delete(contentAccessMapTable).where(eq(contentAccessMapTable.pageKey, HUB_KEY));

    await ensureResourceHubLaunchpadTighten();

    expect(await getHubRow()).toBeNull();
    const marker = await db.execute(sql`SELECT value FROM system_settings WHERE key = ${MARKER}`);
    expect((marker as unknown as { rows: unknown[] }).rows.length).toBe(1);
  });
});

describe("resolver end-to-end — LaunchPad+ policy", () => {
  beforeAll(async () => {
    await setHubRow([...MENTORSHIP], `${TAG}-resolver`);
  });

  it("a front-end-only member is DENIED resource-hub", async () => {
    const keys = await getAccessiblePageKeys(frontEndUserId);
    expect(keys).not.toContain(HUB_KEY);
  });

  it("a LaunchPad member is ALLOWED resource-hub", async () => {
    const keys = await getAccessiblePageKeys(launchpadUserId);
    expect(keys).toContain(HUB_KEY);
  });

  it("an admin bypasses the gate", async () => {
    const keys = await getAccessiblePageKeys(adminUserId);
    expect(keys).toContain(HUB_KEY);
  });
});
