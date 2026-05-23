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

  const [product] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-prod`,
      name: `${TEST_TAG} product`,
      type: "backend",
      sortOrder: 99,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(product.id);

  await db.insert(userProductsTable).values({
    userId: yseBuyerId,
    productId: product.id,
    status: "active",
    externalSource: "yse",
    externalOrderId: YSE_ORDER_ID,
  });
  await db.insert(userProductsTable).values({
    userId: machineBuyerId,
    productId: product.id,
    status: "active",
    externalSource: "machine",
    externalOrderId: MACHINE_ORDER_ID,
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
    await db.delete(productsTable).where(eq(productsTable.id, seededProductIds[0]));
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
      "order_id,source,customer_email,product_slug,product_name,granted_at,was_new_user,bts_ref,funnel_slug,portal_product_keys",
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
  });
});
