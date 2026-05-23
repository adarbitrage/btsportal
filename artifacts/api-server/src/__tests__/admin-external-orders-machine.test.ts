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
  auditLogTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `admin-ext-orders-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
const seededWebhookIds: number[] = [];

const YSE_ORDER_ID = `${TEST_TAG}_yse_${randomUUID().slice(0, 6)}`;
const MACHINE_ORDER_ID = `${TEST_TAG}_machine_${randomUUID().slice(0, 6)}`;
const MACHINE_BTS_REF = `bts_${randomUUID().slice(0, 8)}`;
const MACHINE_FUNNEL = "yse-workshop";
// Snake_case-ish, ≤20 chars per the pinned validator contract.
const MACHINE_PORTAL_PRODUCT_KEYS = ["yse_front_end", "yse_cmo_bump"];

// Additional Machine orders covering the other mismatch shapes that the
// heuristic in computeOrderMismatch is supposed to flag (or, importantly,
// not flag) — see task #495.
const OVER_GRANT_ORDER_ID = `${TEST_TAG}_machine_over_${randomUUID().slice(0, 6)}`;
const DISJOINT_ORDER_ID = `${TEST_TAG}_machine_disjoint_${randomUUID().slice(0, 6)}`;
const EXACT_ORDER_ID = `${TEST_TAG}_machine_exact_${randomUUID().slice(0, 6)}`;
const NO_KEYS_ORDER_ID = `${TEST_TAG}_machine_nokeys_${randomUUID().slice(0, 6)}`;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(role: string, suffix: string): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-${suffix}@example.test`,
      name: `User ${suffix}`,
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);

  const adminId = await insertUser("super_admin", "admin");
  adminCookie = signCookie(adminId, `${TEST_TAG}-admin@example.test`);

  const yseBuyerId = await insertUser("member", "yse-buyer");
  const machineBuyerId = await insertUser("member", "machine-buyer");
  const overGrantBuyerId = await insertUser("member", "machine-over");
  const disjointBuyerId = await insertUser("member", "machine-disjoint");
  const exactBuyerId = await insertUser("member", "machine-exact");
  const noKeysBuyerId = await insertUser("member", "machine-nokeys");

  const [productA] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-prod`,
      name: `${TEST_TAG} product`,
      type: "backend",
      sortOrder: 99,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(productA.id);

  const [productB] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-prod-b`,
      name: `${TEST_TAG} product B`,
      type: "backend",
      sortOrder: 100,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(productB.id);

  await db.insert(userProductsTable).values({
    userId: yseBuyerId,
    productId: productA.id,
    status: "active",
    externalSource: "yse",
    externalOrderId: YSE_ORDER_ID,
  });
  await db.insert(userProductsTable).values({
    userId: machineBuyerId,
    productId: productA.id,
    status: "active",
    externalSource: "machine",
    externalOrderId: MACHINE_ORDER_ID,
  });

  // Over-grant: granted [productA, productB] but Machine claimed only [productA.slug].
  await db.insert(userProductsTable).values([
    {
      userId: overGrantBuyerId,
      productId: productA.id,
      status: "active",
      externalSource: "machine",
      externalOrderId: OVER_GRANT_ORDER_ID,
    },
    {
      userId: overGrantBuyerId,
      productId: productB.id,
      status: "active",
      externalSource: "machine",
      externalOrderId: OVER_GRANT_ORDER_ID,
    },
  ]);

  // Disjoint: granted [productA] but Machine claimed [some_other_key].
  await db.insert(userProductsTable).values({
    userId: disjointBuyerId,
    productId: productA.id,
    status: "active",
    externalSource: "machine",
    externalOrderId: DISJOINT_ORDER_ID,
  });

  // Exact: granted [productA, productB] and Machine claimed exactly those slugs.
  await db.insert(userProductsTable).values([
    {
      userId: exactBuyerId,
      productId: productA.id,
      status: "active",
      externalSource: "machine",
      externalOrderId: EXACT_ORDER_ID,
    },
    {
      userId: exactBuyerId,
      productId: productB.id,
      status: "active",
      externalSource: "machine",
      externalOrderId: EXACT_ORDER_ID,
    },
  ]);

  // No portal_product_keys captured on the webhook — pre-task-491 shape;
  // the heuristic must stay quiet (mismatch=false) for these.
  await db.insert(userProductsTable).values({
    userId: noKeysBuyerId,
    productId: productA.id,
    status: "active",
    externalSource: "machine",
    externalOrderId: NO_KEYS_ORDER_ID,
  });

  // Webhook log row holds metadata.bts_ref + metadata.funnel_slug that the
  // admin orders endpoint joins onto user_products via external_id.
  const [machineLog] = await db
    .insert(webhookLogsTable)
    .values({
      externalId: `machine_${MACHINE_ORDER_ID}`,
      eventType: "external.grant_product",
      status: "processed",
      payload: {
        externalSource: "machine",
        externalOrderId: MACHINE_ORDER_ID,
        metadata: {
          bts_ref: MACHINE_BTS_REF,
          funnel_slug: MACHINE_FUNNEL,
          portal_product_keys: MACHINE_PORTAL_PRODUCT_KEYS,
        },
      } as Record<string, unknown>,
    })
    .returning({ id: webhookLogsTable.id });
  seededWebhookIds.push(machineLog.id);

  // Webhook logs for the additional mismatch-shape orders.
  const extraLogs = await db
    .insert(webhookLogsTable)
    .values([
      // These extra orders all use a distinct bts_ref so the existing
      // "filters by btsRef" test (which asserts a sole match for
      // MACHINE_BTS_REF) keeps holding.
      {
        externalId: `machine_${OVER_GRANT_ORDER_ID}`,
        eventType: "external.grant_product",
        status: "processed",
        payload: {
          externalSource: "machine",
          externalOrderId: OVER_GRANT_ORDER_ID,
          metadata: {
            bts_ref: `${MACHINE_BTS_REF}_extra`,
            funnel_slug: MACHINE_FUNNEL,
            portal_product_keys: [`${TEST_TAG}-prod`],
          },
        } as Record<string, unknown>,
      },
      {
        externalId: `machine_${DISJOINT_ORDER_ID}`,
        eventType: "external.grant_product",
        status: "processed",
        payload: {
          externalSource: "machine",
          externalOrderId: DISJOINT_ORDER_ID,
          metadata: {
            bts_ref: `${MACHINE_BTS_REF}_extra`,
            funnel_slug: MACHINE_FUNNEL,
            portal_product_keys: ["totally_other_key"],
          },
        } as Record<string, unknown>,
      },
      {
        externalId: `machine_${EXACT_ORDER_ID}`,
        eventType: "external.grant_product",
        status: "processed",
        payload: {
          externalSource: "machine",
          externalOrderId: EXACT_ORDER_ID,
          metadata: {
            bts_ref: `${MACHINE_BTS_REF}_extra`,
            funnel_slug: MACHINE_FUNNEL,
            portal_product_keys: [`${TEST_TAG}-prod`, `${TEST_TAG}-prod-b`],
          },
        } as Record<string, unknown>,
      },
      {
        externalId: `machine_${NO_KEYS_ORDER_ID}`,
        eventType: "external.grant_product",
        status: "processed",
        payload: {
          externalSource: "machine",
          externalOrderId: NO_KEYS_ORDER_ID,
          metadata: {
            bts_ref: `${MACHINE_BTS_REF}_extra`,
            funnel_slug: MACHINE_FUNNEL,
            // No portal_product_keys at all — the heuristic must treat this
            // as "nothing to compare against" rather than flagging.
          },
        } as Record<string, unknown>,
      },
    ])
    .returning({ id: webhookLogsTable.id });
  for (const row of extraLogs) seededWebhookIds.push(row.id);
});

afterAll(async () => {
  if (seededWebhookIds.length > 0) {
    await db
      .delete(webhookLogsTable)
      .where(inArray(webhookLogsTable.id, seededWebhookIds));
  }
  if (seededUserIds.length > 0) {
    // The CSV export test triggers logAdminAction which writes audit_log
    // rows whose actor_id FK points at our seeded admin — clear those
    // before we drop the user rows.
    await db
      .delete(auditLogTable)
      .where(inArray(auditLogTable.actorId, seededUserIds));
    await db
      .delete(userProductsTable)
      .where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  if (seededProductIds.length > 0) {
    await db
      .delete(productsTable)
      .where(inArray(productsTable.id, seededProductIds));
  }
});

describe("GET /api/admin/integrations/yse/orders — Machine source", () => {
  it("lists Machine orders with source, bts_ref, and funnel_slug when source=machine", async () => {
    const res = await request(app)
      .get("/api/admin/integrations/yse/orders")
      .query({ source: "machine", limit: 50 })
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const order = res.body.orders.find(
      (o: { externalOrderId: string }) => o.externalOrderId === MACHINE_ORDER_ID,
    );
    expect(order).toBeTruthy();
    expect(order.externalSource).toBe("machine");
    expect(order.btsRef).toBe(MACHINE_BTS_REF);
    expect(order.funnelSlug).toBe(MACHINE_FUNNEL);
    expect(order.portalProductKeys).toEqual(MACHINE_PORTAL_PRODUCT_KEYS);

    // The seeded Machine order grants exactly one product (TEST_TAG-prod)
    // while The Machine claimed to pay for two distinct portal_product_keys
    // — that's a mismatch and the endpoint should flag it as such.
    expect(order.mismatch).toBe(true);
    expect(res.body.mismatchSummary).toBeTruthy();
    expect(res.body.mismatchSummary.machineOrdersInView).toBeGreaterThanOrEqual(
      1,
    );
    expect(
      res.body.mismatchSummary.machineOrdersWithMismatch,
    ).toBeGreaterThanOrEqual(1);

    // Default (yse) view must not leak Machine orders.
    const yseRes = await request(app)
      .get("/api/admin/integrations/yse/orders")
      .query({ limit: 50 })
      .set("Cookie", adminCookie);
    expect(yseRes.status).toBe(200);
    const machineLeak = yseRes.body.orders.find(
      (o: { externalOrderId: string }) => o.externalOrderId === MACHINE_ORDER_ID,
    );
    expect(machineLeak).toBeUndefined();
  });

  it("returns both YSE and Machine orders when source=any", async () => {
    const res = await request(app)
      .get("/api/admin/integrations/yse/orders")
      .query({ source: "any", limit: 100 })
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const orderIds = res.body.orders.map(
      (o: { externalOrderId: string }) => o.externalOrderId,
    );
    expect(orderIds).toContain(YSE_ORDER_ID);
    expect(orderIds).toContain(MACHINE_ORDER_ID);
  });

  it("filters by btsRef (affiliate code)", async () => {
    const res = await request(app)
      .get("/api/admin/integrations/yse/orders")
      .query({ source: "any", btsRef: MACHINE_BTS_REF, limit: 50 })
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const orderIds = res.body.orders.map(
      (o: { externalOrderId: string }) => o.externalOrderId,
    );
    expect(orderIds).toEqual([MACHINE_ORDER_ID]);
  });

  it("CSV export includes the bts_ref and funnel_slug columns for Machine rows", async () => {
    const res = await request(app)
      .get("/api/admin/integrations/yse/orders/export")
      .query({ source: "machine" })
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const csv = res.text;
    expect(csv.split("\n")[0]).toBe(
      "order_id,source,customer_email,product_slug,product_name,granted_at,was_new_user,bts_ref,funnel_slug,portal_product_keys,mismatch",
    );
    expect(csv).toContain(MACHINE_ORDER_ID);
    expect(csv).toContain(MACHINE_BTS_REF);
    expect(csv).toContain(MACHINE_FUNNEL);
    // portal_product_keys cell is JSON-serialized and then csv-escaped
    // (embedded quotes get doubled). Assert against the unescaped JSON
    // form being present in some shape inside the row.
    const machineRow = csv
      .split("\n")
      .find((line) => line.includes(MACHINE_ORDER_ID))!;
    expect(machineRow).toContain("yse_front_end");
    expect(machineRow).toContain("yse_cmo_bump");
    // The seeded Machine order under-grants vs. its portal_product_keys, so
    // the mismatch column (the last cell on the row) must be "true".
    expect(machineRow.trimEnd().endsWith(",true")).toBe(true);
  });

  it("flags every shape of key mismatch and leaves matching / no-keys orders alone", async () => {
    const res = await request(app)
      .get("/api/admin/integrations/yse/orders")
      .query({ source: "machine", limit: 100 })
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    type Order = {
      externalOrderId: string;
      mismatch: boolean;
      portalProductKeys: string[];
      products: Array<{ slug: string }>;
    };
    const byId = new Map<string, Order>(
      (res.body.orders as Order[]).map((o) => [o.externalOrderId, o]),
    );

    // (a) under-grant: granted ⊂ portal_product_keys → mismatch=true
    expect(byId.get(MACHINE_ORDER_ID)?.mismatch).toBe(true);

    // (b) over-grant: granted ⊃ portal_product_keys → mismatch=true
    const over = byId.get(OVER_GRANT_ORDER_ID);
    expect(over).toBeTruthy();
    expect(over!.mismatch).toBe(true);
    expect(over!.products.map((p) => p.slug).sort()).toEqual(
      [`${TEST_TAG}-prod`, `${TEST_TAG}-prod-b`].sort(),
    );
    expect(over!.portalProductKeys).toEqual([`${TEST_TAG}-prod`]);

    // (c) disjoint: granted ∩ portal_product_keys = ∅ → mismatch=true
    const disjoint = byId.get(DISJOINT_ORDER_ID);
    expect(disjoint).toBeTruthy();
    expect(disjoint!.mismatch).toBe(true);
    expect(disjoint!.portalProductKeys).toEqual(["totally_other_key"]);

    // (d) exact match: granted set == portal_product_keys → mismatch=false
    const exact = byId.get(EXACT_ORDER_ID);
    expect(exact).toBeTruthy();
    expect(exact!.mismatch).toBe(false);
    expect(exact!.products.map((p) => p.slug).sort()).toEqual(
      [`${TEST_TAG}-prod`, `${TEST_TAG}-prod-b`].sort(),
    );
    expect(exact!.portalProductKeys.slice().sort()).toEqual(
      [`${TEST_TAG}-prod`, `${TEST_TAG}-prod-b`].sort(),
    );

    // (e) no portal_product_keys captured at all → mismatch=false (the
    // heuristic has nothing to compare against and must stay quiet).
    const noKeys = byId.get(NO_KEYS_ORDER_ID);
    expect(noKeys).toBeTruthy();
    expect(noKeys!.mismatch).toBe(false);
    expect(noKeys!.portalProductKeys).toEqual([]);

    // The page-scoped summary must count exactly the mismatching orders we
    // seeded (under-grant + over-grant + disjoint = 3), and the
    // machineOrdersInView count must include the not-flagged ones too.
    const seededMismatches = [
      MACHINE_ORDER_ID,
      OVER_GRANT_ORDER_ID,
      DISJOINT_ORDER_ID,
    ];
    const seededAllMachine = [
      ...seededMismatches,
      EXACT_ORDER_ID,
      NO_KEYS_ORDER_ID,
    ];
    expect(
      res.body.mismatchSummary.machineOrdersWithMismatch,
    ).toBeGreaterThanOrEqual(seededMismatches.length);
    expect(
      res.body.mismatchSummary.machineOrdersInView,
    ).toBeGreaterThanOrEqual(seededAllMachine.length);
  });
});
