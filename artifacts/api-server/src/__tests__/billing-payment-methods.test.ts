/**
 * Payment Methods tests — saved cards via NMI Customer Vault (Tier 4a backend)
 *
 * Covers:
 *  1.  Save a card → vault_id + masked metadata stored; no charge; no PAN persisted
 *  2.  vault_id never appears in any response
 *  3.  First saved card → is_default=true automatically
 *  4.  Setting a new default clears the previous one (exactly one default)
 *  5.  List cards — masked fields + id + is_default; no vault_id
 *  6.  Ownership: list/set-default/delete/charge with foreign id → 404, gateway never called
 *  7.  DELETE — vault delete + row remove; vault failure keeps row and returns error
 *  8.  Checkout with paymentMethodId → vault charge, grant identical to token path
 *  9.  Checkout with paymentMethodId of another user's card → 404, gateway never called
 * 10.  Declined saved-card charge → 402, no grant
 * 11.  Checkout rejects both paymentToken+paymentMethodId; rejects neither
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  btsOrdersTable,
  checkoutIdempotencyTable,
  auditLogTable,
  paymentMethodsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { buildTestApp } from "./test-app";
import billingRouter from "../routes/billing";

const TEST_TAG = `pm-test-${randomUUID().slice(0, 8)}`;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    queueEmail: vi.fn().mockResolvedValue(undefined),
    queueSms: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: vi.fn().mockResolvedValue("job_id"),
  startWorker: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

vi.mock("../lib/webhook-events", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
  WEBHOOK_EVENT_TYPES: [],
}));

vi.mock("../lib/commissions", () => ({
  ensureAffiliateProfile: vi.fn().mockResolvedValue(null),
  resolveUserCommissionTier: vi.fn().mockResolvedValue(null),
}));

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

function vaultAddResponse(vaultId = "VAULT_001"): Response {
  const body = new URLSearchParams({
    response: "1",
    responsetext: "Customer Added",
    customer_vault_id: vaultId,
  }).toString();
  return { ok: true, status: 200, text: async () => body } as unknown as Response;
}

function vaultDeleteResponse(success = true): Response {
  const body = new URLSearchParams({
    response: success ? "1" : "2",
    responsetext: success ? "Customer Deleted" : "Delete Failed",
    customer_vault_id: "",
  }).toString();
  return { ok: true, status: 200, text: async () => body } as unknown as Response;
}

function nmiApprovedResponse(transactionId = "TXN_VAULT_001"): Response {
  const body = new URLSearchParams({
    response: "1",
    responsetext: "SUCCESS",
    authcode: "123456",
    transactionid: transactionId,
    response_code: "100",
  }).toString();
  return { ok: true, status: 200, text: async () => body } as unknown as Response;
}

function nmiDeclinedResponse(): Response {
  const body = new URLSearchParams({
    response: "2",
    responsetext: "DECLINED",
    authcode: "",
    transactionid: "",
    response_code: "200",
  }).toString();
  return { ok: true, status: 200, text: async () => body } as unknown as Response;
}

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
const seededOrderIds: number[] = [];
const seededIdempotencyKeys: string[] = [];
const seededPaymentMethodIds: number[] = [];

let app: ReturnType<typeof buildTestApp>;
let authCookie: string;
let testUserId: number;
let otherUserId: number;
let otherAuthCookie: string;
let nmiProductId: number;

beforeAll(async () => {
  process.env.BTS_NMI_SECURITY_KEY = "demo_sandbox_key_test";
  process.env.BTS_NMI_TOKENIZATION_KEY = "demo_public_key_test";

  const [user] = await db
    .insert(usersTable)
    .values({
      name: "PM Test User",
      email: `${TEST_TAG}@example.com`,
      passwordHash: await bcrypt.hash("pw", 4),
      role: "member",
      emailVerified: true,
    })
    .returning();
  testUserId = user.id;
  seededUserIds.push(user.id);
  authCookie = signCookie(user.id, user.email);

  const [other] = await db
    .insert(usersTable)
    .values({
      name: "PM Other User",
      email: `${TEST_TAG}-other@example.com`,
      passwordHash: await bcrypt.hash("pw", 4),
      role: "member",
      emailVerified: true,
    })
    .returning();
  otherUserId = other.id;
  seededUserIds.push(other.id);
  otherAuthCookie = signCookie(other.id, other.email);

  const [nmiProd] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-nmi-pm`,
      name: "NMI PM Product",
      type: "frontend",
      entitlementKeys: ["content:frontend"],
      priceCents: 9900,
      currency: "USD",
      billingType: "one_time",
      itemType: "entitlement",
      isNativeNmi: true,
    })
    .returning();
  nmiProductId = nmiProd.id;
  seededProductIds.push(nmiProd.id);

  app = buildTestApp({ routers: [billingRouter] });
});

afterAll(async () => {
  if (seededPaymentMethodIds.length > 0) {
    await db
      .delete(paymentMethodsTable)
      .where(inArray(paymentMethodsTable.id, seededPaymentMethodIds));
  }
  await db
    .delete(paymentMethodsTable)
    .where(inArray(paymentMethodsTable.userId, seededUserIds));
  if (seededIdempotencyKeys.length > 0) {
    await db
      .delete(checkoutIdempotencyTable)
      .where(inArray(checkoutIdempotencyTable.idempotencyKey, seededIdempotencyKeys));
  }
  // Delete ALL orders for test users (not just tracked ones) so order_items
  // are cascade-deleted before we attempt to remove the products.
  if (seededUserIds.length > 0) {
    await db.delete(btsOrdersTable).where(inArray(btsOrdersTable.userId, seededUserIds));
  }
  await db
    .delete(userProductsTable)
    .where(
      and(
        inArray(userProductsTable.userId, seededUserIds),
        inArray(userProductsTable.productId, seededProductIds),
      ),
    );
  if (seededProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, seededProductIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  fetchMock.mockReset();
});

// ── Helper: save a card for testUserId ───────────────────────────────────────

async function saveTestCard(vaultId = `VAULT_${randomUUID().slice(0, 8)}`): Promise<number> {
  fetchMock.mockResolvedValueOnce(vaultAddResponse(vaultId));
  const res = await request(app)
    .post("/api/billing/payment-methods")
    .set("Cookie", authCookie)
    .send({ paymentToken: "tok_test", last4: "4242", brand: "Visa", expMonth: 12, expYear: 2030 });
  expect(res.status).toBe(201);
  const id = res.body.id as number;
  seededPaymentMethodIds.push(id);
  return id;
}

// ── 1. Save a card ────────────────────────────────────────────────────────────

describe("POST /api/billing/payment-methods — save a card", () => {
  it("stores vault_id + masked metadata; does not charge; does not return vault_id", async () => {
    const vaultId = `VAULT_SAVE_${randomUUID().slice(0, 6)}`;
    fetchMock.mockResolvedValueOnce(vaultAddResponse(vaultId));

    const res = await request(app)
      .post("/api/billing/payment-methods")
      .set("Cookie", authCookie)
      .send({ paymentToken: "tok_save_1", last4: "4242", brand: "Visa", expMonth: 12, expYear: 2030 });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.last4).toBe("4242");
    expect(res.body.brand).toBe("Visa");
    expect(res.body.expMonth).toBe(12);
    expect(res.body.expYear).toBe(2030);
    expect(res.body.vaultId).toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const posted = new URLSearchParams(opts.body as string);
    expect(posted.get("customer_vault")).toBe("add_customer");
    expect(posted.get("type")).toBeNull();

    const row = await db
      .select()
      .from(paymentMethodsTable)
      .where(eq(paymentMethodsTable.id, res.body.id))
      .limit(1);
    expect(row).toHaveLength(1);
    expect(row[0].vaultId).toBe(vaultId);
    expect(row[0].last4).toBe("4242");
    seededPaymentMethodIds.push(res.body.id as number);
  });

  it("first saved card automatically becomes default", async () => {
    const [existing] = await db
      .select({ id: paymentMethodsTable.id })
      .from(paymentMethodsTable)
      .where(eq(paymentMethodsTable.userId, testUserId))
      .limit(1);

    if (existing) {
      await db
        .delete(paymentMethodsTable)
        .where(eq(paymentMethodsTable.userId, testUserId));
    }

    const vaultId = `VAULT_FIRST_${randomUUID().slice(0, 6)}`;
    fetchMock.mockResolvedValueOnce(vaultAddResponse(vaultId));

    const res = await request(app)
      .post("/api/billing/payment-methods")
      .set("Cookie", authCookie)
      .send({ paymentToken: "tok_first", last4: "1111", brand: "Mastercard", expMonth: 6, expYear: 2028 });

    expect(res.status).toBe(201);
    expect(res.body.isDefault).toBe(true);
    seededPaymentMethodIds.push(res.body.id as number);
  });

  it("returns 401 when not authenticated", async () => {
    const res = await request(app)
      .post("/api/billing/payment-methods")
      .send({ paymentToken: "tok_test", last4: "4242", brand: "Visa", expMonth: 12, expYear: 2030 });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when paymentToken is missing", async () => {
    const res = await request(app)
      .post("/api/billing/payment-methods")
      .set("Cookie", authCookie)
      .send({ last4: "4242", brand: "Visa", expMonth: 12, expYear: 2030 });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when last4 is not 4 digits", async () => {
    const res = await request(app)
      .post("/api/billing/payment-methods")
      .set("Cookie", authCookie)
      .send({ paymentToken: "tok_test", last4: "123456789012", brand: "Visa", expMonth: 12, expYear: 2030 });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when paymentToken contains a PAN-like digit run", async () => {
    const res = await request(app)
      .post("/api/billing/payment-methods")
      .set("Cookie", authCookie)
      .send({ paymentToken: "4111111111111111", last4: "1111", brand: "Visa", expMonth: 12, expYear: 2030 });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when paymentToken is a PAN separated by dots", async () => {
    const res = await request(app)
      .post("/api/billing/payment-methods")
      .set("Cookie", authCookie)
      .send({ paymentToken: "4111.1111.1111.1111", last4: "1111", brand: "Visa", expMonth: 12, expYear: 2030 });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when paymentToken is a PAN separated by Unicode space separators", async () => {
    // U+2002 EN SPACE is a Unicode general-category Separator
    const token = "4111\u20021111\u20021111\u20021111";
    const res = await request(app)
      .post("/api/billing/payment-methods")
      .set("Cookie", authCookie)
      .send({ paymentToken: token, last4: "1111", brand: "Visa", expMonth: 12, expYear: 2030 });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when brand is not a known card network", async () => {
    const res = await request(app)
      .post("/api/billing/payment-methods")
      .set("Cookie", authCookie)
      .send({ paymentToken: "tok_test", last4: "4242", brand: "4111111111111111", expMonth: 12, expYear: 2030 });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── 2. List cards ─────────────────────────────────────────────────────────────

describe("GET /api/billing/payment-methods", () => {
  it("returns masked cards with no vault_id", async () => {
    const id = await saveTestCard();

    const res = await request(app)
      .get("/api/billing/payment-methods")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.paymentMethods)).toBe(true);
    const found = (res.body.paymentMethods as Array<Record<string, unknown>>).find((m) => m.id === id);
    expect(found).toBeDefined();
    expect(found!.vaultId).toBeUndefined();
    expect(found!.last4).toBe("4242");
  });

  it("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/billing/payment-methods");
    expect(res.status).toBe(401);
  });
});

// ── 3. Set default ────────────────────────────────────────────────────────────

describe("POST /api/billing/payment-methods/:id/default", () => {
  it("sets a card as default and clears the prior default", async () => {
    await db
      .delete(paymentMethodsTable)
      .where(eq(paymentMethodsTable.userId, testUserId));

    const id1 = await saveTestCard(`VAULT_DEF1_${randomUUID().slice(0, 6)}`);
    const id2 = await saveTestCard(`VAULT_DEF2_${randomUUID().slice(0, 6)}`);

    const row1Before = await db
      .select()
      .from(paymentMethodsTable)
      .where(eq(paymentMethodsTable.id, id1))
      .limit(1);
    expect(row1Before[0].isDefault).toBe(true);

    const res = await request(app)
      .post(`/api/billing/payment-methods/${id2}/default`)
      .set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const row1After = await db
      .select()
      .from(paymentMethodsTable)
      .where(eq(paymentMethodsTable.id, id1))
      .limit(1);
    const row2After = await db
      .select()
      .from(paymentMethodsTable)
      .where(eq(paymentMethodsTable.id, id2))
      .limit(1);

    expect(row1After[0].isDefault).toBe(false);
    expect(row2After[0].isDefault).toBe(true);
  });

  it("returns 404 for a foreign card id (other user's card)", async () => {
    const otherId = await db
      .insert(paymentMethodsTable)
      .values({
        userId: otherUserId,
        vaultId: `VAULT_OTHER_${randomUUID().slice(0, 6)}`,
        last4: "9999",
        brand: "Amex",
        expMonth: 1,
        expYear: 2029,
        isDefault: false,
      })
      .returning({ id: paymentMethodsTable.id });
    seededPaymentMethodIds.push(otherId[0].id);

    const res = await request(app)
      .post(`/api/billing/payment-methods/${otherId[0].id}/default`)
      .set("Cookie", authCookie);
    expect(res.status).toBe(404);
  });
});

// ── 4. Delete ─────────────────────────────────────────────────────────────────

describe("DELETE /api/billing/payment-methods/:id", () => {
  it("deletes from vault and removes the row", async () => {
    const id = await saveTestCard(`VAULT_DEL_${randomUUID().slice(0, 6)}`);
    fetchMock.mockResolvedValueOnce(vaultDeleteResponse(true));

    const res = await request(app)
      .delete(`/api/billing/payment-methods/${id}`)
      .set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
    const posted = new URLSearchParams(lastCall[1].body as string);
    expect(posted.get("customer_vault")).toBe("delete_customer");

    const rows = await db
      .select()
      .from(paymentMethodsTable)
      .where(eq(paymentMethodsTable.id, id));
    expect(rows).toHaveLength(0);
    seededPaymentMethodIds.splice(seededPaymentMethodIds.indexOf(id), 1);
  });

  it("surfaces error and keeps the row when vault delete fails", async () => {
    const id = await saveTestCard(`VAULT_DELFAIL_${randomUUID().slice(0, 6)}`);
    fetchMock.mockResolvedValueOnce(vaultDeleteResponse(false));

    const res = await request(app)
      .delete(`/api/billing/payment-methods/${id}`)
      .set("Cookie", authCookie);
    expect(res.status).toBe(502);

    const rows = await db
      .select()
      .from(paymentMethodsTable)
      .where(eq(paymentMethodsTable.id, id));
    expect(rows).toHaveLength(1);
  });

  it("returns 404 for a foreign card id", async () => {
    const otherId = await db
      .insert(paymentMethodsTable)
      .values({
        userId: otherUserId,
        vaultId: `VAULT_OWNDEL_${randomUUID().slice(0, 6)}`,
        last4: "8888",
        brand: "Visa",
        expMonth: 3,
        expYear: 2027,
        isDefault: false,
      })
      .returning({ id: paymentMethodsTable.id });
    seededPaymentMethodIds.push(otherId[0].id);

    const res = await request(app)
      .delete(`/api/billing/payment-methods/${otherId[0].id}`)
      .set("Cookie", authCookie);
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── 5. Checkout with paymentMethodId ──────────────────────────────────────────

describe("POST /api/billing/checkout — paymentMethodId", () => {
  it("charges via vault and grants entitlements identically to token path", async () => {
    const id = await saveTestCard(`VAULT_CO_${randomUUID().slice(0, 6)}`);
    const iKey = `${TEST_TAG}-co-vault-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);
    fetchMock.mockResolvedValueOnce(nmiApprovedResponse("TXN_VAULT_CO_001"));

    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({ productId: nmiProductId, paymentMethodId: id, idempotencyKey: iKey });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("paid");
    expect(res.body.orderNumber).toBeDefined();

    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
    const posted = new URLSearchParams(lastCall[1].body as string);
    expect(posted.get("type")).toBe("sale");
    expect(posted.get("customer_vault_id")).toBeTruthy();
    expect(posted.get("payment_token")).toBeNull();

    const order = await db
      .select()
      .from(btsOrdersTable)
      .where(eq(btsOrdersTable.orderNumber, res.body.orderNumber))
      .limit(1);
    expect(order[0].status).toBe("paid");
    seededOrderIds.push(order[0].id);

    const grant = await db
      .select()
      .from(userProductsTable)
      .where(and(eq(userProductsTable.userId, testUserId), eq(userProductsTable.productId, nmiProductId)))
      .limit(1);
    expect(grant).toHaveLength(1);
    expect(grant[0].externalSource).toBe("nmi");
  });

  it("returns 402 on a declined vault charge — no grant", async () => {
    const id = await saveTestCard(`VAULT_DECL_${randomUUID().slice(0, 6)}`);
    const iKey = `${TEST_TAG}-co-decl-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);
    fetchMock.mockResolvedValueOnce(nmiDeclinedResponse());

    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({ productId: nmiProductId, paymentMethodId: id, idempotencyKey: iKey });

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/declined/i);

    const orders = await db
      .select()
      .from(btsOrdersTable)
      .where(eq(btsOrdersTable.email, `${TEST_TAG}@example.com`));
    const failed = orders.find((o) => o.status === "failed" && o.userId === testUserId);
    expect(failed).toBeDefined();
    if (failed) seededOrderIds.push(failed.id);

    const grant = await db
      .select()
      .from(userProductsTable)
      .where(and(eq(userProductsTable.userId, testUserId), eq(userProductsTable.externalOrderId, failed!.orderNumber)))
      .limit(1);
    expect(grant).toHaveLength(0);
  });

  it("returns 404 for another user's paymentMethodId — gateway never called", async () => {
    const otherPm = await db
      .insert(paymentMethodsTable)
      .values({
        userId: otherUserId,
        vaultId: `VAULT_CROSS_${randomUUID().slice(0, 6)}`,
        last4: "7777",
        brand: "Visa",
        expMonth: 4,
        expYear: 2026,
        isDefault: false,
      })
      .returning({ id: paymentMethodsTable.id });
    seededPaymentMethodIds.push(otherPm[0].id);

    const iKey = `${TEST_TAG}-co-cross-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);

    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({ productId: nmiProductId, paymentMethodId: otherPm[0].id, idempotencyKey: iKey });

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── 5b. Idempotency replay after card deletion ────────────────────────────────

describe("POST /api/billing/checkout — idempotency replay after card deletion", () => {
  it("replays stored paid result even when the saved card has since been deleted", async () => {
    const iKey = `${TEST_TAG}-replay-del-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);

    await db.insert(checkoutIdempotencyTable).values({
      idempotencyKey: iKey,
      userId: testUserId,
      productId: nmiProductId,
      status: "completed",
      orderId: null,
      result: {
        outcomeType: "paid",
        status: "paid",
        orderNumber: "NMI-REPLAY-DEL-001",
        transactionId: "TXN_DEL_REPLAY",
        grantedEntitlements: ["content:frontend"],
        grantPending: false,
      },
      completedAt: new Date(),
    });

    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({ productId: nmiProductId, paymentMethodId: 999999999, idempotencyKey: iKey });

    expect(res.status).toBe(200);
    expect(res.body.orderNumber).toBe("NMI-REPLAY-DEL-001");
    expect(res.body.status).toBe("paid");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── 5c. Concurrent set-default cannot leave two defaults ──────────────────────

describe("payment_methods — at-most-one-default DB guarantee", () => {
  it("DB partial unique index prevents two is_default=true rows for the same user", async () => {
    // Insert a row directly with is_default=true
    const [row1] = await db
      .insert(paymentMethodsTable)
      .values({
        userId: otherUserId,
        vaultId: `VAULT_DUP1_${randomUUID().slice(0, 6)}`,
        last4: "1111",
        brand: "Visa",
        expMonth: 12,
        expYear: 2030,
        isDefault: true,
      })
      .returning({ id: paymentMethodsTable.id });
    seededPaymentMethodIds.push(row1.id);

    // A second insert with is_default=true for the same user must be rejected
    await expect(
      db.insert(paymentMethodsTable).values({
        userId: otherUserId,
        vaultId: `VAULT_DUP2_${randomUUID().slice(0, 6)}`,
        last4: "2222",
        brand: "Mastercard",
        expMonth: 6,
        expYear: 2028,
        isDefault: true,
      }),
    ).rejects.toThrow();

    // Confirm exactly one default exists for otherUserId
    const defaults = await db
      .select({ id: paymentMethodsTable.id })
      .from(paymentMethodsTable)
      .where(
        and(
          eq(paymentMethodsTable.userId, otherUserId),
          eq(paymentMethodsTable.isDefault, true),
        ),
      );
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(row1.id);
  });

  it("setDefaultPaymentMethod leaves exactly one default even when called twice in sequence", async () => {
    await db.delete(paymentMethodsTable).where(eq(paymentMethodsTable.userId, testUserId));

    const id1 = await saveTestCard(`VAULT_SEQDEF1_${randomUUID().slice(0, 6)}`);
    const id2 = await saveTestCard(`VAULT_SEQDEF2_${randomUUID().slice(0, 6)}`);

    // Set id2 as default
    const r1 = await request(app)
      .post(`/api/billing/payment-methods/${id2}/default`)
      .set("Cookie", authCookie);
    expect(r1.status).toBe(200);

    // Set id1 as default
    const r2 = await request(app)
      .post(`/api/billing/payment-methods/${id1}/default`)
      .set("Cookie", authCookie);
    expect(r2.status).toBe(200);

    // Exactly one default must exist
    const defaults = await db
      .select({ id: paymentMethodsTable.id })
      .from(paymentMethodsTable)
      .where(
        and(
          eq(paymentMethodsTable.userId, testUserId),
          eq(paymentMethodsTable.isDefault, true),
        ),
      );
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(id1);
  });
});

// ── 6. Checkout validation ────────────────────────────────────────────────────

describe("POST /api/billing/checkout — paymentToken/paymentMethodId mutual exclusion", () => {
  it("returns 400 when neither token nor methodId is provided", async () => {
    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({ productId: nmiProductId, idempotencyKey: randomUUID() });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when both token and methodId are provided", async () => {
    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({ productId: nmiProductId, paymentToken: "tok_test", paymentMethodId: 1, idempotencyKey: randomUUID() });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
