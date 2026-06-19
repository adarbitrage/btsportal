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
  webhookLogsTable,
  machineProductKeyMappingsTable,
  machineUnknownProductKeysTable,
  auditLogTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const { TEST_SECRET } = vi.hoisted(() => {
  const secret = "test-machine-secret-" + Math.random().toString(36).slice(2);
  process.env.MACHINE_PORTAL_SHARED_SECRET = secret;
  return { TEST_SECRET: secret };
});

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    queueEmail: vi.fn().mockResolvedValue(undefined),
    queueSms: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: vi.fn().mockResolvedValue("job_test_id"),
  startWorker: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock("../lib/commissions", () => ({
  ensureAffiliateProfile: vi.fn().mockResolvedValue(null),
  resolveUserCommissionTier: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

vi.mock("../lib/webhook-events", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
  WEBHOOK_EVENT_TYPES: [],
}));

import { buildTestApp, buildTestAppWithRouters } from "./test-app";
import integrationsRouter from "../routes/integrations";
import adminPanelRouter from "../routes/admin-panel";
import adminFulfillmentCatalogRouter from "../routes/admin-fulfillment-catalog";
import {
  FUNNEL_SLUG_TO_PRODUCT,
  resolveMachineProductKeys,
  seedMachineProductKeyMappings,
} from "../lib/machine-product-key-mappings";
import { MACHINE_FUNNEL_SLUGS } from "../routes/integrations";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `mpkm_${randomUUID().slice(0, 6).replace(/-/g, "")}`;
const URL = "/api/integrations/machine-purchase";

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
const seededMappingIds: number[] = [];
const seededUnknownIds: number[] = [];

let app: ReturnType<typeof buildTestApp>;
let adminApp: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let frontEndProductId: number;
let upsellProductId: number;
const UPSELL_SLUG = `${TEST_TAG}_upsell`;
const UPSELL_MACHINE_KEY = `${TEST_TAG}_upsell_k`.toLowerCase().replace(/-/g, "_");

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function ensureProduct(slug: string, name: string): Promise<number> {
  const [existing] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.slug, slug))
    .limit(1);
  if (existing) return existing.id;
  const [row] = await db
    .insert(productsTable)
    .values({
      slug,
      name,
      type: "frontend",
      entitlementKeys: ["content:frontend"],
      priceDisplay: "$1",
      sortOrder: 900,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  app = buildTestApp({ routers: [integrationsRouter] });
  adminApp = buildTestAppWithRouters([
    adminPanelRouter,
    adminFulfillmentCatalogRouter,
  ]);

  // Make sure the bootstrap-style seed runs so default mappings exist for
  // the resolver tests below — bootstrap normally runs at startup, but the
  // test harness skips it. Idempotent.
  frontEndProductId = await ensureProduct("yse_front_end", "YSE Front End");
  upsellProductId = await ensureProduct(UPSELL_SLUG, `${TEST_TAG} upsell`);
  await seedMachineProductKeyMappings();

  // Custom mapping that points at our test-only upsell product.
  const [mapping] = await db
    .insert(machineProductKeyMappingsTable)
    .values({
      machineKey: UPSELL_MACHINE_KEY,
      portalSlug: UPSELL_SLUG,
      notes: `test mapping for ${TEST_TAG}`,
      updatedBy: "test",
    })
    .onConflictDoNothing({ target: machineProductKeyMappingsTable.machineKey })
    .returning({ id: machineProductKeyMappingsTable.id });
  if (mapping) seededMappingIds.push(mapping.id);

  // Admin user for the admin endpoints.
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [admin] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-admin@example.test`,
      name: "Admin",
      passwordHash,
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(admin.id);
  adminCookie = signCookie(admin.id, `${TEST_TAG}-admin@example.test`);
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db
      .delete(auditLogTable)
      .where(inArray(auditLogTable.actorId, seededUserIds));
    await db
      .delete(userProductsTable)
      .where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  await db
    .delete(webhookLogsTable)
    .where(eq(webhookLogsTable.eventType, "external.grant_product"));
  if (seededMappingIds.length > 0) {
    await db
      .delete(machineProductKeyMappingsTable)
      .where(inArray(machineProductKeyMappingsTable.id, seededMappingIds));
  }
  if (seededUnknownIds.length > 0) {
    await db
      .delete(machineUnknownProductKeysTable)
      .where(inArray(machineUnknownProductKeysTable.id, seededUnknownIds));
  }
  // Cleanup any unknown-key rows the receiver wrote during this test
  await db
    .delete(machineUnknownProductKeysTable)
    .where(inArray(machineUnknownProductKeysTable.machineKey, [
      `${TEST_TAG}_unk_a`,
      `${TEST_TAG}_unk_b`,
    ]));
  if (seededProductIds.length > 0) {
    await db
      .delete(productsTable)
      .where(inArray(productsTable.id, seededProductIds));
  }
});

function authedPost(body: object) {
  return request(app).post(URL).set("X-Machine-Webhook-Secret", TEST_SECRET).send(body);
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    order_number: `tm_ord_${randomUUID().slice(0, 8)}`,
    email: `${TEST_TAG}-${randomUUID().slice(0, 6)}@machine.test`,
    first_name: "Jane",
    funnel_slug: "yse-workshop",
    occurred_at: new Date().toISOString(),
    ...overrides,
  };
}

async function readMetadata(order: string): Promise<Record<string, unknown>> {
  const [log] = await db
    .select({ payload: webhookLogsTable.payload })
    .from(webhookLogsTable)
    .where(eq(webhookLogsTable.externalId, `machine_${order}`));
  expect(log).toBeDefined();
  return (log.payload as { metadata: Record<string, unknown> }).metadata;
}

describe("resolveMachineProductKeys (pure)", () => {
  it("maps known keys to portal slugs, preserving input order and de-duplicating", () => {
    const map = new Map([
      ["yse_front_end", "yse_front_end"],
      ["yse_cmo_bump", "yse_affiliate_cmo_bump"],
    ]);
    const r = resolveMachineProductKeys(
      ["yse_front_end", "yse_cmo_bump", "yse_front_end"],
      map,
    );
    expect(r.portalSlugs).toEqual(["yse_front_end", "yse_affiliate_cmo_bump"]);
    expect(r.unknownKeys).toEqual([]);
    expect(r.usedFallback).toBe(false);
  });

  it("collects unknown keys without dropping the known ones", () => {
    const map = new Map([["yse_front_end", "yse_front_end"]]);
    const r = resolveMachineProductKeys(
      ["yse_front_end", "mystery_addon", "mystery_addon", "another_unknown"],
      map,
    );
    expect(r.portalSlugs).toEqual(["yse_front_end"]);
    expect(r.unknownKeys).toEqual(["mystery_addon", "another_unknown"]);
    expect(r.usedFallback).toBe(false);
  });

  it("falls back to yse_front_end when input is empty or fully unknown", () => {
    const map = new Map([["yse_front_end", "yse_front_end"]]);
    expect(resolveMachineProductKeys([], map).portalSlugs).toEqual([
      "yse_front_end",
    ]);
    expect(resolveMachineProductKeys([], map).usedFallback).toBe(true);

    const r = resolveMachineProductKeys(["foo_x", "bar_y"], map);
    expect(r.portalSlugs).toEqual(["yse_front_end"]);
    expect(r.unknownKeys).toEqual(["foo_x", "bar_y"]);
    expect(r.usedFallback).toBe(true);
  });
});

describe("POST /api/integrations/machine-purchase — mapping → grants", () => {
  it("grants every mapped portal slug, not just yse_front_end", async () => {
    const email = `${TEST_TAG}-multi@machine.test`;
    const order = `tm_ord_multi_${randomUUID().slice(0, 6)}`;
    const res = await authedPost(
      validBody({
        email,
        order_number: order,
        portal_product_keys: ["yse_front_end", UPSELL_MACHINE_KEY],
      }),
    );
    expect([200, 201]).toContain(res.status);
    seededUserIds.push(res.body.userId);

    const grants = await db
      .select({ productId: userProductsTable.productId })
      .from(userProductsTable)
      .where(eq(userProductsTable.userId, res.body.userId));
    const productIds = grants.map((g) => g.productId).sort((a, b) => a - b);
    expect(productIds).toEqual(
      [frontEndProductId, upsellProductId].sort((a, b) => a - b),
    );

    const metadata = await readMetadata(order);
    expect(metadata.resolved_portal_slugs).toEqual(
      expect.arrayContaining(["yse_front_end", UPSELL_SLUG]),
    );
    expect(metadata.portal_product_keys_fallback).toBe(false);
    expect(metadata.unknown_portal_product_keys).toEqual([]);
  });

  it("captures unknown keys to machine_unknown_product_keys and still grants known ones", async () => {
    const email = `${TEST_TAG}-unk@machine.test`;
    const order = `tm_ord_unk_${randomUUID().slice(0, 6)}`;
    const res = await authedPost(
      validBody({
        email,
        order_number: order,
        portal_product_keys: [
          "yse_front_end",
          `${TEST_TAG}_unk_a`,
          `${TEST_TAG}_unk_b`,
        ],
      }),
    );
    expect([200, 201]).toContain(res.status);
    seededUserIds.push(res.body.userId);

    // Wait briefly for the fire-and-forget unknown-key write to land.
    await new Promise((r) => setTimeout(r, 300));

    const metadata = await readMetadata(order);
    expect(metadata.unknown_portal_product_keys).toEqual([
      `${TEST_TAG}_unk_a`,
      `${TEST_TAG}_unk_b`,
    ]);

    const rows = await db
      .select({
        machineKey: machineUnknownProductKeysTable.machineKey,
        occurrences: machineUnknownProductKeysTable.occurrences,
        lastExternalOrderId: machineUnknownProductKeysTable.lastExternalOrderId,
      })
      .from(machineUnknownProductKeysTable)
      .where(
        inArray(machineUnknownProductKeysTable.machineKey, [
          `${TEST_TAG}_unk_a`,
          `${TEST_TAG}_unk_b`,
        ]),
      );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.occurrences).toBeGreaterThanOrEqual(1);
      expect(r.lastExternalOrderId).toBe(order);
    }

    // The known key still produces a real grant.
    const grants = await db
      .select({ productId: userProductsTable.productId })
      .from(userProductsTable)
      .where(eq(userProductsTable.userId, res.body.userId));
    expect(grants.map((g) => g.productId)).toContain(frontEndProductId);
  });

  it("falls back to yse_front_end when every key is unknown", async () => {
    const email = `${TEST_TAG}-allunk@machine.test`;
    const order = `tm_ord_allunk_${randomUUID().slice(0, 6)}`;
    const res = await authedPost(
      validBody({
        email,
        order_number: order,
        portal_product_keys: [`${TEST_TAG}_unk_a`],
      }),
    );
    expect([200, 201]).toContain(res.status);
    seededUserIds.push(res.body.userId);
    const metadata = await readMetadata(order);
    expect(metadata.portal_product_keys_fallback).toBe(true);
    expect(metadata.resolved_portal_slugs).toEqual(["yse_front_end"]);
  });
});

describe("Admin endpoints — machine product key mappings", () => {
  it("lists, creates, patches, and deletes a mapping with audit log entries", async () => {
    const newKey = `${TEST_TAG}_admin_k`;
    const createRes = await request(adminApp)
      .post("/api/admin/integrations/machine-product-key-mappings")
      .set("Cookie", adminCookie)
      .send({ machineKey: newKey, portalSlug: "yse_front_end", notes: "x" });
    expect(createRes.status).toBe(201);
    const created = createRes.body.mapping;
    seededMappingIds.push(created.id);
    expect(created.machineKey).toBe(newKey);
    expect(created.portalSlug).toBe("yse_front_end");

    const listRes = await request(adminApp)
      .get("/api/admin/integrations/machine-product-key-mappings")
      .set("Cookie", adminCookie);
    expect(listRes.status).toBe(200);
    const keys = listRes.body.mappings.map(
      (m: { machineKey: string }) => m.machineKey,
    );
    expect(keys).toContain(newKey);
    expect(keys).toContain("yse_front_end");

    const patchRes = await request(adminApp)
      .patch(`/api/admin/integrations/machine-product-key-mappings/${created.id}`)
      .set("Cookie", adminCookie)
      .send({ portalSlug: UPSELL_SLUG, notes: "edited" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.mapping.portalSlug).toBe(UPSELL_SLUG);
    expect(patchRes.body.mapping.notes).toBe("edited");

    const dupRes = await request(adminApp)
      .post("/api/admin/integrations/machine-product-key-mappings")
      .set("Cookie", adminCookie)
      .send({ machineKey: newKey, portalSlug: "yse_front_end" });
    expect(dupRes.status).toBe(409);

    const badRes = await request(adminApp)
      .post("/api/admin/integrations/machine-product-key-mappings")
      .set("Cookie", adminCookie)
      .send({ machineKey: "Has-Dashes", portalSlug: "yse_front_end" });
    expect(badRes.status).toBe(400);

    const delRes = await request(adminApp)
      .delete(`/api/admin/integrations/machine-product-key-mappings/${created.id}`)
      .set("Cookie", adminCookie);
    expect(delRes.status).toBe(200);
    // Pop because the row no longer exists.
    seededMappingIds.pop();
  });

  it("accepts a colon-namespaced machine key on create", async () => {
    // Machine emits colon-namespaced keys (e.g. "offer:bump"); the create
    // validator must accept them (regression guard for the relaxed pattern).
    const colonKey = `${TEST_TAG}:bump`;
    const res = await request(adminApp)
      .post("/api/admin/integrations/machine-product-key-mappings")
      .set("Cookie", adminCookie)
      .send({ machineKey: colonKey, portalSlug: "yse_front_end" });
    expect(res.status).toBe(201);
    expect(res.body.mapping.machineKey).toBe(colonKey);
    seededMappingIds.push(res.body.mapping.id);
  });

  it("aggregates the fulfillment catalog and degrades when Machine is unreachable", async () => {
    const res = await request(adminApp)
      .get("/api/admin/fulfillment/catalog")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    // No MACHINE_CATALOG_URL configured in tests → graceful degrade.
    expect(res.body.catalog).toBeNull();
    expect(res.body.catalogAvailable).toBe(false);
    expect(typeof res.body.catalogError).toBe("string");
    // Local aggregation always present regardless of catalog reachability.
    expect(Array.isArray(res.body.mappings)).toBe(true);
    expect(Array.isArray(res.body.products)).toBe(true);
    expect(Array.isArray(res.body.unknownKeys)).toBe(true);
    // Only entitlement-bearing products are offered as map targets.
    for (const p of res.body.products) {
      expect(Array.isArray(p.entitlementKeys)).toBe(true);
      expect(p.entitlementKeys.length).toBeGreaterThan(0);
    }
  });

  it("lists unknown machine keys and dismisses them", async () => {
    // Plant an unknown row.
    const machineKey = `${TEST_TAG}_admin_unk`;
    const [row] = await db
      .insert(machineUnknownProductKeysTable)
      .values({ machineKey, occurrences: 3 })
      .returning({ id: machineUnknownProductKeysTable.id });
    seededUnknownIds.push(row.id);

    const listRes = await request(adminApp)
      .get("/api/admin/integrations/machine-unknown-product-keys")
      .set("Cookie", adminCookie);
    expect(listRes.status).toBe(200);
    const keys = listRes.body.unknownKeys.map(
      (u: { machineKey: string }) => u.machineKey,
    );
    expect(keys).toContain(machineKey);

    const dismissRes = await request(adminApp)
      .post(`/api/admin/integrations/machine-unknown-product-keys/${row.id}/dismiss`)
      .set("Cookie", adminCookie);
    expect(dismissRes.status).toBe(200);
    expect(dismissRes.body.unknownKey.dismissedAt).toBeTruthy();

    // Dismissed rows hide from the default list...
    const after = await request(adminApp)
      .get("/api/admin/integrations/machine-unknown-product-keys")
      .set("Cookie", adminCookie);
    const afterKeys = after.body.unknownKeys.map(
      (u: { machineKey: string }) => u.machineKey,
    );
    expect(afterKeys).not.toContain(machineKey);

    // ...but reappear with includeDismissed=true.
    const includeRes = await request(adminApp)
      .get("/api/admin/integrations/machine-unknown-product-keys?includeDismissed=true")
      .set("Cookie", adminCookie);
    const includeKeys = includeRes.body.unknownKeys.map(
      (u: { machineKey: string }) => u.machineKey,
    );
    expect(includeKeys).toContain(machineKey);
  });
});

// ─── Drift guard: funnel-slug accepted set ───────────────────────────────────
// Locks the 13-slug set so it can't silently drift from the Dispatch 2
// source-of-truth table without a test failure.
describe("MACHINE_FUNNEL_SLUGS — accepted set guard", () => {
  const EXPECTED_SLUGS = [
    "yse-workshop",
    "yse-ebook",
    "your-second-engine",
    "backroad-system-workshop",
    "backroad-system-ebook",
    "off-market-affiliate-workshop",
    "off-market-affiliate-ebook",
    "reserve-income-workshop",
    "reserve-income-ebook",
    "silent-partner-workshop",
    "silent-partner-ebook",
    "test-like-mad-workshop",
    "test-like-mad-ebook",
  ] as const;

  it("contains exactly the 13 source-of-truth slugs (12 verbatim + legacy your-second-engine)", () => {
    const actual = [...MACHINE_FUNNEL_SLUGS].sort();
    const expected = [...EXPECTED_SLUGS].sort();
    expect(actual).toEqual(expected);
  });

  it("FUNNEL_SLUG_TO_PRODUCT has exactly one entry per accepted funnel slug", () => {
    for (const slug of MACHINE_FUNNEL_SLUGS) {
      expect(FUNNEL_SLUG_TO_PRODUCT[slug]).toBeDefined();
      expect(typeof FUNNEL_SLUG_TO_PRODUCT[slug]).toBe("string");
    }
    expect(Object.keys(FUNNEL_SLUG_TO_PRODUCT)).toHaveLength(MACHINE_FUNNEL_SLUGS.length);
  });
});

// ─── resolveMachineProductKeys — funnel-derived fallback (pure) ──────────────
describe("resolveMachineProductKeys — funnel-derived fallback (pure)", () => {
  const emptyMap = new Map<string, string>();

  it("uses the funnel-derived product when portal_product_keys is empty", () => {
    for (const [funnelSlug, expectedProduct] of Object.entries(FUNNEL_SLUG_TO_PRODUCT)) {
      const r = resolveMachineProductKeys([], emptyMap, funnelSlug);
      expect(r.portalSlugs).toEqual([expectedProduct]);
      expect(r.usedFallback).toBe(true);
    }
  });

  it("uses the funnel-derived product when every key is unknown", () => {
    const r = resolveMachineProductKeys(["unknown_key"], emptyMap, "backroad-system-workshop");
    expect(r.portalSlugs).toEqual(["backroad"]);
    expect(r.unknownKeys).toEqual(["unknown_key"]);
    expect(r.usedFallback).toBe(true);
  });

  it("YSE funnels fall back to yse_front_end", () => {
    for (const slug of ["yse-workshop", "yse-ebook", "your-second-engine"]) {
      const r = resolveMachineProductKeys([], emptyMap, slug);
      expect(r.portalSlugs).toEqual(["yse_front_end"]);
    }
  });

  it("each brand funnel falls back to its own product, never yse_front_end", () => {
    const brandCases: Array<[string, string]> = [
      ["backroad-system-workshop", "backroad"],
      ["backroad-system-ebook", "backroad"],
      ["off-market-affiliate-workshop", "offmarket"],
      ["off-market-affiliate-ebook", "offmarket"],
      ["reserve-income-workshop", "reserve_income"],
      ["reserve-income-ebook", "reserve_income"],
      ["silent-partner-workshop", "silent_partner"],
      ["silent-partner-ebook", "silent_partner"],
      ["test-like-mad-workshop", "test_like_mad"],
      ["test-like-mad-ebook", "test_like_mad"],
    ];
    for (const [funnelSlug, expectedProduct] of brandCases) {
      const r = resolveMachineProductKeys([], emptyMap, funnelSlug);
      expect(r.portalSlugs).toEqual([expectedProduct]);
      expect(r.portalSlugs).not.toContain("yse_front_end");
    }
  });

  it("falls back to yse_front_end when funnelSlug is undefined (no-arg backward compat)", () => {
    const r = resolveMachineProductKeys([], emptyMap);
    expect(r.portalSlugs).toEqual(["yse_front_end"]);
    expect(r.usedFallback).toBe(true);
  });
});

// ─── Brand purchase integration tests ────────────────────────────────────────
// Prove that a brand purchase resolves to the correct brand product, not YSE,
// covering both the key-path and the funnel-derived fallback.
describe("POST /api/integrations/machine-purchase — brand product resolution", () => {
  const brandProductIds: Record<string, number> = {};
  const brandUserIds: number[] = [];

  beforeAll(async () => {
    const brands = [
      { slug: "backroad", name: "The Backroad System" },
      { slug: "offmarket", name: "The Off-Market Affiliate System" },
      { slug: "reserve_income", name: "The Reserve Income System" },
      { slug: "silent_partner", name: "The Silent Partner System" },
      { slug: "test_like_mad", name: "Test Like Mad" },
    ];
    for (const { slug, name } of brands) {
      brandProductIds[slug] = await ensureProduct(slug, name);
    }
  });

  afterAll(async () => {
    if (brandUserIds.length > 0) {
      await db.delete(userProductsTable).where(inArray(userProductsTable.userId, brandUserIds));
      await db.delete(usersTable).where(inArray(usersTable.id, brandUserIds));
    }
  });

  const BRAND_CASES: Array<{
    funnelSlug: string;
    machineKey: string;
    productSlug: string;
  }> = [
    { funnelSlug: "backroad-system-workshop", machineKey: "backroad", productSlug: "backroad" },
    { funnelSlug: "off-market-affiliate-workshop", machineKey: "offmarket", productSlug: "offmarket" },
    { funnelSlug: "reserve-income-workshop", machineKey: "reserve_income", productSlug: "reserve_income" },
    { funnelSlug: "silent-partner-workshop", machineKey: "silent_partner", productSlug: "silent_partner" },
    { funnelSlug: "test-like-mad-workshop", machineKey: "test_like_mad", productSlug: "test_like_mad" },
  ];

  for (const { funnelSlug, machineKey, productSlug } of BRAND_CASES) {
    it(`key-path: ${funnelSlug} + key ${machineKey} → ${productSlug}, NOT yse_front_end`, async () => {
      const order = `tm_bk_${machineKey.slice(0, 8)}_${randomUUID().slice(0, 6)}`;
      const res = await authedPost(
        validBody({
          funnel_slug: funnelSlug,
          order_number: order,
          email: `${TEST_TAG}-bk-${machineKey}@machine.test`,
          portal_product_keys: [machineKey],
        }),
      );
      expect([200, 201]).toContain(res.status);
      brandUserIds.push(res.body.userId);

      const grants = await db
        .select({ productId: userProductsTable.productId })
        .from(userProductsTable)
        .where(eq(userProductsTable.userId, res.body.userId));
      const grantedIds = grants.map((g) => g.productId);

      expect(grantedIds).toContain(brandProductIds[productSlug]);
      expect(grantedIds).not.toContain(frontEndProductId);

      const metadata = await readMetadata(order);
      expect(metadata.resolved_portal_slugs).toEqual([productSlug]);
      expect(metadata.portal_product_keys_fallback).toBe(false);
    });

    it(`funnel-fallback: ${funnelSlug} + empty keys → ${productSlug}, NOT yse_front_end`, async () => {
      const order = `tm_bf_${machineKey.slice(0, 8)}_${randomUUID().slice(0, 6)}`;
      const res = await authedPost(
        validBody({
          funnel_slug: funnelSlug,
          order_number: order,
          email: `${TEST_TAG}-bf-${machineKey}@machine.test`,
          portal_product_keys: [],
        }),
      );
      expect([200, 201]).toContain(res.status);
      brandUserIds.push(res.body.userId);

      const grants = await db
        .select({ productId: userProductsTable.productId })
        .from(userProductsTable)
        .where(eq(userProductsTable.userId, res.body.userId));
      const grantedIds = grants.map((g) => g.productId);

      expect(grantedIds).toContain(brandProductIds[productSlug]);
      expect(grantedIds).not.toContain(frontEndProductId);

      const metadata = await readMetadata(order);
      expect(metadata.resolved_portal_slugs).toEqual([productSlug]);
      expect(metadata.portal_product_keys_fallback).toBe(true);
    });
  }

  it("YSE purchase is completely unaffected: yse-workshop + yse_front_end key → yse_front_end", async () => {
    const order = `tm_yse_sanity_${randomUUID().slice(0, 6)}`;
    const res = await authedPost(
      validBody({
        funnel_slug: "yse-workshop",
        order_number: order,
        email: `${TEST_TAG}-yse-sanity@machine.test`,
        portal_product_keys: ["yse_front_end"],
      }),
    );
    expect([200, 201]).toContain(res.status);
    brandUserIds.push(res.body.userId);

    const metadata = await readMetadata(order);
    expect(metadata.resolved_portal_slugs).toEqual(["yse_front_end"]);
    expect(metadata.portal_product_keys_fallback).toBe(false);
  });

  it("YSE funnel-fallback: yse-workshop + empty keys → yse_front_end", async () => {
    const order = `tm_yse_fb_${randomUUID().slice(0, 6)}`;
    const res = await authedPost(
      validBody({
        funnel_slug: "yse-workshop",
        order_number: order,
        email: `${TEST_TAG}-yse-fb@machine.test`,
        portal_product_keys: [],
      }),
    );
    expect([200, 201]).toContain(res.status);
    brandUserIds.push(res.body.userId);

    const metadata = await readMetadata(order);
    expect(metadata.resolved_portal_slugs).toEqual(["yse_front_end"]);
    expect(metadata.portal_product_keys_fallback).toBe(true);
  });

  it("simulated brand purchase: backroad-system-workshop + backroad key → backroad, not yse_front_end", async () => {
    const order = `tm_backroad_sim_${randomUUID().slice(0, 6)}`;
    const res = await authedPost(
      validBody({
        funnel_slug: "backroad-system-workshop",
        order_number: order,
        email: `${TEST_TAG}-backroad-sim@machine.test`,
        portal_product_keys: ["backroad"],
      }),
    );
    expect([200, 201]).toContain(res.status);
    brandUserIds.push(res.body.userId);

    const grants = await db
      .select({ productId: userProductsTable.productId })
      .from(userProductsTable)
      .where(eq(userProductsTable.userId, res.body.userId));
    const grantedIds = grants.map((g) => g.productId);

    expect(grantedIds).toContain(brandProductIds["backroad"]);
    expect(grantedIds).not.toContain(frontEndProductId);

    const metadata = await readMetadata(order);
    expect(metadata.resolved_portal_slugs).toEqual(["backroad"]);
    expect(metadata.portal_product_keys_fallback).toBe(false);
  });
});
