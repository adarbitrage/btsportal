/**
 * Customer Ops API tests — /api/ops
 *
 * Covers:
 *  1. Auth: no key → 401; wrong key → 401; member session → 401; correct key → passes
 *  2. One-time refund: charge reversed, order status=refunded, that order's grant revoked
 *  3. Subscription refund: sub canceled + sub grant revoked; sub NOT picked up by processDueRenewals
 *  4. Partial refund: order status=partial_refunded, grant NOT revoked
 *  5. Idempotent double-refund: one gateway hit, second call replays stored result
 *  6. Already-refunded order: no second gateway hit, 409
 *  7. Amount validation: NaN, ≤0, fractional, over-total → 400
 *  8. Ownership: refund does not touch other products' entitlements
 *  9. GET orders-by-email and customer aggregate read endpoints
 * 10. POST access grant/revoke
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
  btsOrderItemsTable,
  subscriptionsTable,
  paymentMethodsTable,
  refundIdempotencyTable,
  auditLogTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { buildTestApp } from "./test-app";
import opsRouter from "../routes/ops";
import billingRouter from "../routes/billing";
import { processDueRenewals } from "../lib/renewal-charger";

const TEST_TAG = `ops-refund-${randomUUID().slice(0, 8)}`;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const OPS_KEY = `test-ops-key-${randomUUID().slice(0, 8)}`;

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
  return `access_token=${jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" })}`;
}

function nmiApproved(transactionId = "TXN_OPS_001"): Response {
  const body = new URLSearchParams({
    response: "1",
    responsetext: "SUCCESS",
    authcode: "123456",
    transactionid: transactionId,
    response_code: "100",
  }).toString();
  return { ok: true, status: 200, text: async () => body } as unknown as Response;
}

function nmiDeclined(): Response {
  const body = new URLSearchParams({
    response: "2",
    responsetext: "DECLINED",
    authcode: "",
    transactionid: "",
    response_code: "200",
  }).toString();
  return { ok: true, status: 200, text: async () => body } as unknown as Response;
}

function nmiQueryResponse(condition = "complete"): Response {
  const body = `<condition>${condition}</condition>`;
  return { ok: true, status: 200, text: async () => body } as unknown as Response;
}

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
const seededOrderIds: number[] = [];
const seededSubIds: number[] = [];
const seededPaymentMethodIds: number[] = [];
const seededIdempotencyKeys: string[] = [];

let app: ReturnType<typeof buildTestApp>;
let testUserId: number;
let testUserEmail: string;
let testUserCookie: string;
let otherUserId: number;
let nmiProductId: number;
let subProductId: number;
let otherProductId: number;

beforeEach(() => {
  fetchMock.mockClear();
});

beforeAll(async () => {
  process.env.OPS_API_KEY = OPS_KEY;
  process.env.BTS_NMI_SECURITY_KEY = "demo_sandbox_key_test";
  process.env.BTS_NMI_TOKENIZATION_KEY = "demo_public_key_test";
  process.env.NMI_LIVE_MODE = "true";

  app = buildTestApp({ routers: [opsRouter, billingRouter] });

  testUserEmail = `${TEST_TAG}-main@example.com`;

  const [user] = await db.insert(usersTable).values({
    name: "Ops Test User",
    email: testUserEmail,
    passwordHash: await bcrypt.hash("pw", 4),
    role: "member",
    emailVerified: true,
  }).returning();
  testUserId = user.id;
  seededUserIds.push(user.id);
  testUserCookie = signCookie(user.id, user.email);

  const [other] = await db.insert(usersTable).values({
    name: "Other User",
    email: `${TEST_TAG}-other@example.com`,
    passwordHash: await bcrypt.hash("pw", 4),
    role: "member",
    emailVerified: true,
  }).returning();
  otherUserId = other.id;
  seededUserIds.push(other.id);

  const [nmiProd] = await db.insert(productsTable).values({
    slug: `${TEST_TAG}-ops-product`,
    name: "Ops Test Product",
    type: "frontend",
    entitlementKeys: ["content:frontend"],
    priceCents: 9900,
    currency: "USD",
    billingType: "one_time",
    itemType: "entitlement",
    isNativeNmi: true,
  }).returning();
  nmiProductId = nmiProd.id;
  seededProductIds.push(nmiProd.id);

  const [subProd] = await db.insert(productsTable).values({
    slug: `${TEST_TAG}-ops-sub-product`,
    name: "Ops Sub Product",
    type: "frontend",
    entitlementKeys: ["content:sub"],
    priceCents: 4900,
    currency: "USD",
    billingType: "recurring",
    recurringInterval: "monthly",
    itemType: "entitlement",
    isNativeNmi: true,
  }).returning();
  subProductId = subProd.id;
  seededProductIds.push(subProd.id);

  const [otherProd] = await db.insert(productsTable).values({
    slug: `${TEST_TAG}-other-product`,
    name: "Other Product",
    type: "frontend",
    entitlementKeys: ["content:other"],
    priceCents: 2900,
    currency: "USD",
    billingType: "one_time",
    itemType: "entitlement",
    isNativeNmi: false,
  }).returning();
  otherProductId = otherProd.id;
  seededProductIds.push(otherProd.id);
});

afterAll(async () => {
  if (seededIdempotencyKeys.length > 0) {
    await db.delete(refundIdempotencyTable)
      .where(inArray(refundIdempotencyTable.idempotencyKey, seededIdempotencyKeys))
      .catch(() => {});
  }
  if (seededOrderIds.length > 0) {
    await db.delete(btsOrdersTable)
      .where(inArray(btsOrdersTable.id, seededOrderIds))
      .catch(() => {});
  }
  if (seededSubIds.length > 0) {
    await db.delete(subscriptionsTable)
      .where(inArray(subscriptionsTable.id, seededSubIds))
      .catch(() => {});
  }
  if (seededPaymentMethodIds.length > 0) {
    await db.delete(paymentMethodsTable)
      .where(inArray(paymentMethodsTable.id, seededPaymentMethodIds))
      .catch(() => {});
  }
  if (seededProductIds.length > 0) {
    await db.delete(userProductsTable)
      .where(inArray(userProductsTable.productId, seededProductIds))
      .catch(() => {});
    await db.delete(productsTable)
      .where(inArray(productsTable.id, seededProductIds))
      .catch(() => {});
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable)
      .where(inArray(usersTable.id, seededUserIds))
      .catch(() => {});
  }
  delete process.env.OPS_API_KEY;
});

function opsHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${OPS_KEY}` };
}

async function seedPaidOrder(opts: {
  userId: number;
  productId: number;
  email: string;
  totalCents?: number;
  orderType?: "one_time" | "recurring_initial";
  gatewayTransactionId?: string;
  subscriptionId?: number;
}): Promise<{ orderId: number; orderNumber: string }> {
  const orderNumber = `NMI-OPS-${randomUUID().slice(0, 8).toUpperCase()}`;
  const [order] = await db.insert(btsOrdersTable).values({
    orderNumber,
    userId: opts.userId,
    email: opts.email,
    totalCents: opts.totalCents ?? 9900,
    currency: "USD",
    status: "paid",
    gatewayTransactionId: opts.gatewayTransactionId ?? "TXN_EXISTING_001",
    orderType: opts.orderType ?? "one_time",
    subscriptionId: opts.subscriptionId ?? null,
  }).returning();
  seededOrderIds.push(order.id);

  await db.insert(btsOrderItemsTable).values({
    orderId: order.id,
    productId: opts.productId,
    description: "Test Product",
    unitPriceCents: opts.totalCents ?? 9900,
    quantity: 1,
  });

  return { orderId: order.id, orderNumber };
}

async function seedGrant(userId: number, productId: number, orderNumber: string): Promise<void> {
  await db.insert(userProductsTable).values({
    userId,
    productId,
    status: "active",
    externalSource: "nmi",
    externalOrderId: orderNumber,
  }).onConflictDoNothing();
}

async function seedPaymentMethod(userId: number): Promise<number> {
  const [pm] = await db.insert(paymentMethodsTable).values({
    userId,
    vaultId: `VAULT_OPS_${randomUUID().slice(0, 8)}`,
    last4: "4242",
    brand: "visa",
    expMonth: 12,
    expYear: 2030,
    isDefault: true,
  }).returning();
  seededPaymentMethodIds.push(pm.id);
  return pm.id;
}

async function seedActiveSubscription(userId: number, productId: number, paymentMethodId: number): Promise<number> {
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const [sub] = await db.insert(subscriptionsTable).values({
    userId,
    productId,
    paymentMethodId,
    status: "active",
    interval: "monthly",
    amountCents: 4900,
    currency: "USD",
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    nextChargeAt: periodEnd,
    retryCount: 0,
  }).returning();
  seededSubIds.push(sub.id);
  return sub.id;
}

// ─── Auth Tests ───────────────────────────────────────────────────────────────

describe("Ops service auth", () => {
  it("returns 401 with no key", async () => {
    const res = await request(app)
      .get(`/api/ops/customers/${encodeURIComponent(testUserEmail)}/orders`);
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong key", async () => {
    const res = await request(app)
      .get(`/api/ops/customers/${encodeURIComponent(testUserEmail)}/orders`)
      .set("Authorization", "Bearer wrong-key");
    expect(res.status).toBe(401);
  });

  it("returns 401 with a member JWT session (not accepted)", async () => {
    const res = await request(app)
      .get(`/api/ops/customers/${encodeURIComponent(testUserEmail)}/orders`)
      .set("Cookie", testUserCookie);
    expect(res.status).toBe(401);
  });

  it("passes with the correct OPS_API_KEY", async () => {
    const res = await request(app)
      .get(`/api/ops/customers/${encodeURIComponent(testUserEmail)}/orders`)
      .set(opsHeaders());
    expect(res.status).toBe(200);
  });
});

// ─── Amount Validation ────────────────────────────────────────────────────────

describe("Refund amount validation", () => {
  it("rejects amount_cents = 0", async () => {
    const res = await request(app)
      .post(`/api/ops/orders/ORDER-NOTEXIST/refund`)
      .set(opsHeaders())
      .send({ idempotency_key: `ik-${randomUUID()}`, amount_cents: 0 });
    expect(res.status).toBe(400);
  });

  it("rejects negative amount_cents", async () => {
    const res = await request(app)
      .post(`/api/ops/orders/ORDER-NOTEXIST/refund`)
      .set(opsHeaders())
      .send({ idempotency_key: `ik-${randomUUID()}`, amount_cents: -100 });
    expect(res.status).toBe(400);
  });

  it("rejects fractional amount_cents", async () => {
    const res = await request(app)
      .post(`/api/ops/orders/ORDER-NOTEXIST/refund`)
      .set(opsHeaders())
      .send({ idempotency_key: `ik-${randomUUID()}`, amount_cents: 9.99 });
    expect(res.status).toBe(400);
  });

  it("rejects NaN-like amount_cents string", async () => {
    const res = await request(app)
      .post(`/api/ops/orders/ORDER-NOTEXIST/refund`)
      .set(opsHeaders())
      .send({ idempotency_key: `ik-${randomUUID()}`, amount_cents: "abc" });
    expect(res.status).toBe(400);
  });
});

// ─── One-time full refund ─────────────────────────────────────────────────────

describe("One-time full refund", () => {
  it("reverses charge, sets order refunded, revokes this order grant only", async () => {
    const { orderNumber, orderId } = await seedPaidOrder({
      userId: testUserId,
      productId: nmiProductId,
      email: testUserEmail,
      gatewayTransactionId: "TXN_FULL_001",
    });
    await seedGrant(testUserId, nmiProductId, orderNumber);

    const otherOrderNumber = `NMI-OTHER-${randomUUID().slice(0, 8).toUpperCase()}`;
    await seedGrant(testUserId, otherProductId, otherOrderNumber);

    const ikey = `ik-full-${randomUUID()}`;
    seededIdempotencyKeys.push(ikey);

    fetchMock
      .mockResolvedValueOnce(nmiQueryResponse("complete"))
      .mockResolvedValueOnce(nmiApproved("TXN_REFUND_001"));

    const res = await request(app)
      .post(`/api/ops/orders/${orderNumber}/refund`)
      .set(opsHeaders())
      .send({ idempotency_key: ikey });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("success");
    expect(res.body.action).toBe("refund");
    expect(res.body.newStatus).toBe("refunded");
    expect(res.body.partial).toBe(false);
    expect(res.body.revoked).toBe(true);

    const [order] = await db.select().from(btsOrdersTable).where(eq(btsOrdersTable.id, orderId));
    expect(order.status).toBe("refunded");

    const thisGrant = await db.select().from(userProductsTable).where(
      and(
        eq(userProductsTable.userId, testUserId),
        eq(userProductsTable.productId, nmiProductId),
        eq(userProductsTable.externalOrderId, orderNumber),
      ),
    );
    expect(thisGrant[0]?.status).toBe("cancelled");

    const otherGrant = await db.select().from(userProductsTable).where(
      and(
        eq(userProductsTable.userId, testUserId),
        eq(userProductsTable.productId, otherProductId),
        eq(userProductsTable.externalOrderId, otherOrderNumber),
      ),
    );
    expect(otherGrant[0]?.status).toBe("active");
  });
});

// ─── Subscription refund ──────────────────────────────────────────────────────

describe("Subscription order refund", () => {
  it("cancels the sub, revokes sub grant, and sub is NOT picked up by processDueRenewals", async () => {
    const pmId = await seedPaymentMethod(testUserId);
    const subId = await seedActiveSubscription(testUserId, subProductId, pmId);

    const { orderNumber, orderId } = await seedPaidOrder({
      userId: testUserId,
      productId: subProductId,
      email: testUserEmail,
      totalCents: 4900,
      orderType: "recurring_initial",
      gatewayTransactionId: "TXN_SUB_ORD_001",
      subscriptionId: subId,
    });
    await seedGrant(testUserId, subProductId, orderNumber);

    const ikey = `ik-sub-${randomUUID()}`;
    seededIdempotencyKeys.push(ikey);

    fetchMock
      .mockResolvedValueOnce(nmiQueryResponse("complete"))
      .mockResolvedValueOnce(nmiApproved("TXN_SUB_REFUND_001"));

    const res = await request(app)
      .post(`/api/ops/orders/${orderNumber}/refund`)
      .set(opsHeaders())
      .send({ idempotency_key: ikey });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("success");
    expect(res.body.subscriptionCanceled).toBe(true);
    expect(res.body.revoked).toBe(true);

    const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, subId));
    expect(sub.status).toBe("canceled");
    expect(sub.nextChargeAt).toBeNull();

    const subGrant = await db.select().from(userProductsTable).where(
      and(
        eq(userProductsTable.userId, testUserId),
        eq(userProductsTable.productId, subProductId),
      ),
    );
    expect(subGrant[0]?.status).toBe("cancelled");

    fetchMock.mockResolvedValue(nmiApproved("TXN_UNUSED"));
    const renewalResult = await processDueRenewals({ now: new Date() });
    expect(renewalResult.succeeded).toBe(0);
  });
});

// ─── Partial refund ───────────────────────────────────────────────────────────

describe("Partial refund", () => {
  it("sets order to partial_refunded and does NOT revoke grant", async () => {
    const { orderNumber, orderId } = await seedPaidOrder({
      userId: testUserId,
      productId: nmiProductId,
      email: testUserEmail,
      totalCents: 9900,
      gatewayTransactionId: "TXN_PARTIAL_001",
    });
    await seedGrant(testUserId, nmiProductId, orderNumber);

    const ikey = `ik-partial-${randomUUID()}`;
    seededIdempotencyKeys.push(ikey);

    fetchMock.mockResolvedValueOnce(nmiApproved("TXN_PARTIAL_REFUND_001"));

    const res = await request(app)
      .post(`/api/ops/orders/${orderNumber}/refund`)
      .set(opsHeaders())
      .send({ idempotency_key: ikey, amount_cents: 5000 });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("success");
    expect(res.body.newStatus).toBe("partial_refunded");
    expect(res.body.partial).toBe(true);
    expect(res.body.revoked).toBeUndefined();

    const [order] = await db.select().from(btsOrdersTable).where(eq(btsOrdersTable.id, orderId));
    expect(order.status).toBe("partial_refunded");

    const grant = await db.select().from(userProductsTable).where(
      and(
        eq(userProductsTable.userId, testUserId),
        eq(userProductsTable.productId, nmiProductId),
        eq(userProductsTable.externalOrderId, orderNumber),
      ),
    );
    expect(grant[0]?.status).toBe("active");
  });
});

// ─── Idempotent double-refund ─────────────────────────────────────────────────

describe("Idempotent double-refund", () => {
  it("only hits the gateway once; second call replays the stored result", async () => {
    const { orderNumber } = await seedPaidOrder({
      userId: testUserId,
      productId: nmiProductId,
      email: testUserEmail,
      gatewayTransactionId: "TXN_IDEM_001",
    });

    const ikey = `ik-idem-${randomUUID()}`;
    seededIdempotencyKeys.push(ikey);

    fetchMock
      .mockResolvedValueOnce(nmiQueryResponse("complete"))
      .mockResolvedValueOnce(nmiApproved("TXN_IDEM_REFUND_001"));

    const first = await request(app)
      .post(`/api/ops/orders/${orderNumber}/refund`)
      .set(opsHeaders())
      .send({ idempotency_key: ikey });
    expect(first.status).toBe(200);
    expect(first.body.outcome).toBe("success");

    const second = await request(app)
      .post(`/api/ops/orders/${orderNumber}/refund`)
      .set(opsHeaders())
      .send({ idempotency_key: ikey });
    expect(second.status).toBe(200);
    expect(second.body.outcome).toBe("success");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ─── Already-refunded guard ───────────────────────────────────────────────────

describe("Already-refunded guard", () => {
  it("returns 409 without hitting the gateway when order is already refunded", async () => {
    const orderNumber = `NMI-ALREADYREF-${randomUUID().slice(0, 8).toUpperCase()}`;
    const [order] = await db.insert(btsOrdersTable).values({
      orderNumber,
      userId: testUserId,
      email: testUserEmail,
      totalCents: 9900,
      currency: "USD",
      status: "refunded",
      gatewayTransactionId: "TXN_ALREADY_001",
      orderType: "one_time",
    }).returning();
    seededOrderIds.push(order.id);
    await db.insert(btsOrderItemsTable).values({
      orderId: order.id,
      productId: nmiProductId,
      unitPriceCents: 9900,
      quantity: 1,
    });

    fetchMock.mockClear();

    const ikey = `ik-already-${randomUUID()}`;
    seededIdempotencyKeys.push(ikey);

    const res = await request(app)
      .post(`/api/ops/orders/${orderNumber}/refund`)
      .set(opsHeaders())
      .send({ idempotency_key: ikey });

    expect(res.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── Over-total amount validation ────────────────────────────────────────────

describe("Over-total amount validation", () => {
  it("rejects amount_cents greater than order total with 400", async () => {
    const { orderNumber } = await seedPaidOrder({
      userId: testUserId,
      productId: nmiProductId,
      email: testUserEmail,
      totalCents: 9900,
      gatewayTransactionId: "TXN_OVERTOTAL_001",
    });

    const ikey = `ik-overtotal-${randomUUID()}`;
    seededIdempotencyKeys.push(ikey);

    const res = await request(app)
      .post(`/api/ops/orders/${orderNumber}/refund`)
      .set(opsHeaders())
      .send({ idempotency_key: ikey, amount_cents: 99999 });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── Read endpoints ───────────────────────────────────────────────────────────

describe("GET /api/ops/customers/:email/orders", () => {
  it("returns orders for the given email", async () => {
    const uniqueEmail = `${TEST_TAG}-read@example.com`;
    const [readUser] = await db.insert(usersTable).values({
      name: "Read Test User",
      email: uniqueEmail,
      passwordHash: await bcrypt.hash("pw", 4),
      role: "member",
      emailVerified: true,
    }).returning();
    seededUserIds.push(readUser.id);

    const { orderNumber } = await seedPaidOrder({
      userId: readUser.id,
      productId: nmiProductId,
      email: uniqueEmail,
      totalCents: 9900,
    });

    const res = await request(app)
      .get(`/api/ops/customers/${encodeURIComponent(uniqueEmail)}/orders`)
      .set(opsHeaders());

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(uniqueEmail);
    expect(Array.isArray(res.body.orders)).toBe(true);
    const found = res.body.orders.find((o: Record<string, unknown>) => o.order_number === orderNumber);
    expect(found).toBeDefined();
    expect(found.refundable_amount_cents).toBe(9900);
  });
});

describe("GET /api/ops/customers/:email", () => {
  it("returns aggregate customer view with subscriptions", async () => {
    const res = await request(app)
      .get(`/api/ops/customers/${encodeURIComponent(testUserEmail)}`)
      .set(opsHeaders());

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(testUserEmail);
    expect(typeof res.body.total_orders).toBe("number");
    expect(Array.isArray(res.body.subscriptions)).toBe(true);
  });
});

// ─── Access grant/revoke ──────────────────────────────────────────────────────

describe("POST /api/ops/orders/:orderNumber/access", () => {
  it("grants access for an order", async () => {
    const { orderNumber } = await seedPaidOrder({
      userId: testUserId,
      productId: nmiProductId,
      email: testUserEmail,
    });

    await db.update(userProductsTable)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(
        and(
          eq(userProductsTable.userId, testUserId),
          eq(userProductsTable.productId, nmiProductId),
          eq(userProductsTable.status, "active"),
        ),
      );

    const res = await request(app)
      .post(`/api/ops/orders/${orderNumber}/access`)
      .set(opsHeaders())
      .send({ action: "grant", reason: "Test grant", actor: "ops@test.com" });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("grant");

    const grants = await db.select().from(userProductsTable).where(
      and(
        eq(userProductsTable.userId, testUserId),
        eq(userProductsTable.externalOrderId, orderNumber),
      ),
    );
    expect(grants.some((g) => g.status === "active")).toBe(true);
  });

  it("revokes access for an order", async () => {
    const { orderNumber } = await seedPaidOrder({
      userId: testUserId,
      productId: nmiProductId,
      email: testUserEmail,
    });
    await seedGrant(testUserId, nmiProductId, orderNumber);

    const res = await request(app)
      .post(`/api/ops/orders/${orderNumber}/access`)
      .set(opsHeaders())
      .send({ action: "revoke", reason: "Test revoke", actor: "ops@test.com" });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("revoke");

    const grants = await db.select().from(userProductsTable).where(
      and(
        eq(userProductsTable.userId, testUserId),
        eq(userProductsTable.externalOrderId, orderNumber),
        eq(userProductsTable.productId, nmiProductId),
      ),
    );
    expect(grants.every((g) => g.status !== "active")).toBe(true);
  });

  it("returns 400 for invalid action", async () => {
    const { orderNumber } = await seedPaidOrder({
      userId: testUserId,
      productId: nmiProductId,
      email: testUserEmail,
    });

    const res = await request(app)
      .post(`/api/ops/orders/${orderNumber}/access`)
      .set(opsHeaders())
      .send({ action: "delete", reason: "bad" });

    expect(res.status).toBe(400);
  });
});
