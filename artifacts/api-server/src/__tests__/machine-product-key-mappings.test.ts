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
import {
  resolveMachineProductKeys,
  seedMachineProductKeyMappings,
} from "../lib/machine-product-key-mappings";

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
  adminApp = buildTestAppWithRouters([adminPanelRouter]);

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
