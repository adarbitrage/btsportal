import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db, contentAccessMapTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { ensureResourceHubAccessMigration } from "../lib/resource-hub-setup";

// The content-access registry replaced three legacy page keys with a single
// `resource-hub` key. Because a MISSING content_access_map row means OPEN
// access, environments that had the legacy pages gated would silently lose
// that restriction on deploy unless the gating is carried forward. This
// suite locks in the boot migration: legacy rows are unioned into the
// resource-hub row and removed, and the whole thing is an idempotent no-op
// once no legacy rows remain.

const LEGACY_KEYS = ["resource-library", "creative-drive", "knowledge-base"];
const HUB_KEY = "resource-hub";
const ALL_KEYS = [...LEGACY_KEYS, HUB_KEY];

async function cleanup() {
  await db.delete(contentAccessMapTable).where(inArray(contentAccessMapTable.pageKey, ALL_KEYS));
}

async function rowsByKey() {
  const rows = await db
    .select()
    .from(contentAccessMapTable)
    .where(inArray(contentAccessMapTable.pageKey, ALL_KEYS));
  return new Map(rows.map((r) => [r.pageKey, r]));
}

describe("ensureResourceHubAccessMigration", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it("unions legacy gate rows into resource-hub and deletes them", async () => {
    await db.insert(contentAccessMapTable).values([
      { pageKey: "resource-library", productSlugs: ["launchpad", "blitz"] },
      { pageKey: "creative-drive", productSlugs: ["blitz", "vip"] },
      { pageKey: "knowledge-base", productSlugs: ["launchpad"] },
    ]);

    await ensureResourceHubAccessMigration();

    const byKey = await rowsByKey();
    for (const key of LEGACY_KEYS) expect(byKey.has(key)).toBe(false);
    expect(byKey.get(HUB_KEY)?.productSlugs).toEqual(["blitz", "launchpad", "vip"]);
  });

  it("merges into an existing resource-hub row (union, admin slugs kept)", async () => {
    await db.insert(contentAccessMapTable).values([
      { pageKey: HUB_KEY, productSlugs: ["1year"] },
      { pageKey: "knowledge-base", productSlugs: ["launchpad"] },
    ]);

    await ensureResourceHubAccessMigration();

    const byKey = await rowsByKey();
    expect(byKey.has("knowledge-base")).toBe(false);
    expect(byKey.get(HUB_KEY)?.productSlugs).toEqual(["1year", "launchpad"]);
  });

  it("is a no-op when no legacy rows exist (does not create or touch the hub row)", async () => {
    await db.insert(contentAccessMapTable).values({ pageKey: HUB_KEY, productSlugs: ["vip"] });
    const before = await db
      .select()
      .from(contentAccessMapTable)
      .where(eq(contentAccessMapTable.pageKey, HUB_KEY));

    await ensureResourceHubAccessMigration();

    const byKey = await rowsByKey();
    expect(byKey.get(HUB_KEY)?.productSlugs).toEqual(["vip"]);
    expect(byKey.get(HUB_KEY)?.updatedAt).toEqual(before[0].updatedAt);
    // No legacy rows resurrected, nothing extra created.
    expect([...byKey.keys()]).toEqual([HUB_KEY]);
  });

  it("is idempotent — a second run changes nothing", async () => {
    await db.insert(contentAccessMapTable).values([
      { pageKey: "resource-library", productSlugs: ["launchpad"] },
    ]);
    await ensureResourceHubAccessMigration();
    const first = await rowsByKey();
    await ensureResourceHubAccessMigration();
    const second = await rowsByKey();
    expect([...second.keys()]).toEqual([...first.keys()]);
    expect(second.get(HUB_KEY)?.productSlugs).toEqual(first.get(HUB_KEY)?.productSlugs);
    expect(second.get(HUB_KEY)?.updatedAt).toEqual(first.get(HUB_KEY)?.updatedAt);
  });

  it("legacy rows with no surviving slugs just get removed (hub stays open)", async () => {
    // Defensive: empty arrays are never persisted by the admin UI, but if a
    // legacy row somehow has none, the hub must not gain a bogus gate row.
    await db.insert(contentAccessMapTable).values({ pageKey: "creative-drive", productSlugs: [] });

    await ensureResourceHubAccessMigration();

    const byKey = await rowsByKey();
    expect(byKey.size).toBe(0);
  });
});
