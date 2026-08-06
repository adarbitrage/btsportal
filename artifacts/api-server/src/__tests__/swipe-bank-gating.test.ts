/**
 * Swipe Resource Bank — gating + disclaimer + thumbnail tests (Task #2104).
 *
 * Gating (born-enforced via `swipe-bank` content-access page key):
 *   - no-product member          → 403 on listing AND content proxy
 *   - FE-only (yse_front_end)    → 403 on listing AND content proxy
 *   - bank owner (yse_swipe_resource_bank) → 200 listing; content gate passes
 *   - mentorship tier (6month)   → 200 listing
 *   - admin bypass               → 200 listing + admin overview
 *
 * Also covers: disclaimer default/override round-trip (system_settings) and
 * the sharp thumbnail helper (image → downscaled webp; non-image → null).
 *
 * SHARED DEV DB — run with --pool=threads --no-file-parallelism; the
 * swipe-bank content_access_map row is snapshotted and restored.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import sharp from "sharp";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  contentAccessMapTable,
  systemSettingsTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import swipeBankRouter from "../routes/swipe-bank";
import storageRouter from "../routes/storage";
import { ObjectStorageService } from "../lib/objectStorage";
import { swipeBankItemsTable, swipeBankSubVerticalsTable } from "@workspace/db";
import { SWIPE_BANK_OWNER_SLUGS } from "../lib/seed-content-access-map";
import {
  getSwipeBankDisclaimer,
  setSwipeBankDisclaimer,
  getDefaultSwipeBankDisclaimer,
  SWIPE_BANK_DISCLAIMER_SETTING_KEY,
} from "../lib/swipe-bank-settings";
import {
  generateThumbnail,
  isThumbnailableMime,
  THUMBNAIL_MAX_WIDTH,
} from "../lib/swipe-bank-thumbnails";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `swipe-bank-${randomUUID().slice(0, 8)}`;
const PAGE_KEY = "swipe-bank";

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;

let noProductCookie: string;
let feOnlyCookie: string;
let bankOwnerCookie: string;
let tierMemberCookie: string;
let adminCookie: string;

let preExistingMapRow: { productSlugs: string[]; updatedBy: string | null } | null = null;
let preExistingDisclaimerRow: unknown | undefined;

function signCookie(userId: number, email: string): string {
  return `access_token=${jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" })}`;
}

async function seedUser(
  suffix: string,
  role: string,
  sourceProduct: string,
): Promise<{ id: number; cookie: string }> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [user] = await db
    .insert(usersTable)
    .values({
      name: `Swipe Bank ${suffix}`,
      email: `${TAG}-${suffix}@example.test`,
      passwordHash,
      role,
      sourceProduct,
      emailVerified: true,
    })
    .returning();
  seededUserIds.push(user.id);
  return { id: user.id, cookie: signCookie(user.id, user.email) };
}

async function grantProduct(userId: number, slug: string): Promise<void> {
  const [product] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.slug, slug));
  if (!product) throw new Error(`${slug} product not found in DB`);
  await db.insert(userProductsTable).values({ userId, productId: product.id, status: "active" });
}

beforeAll(async () => {
  app = buildTestAppWithRouters([swipeBankRouter, storageRouter]);

  // Snapshot + enforce the born-enforced map row for the suite duration.
  const [row] = await db
    .select({
      productSlugs: contentAccessMapTable.productSlugs,
      updatedBy: contentAccessMapTable.updatedBy,
    })
    .from(contentAccessMapTable)
    .where(eq(contentAccessMapTable.pageKey, PAGE_KEY));
  preExistingMapRow = row ?? null;
  await db
    .insert(contentAccessMapTable)
    .values({ pageKey: PAGE_KEY, productSlugs: [...SWIPE_BANK_OWNER_SLUGS], updatedBy: TAG })
    .onConflictDoUpdate({
      target: contentAccessMapTable.pageKey,
      set: { productSlugs: [...SWIPE_BANK_OWNER_SLUGS], updatedBy: TAG, updatedAt: new Date() },
    });

  // Snapshot disclaimer setting row (value or absence).
  const [disc] = await db
    .select({ value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, SWIPE_BANK_DISCLAIMER_SETTING_KEY));
  preExistingDisclaimerRow = disc?.value;

  const noProduct = await seedUser("noproduct", "member", "bts");
  noProductCookie = noProduct.cookie;

  const feOnly = await seedUser("feonly", "member", "yse_front_end");
  await grantProduct(feOnly.id, "yse_front_end");
  feOnlyCookie = feOnly.cookie;

  const bankOwner = await seedUser("bankowner", "member", "yse_front_end");
  await grantProduct(bankOwner.id, "yse_front_end");
  await grantProduct(bankOwner.id, "yse_swipe_resource_bank");
  bankOwnerCookie = bankOwner.cookie;

  const tierMember = await seedUser("tier", "member", "6month");
  await grantProduct(tierMember.id, "6month");
  tierMemberCookie = tierMember.cookie;

  const admin = await seedUser("admin", "super_admin", "lifetime");
  adminCookie = admin.cookie;
});

afterAll(async () => {
  // Restore the map row.
  if (preExistingMapRow) {
    await db
      .update(contentAccessMapTable)
      .set({
        productSlugs: preExistingMapRow.productSlugs,
        updatedBy: preExistingMapRow.updatedBy,
        updatedAt: new Date(),
      })
      .where(eq(contentAccessMapTable.pageKey, PAGE_KEY));
  } else {
    await db.delete(contentAccessMapTable).where(eq(contentAccessMapTable.pageKey, PAGE_KEY));
  }

  // Restore the disclaimer setting row.
  if (preExistingDisclaimerRow === undefined) {
    await db
      .delete(systemSettingsTable)
      .where(eq(systemSettingsTable.key, SWIPE_BANK_DISCLAIMER_SETTING_KEY));
  } else {
    await db
      .update(systemSettingsTable)
      .set({ value: preExistingDisclaimerRow })
      .where(eq(systemSettingsTable.key, SWIPE_BANK_DISCLAIMER_SETTING_KEY));
  }

  if (seededUserIds.length > 0) {
    // Admin routes audit-log the actor (FK audit_log.actor_id → users.id).
    await db.execute(
      sql`DELETE FROM audit_log WHERE actor_id IN (${sql.join(seededUserIds.map((id) => sql`${id}`), sql`, `)})`,
    );
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("listing gate", () => {
  it("unauthenticated → 401", async () => {
    const res = await request(app).get("/api/swipe-bank");
    expect(res.status).toBe(401);
  });

  it("no-product member → 403", async () => {
    const res = await request(app).get("/api/swipe-bank").set("Cookie", noProductCookie);
    expect(res.status).toBe(403);
  });

  it("FE-only member (no bank) → 403", async () => {
    const res = await request(app).get("/api/swipe-bank").set("Cookie", feOnlyCookie);
    expect(res.status).toBe(403);
  });

  it("bank owner → 200 with taxonomy + disclaimer", async () => {
    const res = await request(app).get("/api/swipe-bank").set("Cookie", bankOwnerCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.verticals)).toBe(true);
    const names = res.body.verticals.map((v: { name: string }) => v.name);
    expect(names).toContain("Health");
    expect(names).toContain("Wealth");
    expect(names).toContain("Everything Else");
    expect(typeof res.body.disclaimer?.heading).toBe("string");
    expect(res.body.disclaimer.paragraphs.length).toBeGreaterThan(0);
  });

  it("mentorship tier member → 200", async () => {
    const res = await request(app).get("/api/swipe-bank").set("Cookie", tierMemberCookie);
    expect(res.status).toBe(200);
  });

  it("admin bypass → 200", async () => {
    const res = await request(app).get("/api/swipe-bank").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
  });
});

describe("content proxy gate (bytes are gated too)", () => {
  for (const [label, getCookie] of [
    ["no-product member", () => noProductCookie],
    ["FE-only member", () => feOnlyCookie],
  ] as const) {
    it(`${label} → 403 on content AND thumbnail`, async () => {
      const content = await request(app)
        .get("/api/swipe-bank/items/999999/content")
        .set("Cookie", getCookie());
      expect(content.status).toBe(403);
      const thumb = await request(app)
        .get("/api/swipe-bank/items/999999/thumbnail")
        .set("Cookie", getCookie());
      expect(thumb.status).toBe(403);
    });
  }

  it("bank owner passes the gate (404 for a nonexistent item, not 403)", async () => {
    const res = await request(app)
      .get("/api/swipe-bank/items/999999/content")
      .set("Cookie", bankOwnerCookie);
    expect(res.status).toBe(404);
  });
});

describe("admin endpoints", () => {
  it("member cannot reach admin overview", async () => {
    const res = await request(app)
      .get("/api/admin/swipe-bank/overview")
      .set("Cookie", bankOwnerCookie);
    expect(res.status).toBe(403);
  });

  it("admin overview returns taxonomy + items + disclaimer", async () => {
    const res = await request(app)
      .get("/api/admin/swipe-bank/overview")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.verticals)).toBe(true);
    expect(Array.isArray(res.body.subVerticals)).toBe(true);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("disclaimer PUT validates and persists", async () => {
    const bad = await request(app)
      .put("/api/admin/swipe-bank/disclaimer")
      .set("Cookie", adminCookie)
      .send({ heading: "x" });
    expect(bad.status).toBe(400);

    const good = await request(app)
      .put("/api/admin/swipe-bank/disclaimer")
      .set("Cookie", adminCookie)
      .send({ topNote: `${TAG} note`, heading: `${TAG} heading`, paragraphs: ["p1", "p2"] });
    expect(good.status).toBe(200);
    const stored = await getSwipeBankDisclaimer();
    expect(stored.heading).toBe(`${TAG} heading`);
    expect(stored.paragraphs).toEqual(["p1", "p2"]);
  });
});

describe("disclaimer defaults", () => {
  it("shipped default is neutralized (no site naming) and DMCA-bearing", async () => {
    const def = getDefaultSwipeBankDisclaimer();
    const text = [def.topNote, def.heading, ...def.paragraphs].join(" ").toLowerCase();
    expect(text).toContain("we do not claim ownership");
    expect(text).toContain("remove");
    // Portal-neutral language — no WordPress-era site or legal-entity naming.
    expect(text).not.toMatch(/wordpress|\.com|\.net|llc|inc\b/);
    expect(text).toContain("this resource");
  });

  it("malformed stored value falls back to the shipped default", async () => {
    await setSwipeBankDisclaimer(
      { topNote: "t", heading: "h", paragraphs: ["p"] },
      TAG,
    );
    await db
      .update(systemSettingsTable)
      .set({ value: { garbage: true } })
      .where(eq(systemSettingsTable.key, SWIPE_BANK_DISCLAIMER_SETTING_KEY));
    const stored = await getSwipeBankDisclaimer();
    expect(stored).toEqual(getDefaultSwipeBankDisclaimer());
  });
});

describe("thumbnail pipeline", () => {
  it("downsizes a large PNG into a webp within the max width", async () => {
    const original = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: { r: 200, g: 30, b: 30 } },
    })
      .png()
      .toBuffer();
    const thumb = await generateThumbnail(original, "image/png");
    expect(thumb).not.toBeNull();
    expect(thumb!.contentType).toBe("image/webp");
    const meta = await sharp(thumb!.bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(THUMBNAIL_MAX_WIDTH);
  });

  it("never enlarges a small image", async () => {
    const original = await sharp({
      create: { width: 120, height: 60, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    const thumb = await generateThumbnail(original, "image/png");
    const meta = await sharp(thumb!.bytes).metadata();
    expect(meta.width).toBe(120);
  });

  it("returns null for non-image mime types (PDF advertorials keep no thumb)", async () => {
    expect(isThumbnailableMime("application/pdf")).toBe(false);
    expect(await generateThumbnail(Buffer.from("%PDF-1.4"), "application/pdf")).toBeNull();
  });
});

describe("generic storage route cannot bypass the swipe-bank gate", () => {
  const objectStorage = new ObjectStorageService();
  let itemId: number | null = null;
  let originalPath: string;
  let thumbnailPath: string | null = null;

  beforeAll(async () => {
    // Real registration flow: put a small PNG into private storage (stands in
    // for the presigned PUT), then register it through the admin item POST,
    // which stamps the private ACL on the original + generated thumbnail.
    const png = await sharp({
      create: { width: 800, height: 400, channels: 3, background: { r: 10, g: 90, b: 160 } },
    })
      .png()
      .toBuffer();
    originalPath = await objectStorage.saveObjectEntityBytes(
      `uploads/swipe-acl-test-${randomUUID()}`,
      png,
      "image/png",
    );

    const [subVertical] = await db
      .select({ id: swipeBankSubVerticalsTable.id })
      .from(swipeBankSubVerticalsTable)
      .limit(1);
    expect(subVertical).toBeTruthy();

    const created = await request(app)
      .post("/api/admin/swipe-bank/items")
      .set("Cookie", adminCookie)
      .send({
        itemType: "banner",
        subVerticalId: subVertical.id,
        title: `${TAG} ACL probe banner`,
        objectPath: originalPath,
      });
    expect(created.status).toBe(201);
    itemId = created.body.item.id;
    thumbnailPath = (
      await db
        .select({ thumbnailObjectPath: swipeBankItemsTable.thumbnailObjectPath })
        .from(swipeBankItemsTable)
        .where(eq(swipeBankItemsTable.id, itemId!))
    )[0]?.thumbnailObjectPath;
    expect(thumbnailPath).toBeTruthy();
  }, 60_000);

  afterAll(async () => {
    if (itemId) {
      await db.delete(swipeBankItemsTable).where(eq(swipeBankItemsTable.id, itemId));
    }
  });

  function storageUrl(objectPath: string): string {
    return `/api/storage${objectPath}`; // "/objects/..." → "/api/storage/objects/..."
  }

  it("non-owner member → 403 on the raw original AND thumbnail via /api/storage/objects/*", async () => {
    for (const p of [originalPath, thumbnailPath!]) {
      const res = await request(app).get(storageUrl(p)).set("Cookie", noProductCookie);
      expect(res.status).toBe(403);
    }
  });

  it("FE-only member and even a bank owner → 403 on the generic route (bytes only flow through the gated proxy)", async () => {
    for (const cookie of [feOnlyCookie, bankOwnerCookie]) {
      const res = await request(app).get(storageUrl(originalPath)).set("Cookie", cookie);
      expect(res.status).toBe(403);
    }
  });

  it("unauthenticated → 401 on the generic route", async () => {
    const res = await request(app).get(storageUrl(originalPath));
    expect(res.status).toBe(401);
  });

  it("bank owner still gets the bytes through the gated proxy routes", async () => {
    const content = await request(app)
      .get(`/api/swipe-bank/items/${itemId}/content`)
      .set("Cookie", bankOwnerCookie);
    expect(content.status).toBe(200);
    const thumb = await request(app)
      .get(`/api/swipe-bank/items/${itemId}/thumbnail`)
      .set("Cookie", bankOwnerCookie);
    expect(thumb.status).toBe(200);
    expect(thumb.headers["content-type"]).toContain("image/webp");
  });

  it("no-product member remains 403 on the gated proxy for the registered item", async () => {
    const res = await request(app)
      .get(`/api/swipe-bank/items/${itemId}/content`)
      .set("Cookie", noProductCookie);
    expect(res.status).toBe(403);
  });
});
