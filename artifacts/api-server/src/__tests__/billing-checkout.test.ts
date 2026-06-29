/**
 * Billing checkout endpoint tests — POST /api/billing/checkout
 *
 * Covers:
 *  1. Successful charge → order pending→paid, transactionId stored, entitlement granted via user_products
 *  2. Forced decline → 402, order failed, nothing granted, no exception thrown
 *  3. Idempotency replay (same key twice) → one charge, stored result returned on second call
 *  4. Cross-product key collision → 409 IDEMPOTENCY_CONFLICT
 *  5. Server-authoritative pricing (no client amount accepted)
 *  6. wallet_topup product → paid order created, no user_products row inserted
 *  7. Non-native-NMI product → 400 rejection
 *  8. Missing / malformed request body → 400
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
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { buildTestApp } from "./test-app";
import billingRouter from "../routes/billing";

const TEST_TAG = `checkout-test-${randomUUID().slice(0, 8)}`;
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

function nmiApprovedResponse(transactionId = "TXN_TEST_001"): Response {
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

let app: ReturnType<typeof buildTestApp>;
let authCookie: string;
let testUserId: number;
let nmiProductId: number;
let walletProductId: number;
let nonNmiProductId: number;

beforeAll(async () => {
  process.env.BTS_NMI_SECURITY_KEY = "demo_sandbox_key_test";
  process.env.BTS_NMI_TOKENIZATION_KEY = "demo_public_key_test";

  const [user] = await db
    .insert(usersTable)
    .values({
      name: "Test Checkout User",
      email: `${TEST_TAG}@example.com`,
      passwordHash: await bcrypt.hash("pw", 4),
      role: "member",
      emailVerified: true,
    })
    .returning();
  testUserId = user.id;
  seededUserIds.push(user.id);
  authCookie = signCookie(user.id, user.email);

  const [nmiProd] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-nmi-entitlement`,
      name: "NMI Test Product",
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

  const [walletProd] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-wallet-topup`,
      name: "Wallet Top-Up",
      type: "frontend",
      entitlementKeys: [],
      priceCents: 5000,
      currency: "USD",
      billingType: "one_time",
      itemType: "wallet_topup",
      isNativeNmi: true,
    })
    .returning();
  walletProductId = walletProd.id;
  seededProductIds.push(walletProd.id);

  const [nonNmiProd] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-thrivecart`,
      name: "ThriveCart Product",
      type: "frontend",
      entitlementKeys: ["content:mentorship"],
      priceCents: 19900,
      currency: "USD",
      billingType: "one_time",
      itemType: "entitlement",
      isNativeNmi: false,
    })
    .returning();
  nonNmiProductId = nonNmiProd.id;
  seededProductIds.push(nonNmiProd.id);

  app = buildTestApp({ routers: [billingRouter] });
});

afterAll(async () => {
  if (seededIdempotencyKeys.length > 0) {
    await db
      .delete(checkoutIdempotencyTable)
      .where(inArray(checkoutIdempotencyTable.idempotencyKey, seededIdempotencyKeys));
  }
  if (seededOrderIds.length > 0) {
    await db.delete(btsOrdersTable).where(inArray(btsOrdersTable.id, seededOrderIds));
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
    await db
      .delete(auditLogTable)
      .where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  fetchMock.mockReset();
});

describe("POST /api/billing/checkout — successful charge", () => {
  it("returns 200, creates a paid order with transaction ID, and grants entitlements via user_products", async () => {
    const iKey = `${TEST_TAG}-success-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);
    fetchMock.mockResolvedValueOnce(nmiApprovedResponse("TXN_SUCCESS_001"));

    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({ productId: nmiProductId, paymentToken: "tok_test_approved", idempotencyKey: iKey });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("paid");
    expect(res.body.orderNumber).toBeDefined();
    expect(Array.isArray(res.body.grantedEntitlements)).toBe(true);

    const order = await db
      .select()
      .from(btsOrdersTable)
      .where(eq(btsOrdersTable.orderNumber, res.body.orderNumber))
      .limit(1);
    expect(order).toHaveLength(1);
    expect(order[0].status).toBe("paid");
    expect(order[0].gatewayTransactionId).toBe("TXN_SUCCESS_001");
    expect(order[0].totalCents).toBe(9900);
    seededOrderIds.push(order[0].id);

    const grant = await db
      .select()
      .from(userProductsTable)
      .where(
        and(
          eq(userProductsTable.userId, testUserId),
          eq(userProductsTable.productId, nmiProductId),
          eq(userProductsTable.status, "active"),
        ),
      )
      .limit(1);
    expect(grant).toHaveLength(1);
    expect(grant[0].externalSource).toBe("nmi");
    expect(grant[0].externalOrderId).toBe(res.body.orderNumber);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const posted = new URLSearchParams(opts.body as string);
    expect(posted.get("type")).toBe("sale");
    expect(posted.get("amount")).toBe("99.00");
  });

  it("server price is used — extra client fields are ignored", async () => {
    const iKey = `${TEST_TAG}-price-auth-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);
    fetchMock.mockResolvedValueOnce(nmiApprovedResponse("TXN_PRICEAUTH_001"));

    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({
        productId: nmiProductId,
        paymentToken: "tok_test_approved",
        idempotencyKey: iKey,
        amount: 1,
      });

    expect(res.status).toBe(200);
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const posted = new URLSearchParams(opts.body as string);
    expect(posted.get("amount")).toBe("99.00");
    const order2 = await db
      .select()
      .from(btsOrdersTable)
      .where(eq(btsOrdersTable.orderNumber, res.body.orderNumber))
      .limit(1);
    if (order2.length > 0) seededOrderIds.push(order2[0].id);
  });
});

describe("POST /api/billing/checkout — decline", () => {
  it("returns 402, order is failed, no entitlement granted, no exception thrown", async () => {
    const iKey = `${TEST_TAG}-decline-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);
    fetchMock.mockResolvedValueOnce(nmiDeclinedResponse());

    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({ productId: nmiProductId, paymentToken: "tok_decline", idempotencyKey: iKey });

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/declined/i);

    const orders = await db
      .select()
      .from(btsOrdersTable)
      .where(eq(btsOrdersTable.email, `${TEST_TAG}@example.com`));

    const failedOrder = orders.find((o) => o.status === "failed");
    if (failedOrder) seededOrderIds.push(failedOrder.id);
    expect(failedOrder).toBeDefined();

    const grant = await db
      .select()
      .from(userProductsTable)
      .where(
        and(
          eq(userProductsTable.userId, testUserId),
          eq(userProductsTable.externalOrderId, failedOrder!.orderNumber),
        ),
      )
      .limit(1);
    expect(grant).toHaveLength(0);
  });
});

describe("POST /api/billing/checkout — idempotency", () => {
  it("replays a successful result on the second call without a second charge", async () => {
    const iKey = `${TEST_TAG}-replay-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);
    fetchMock.mockResolvedValueOnce(nmiApprovedResponse("TXN_REPLAY_001"));

    const first = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({ productId: nmiProductId, paymentToken: "tok_test_approved", idempotencyKey: iKey });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({ productId: nmiProductId, paymentToken: "tok_different", idempotencyKey: iKey });
    expect(second.status).toBe(200);
    expect(second.body.orderNumber).toBe(first.body.orderNumber);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const order = await db
      .select()
      .from(btsOrdersTable)
      .where(eq(btsOrdersTable.orderNumber, first.body.orderNumber))
      .limit(1);
    if (order.length > 0) seededOrderIds.push(order[0].id);
  });

  it("replays a declined result on the second call without a second charge", async () => {
    const iKey = `${TEST_TAG}-replay-decline-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);
    fetchMock.mockResolvedValueOnce(nmiDeclinedResponse());

    const first = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({ productId: nmiProductId, paymentToken: "tok_decline", idempotencyKey: iKey });
    expect(first.status).toBe(402);

    const second = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({ productId: nmiProductId, paymentToken: "tok_decline", idempotencyKey: iKey });
    expect(second.status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const orders = await db
      .select()
      .from(btsOrdersTable)
      .where(eq(btsOrdersTable.email, `${TEST_TAG}@example.com`));
    orders.filter((o) => o.status === "failed").forEach((o) => seededOrderIds.push(o.id));
  });

  it("returns 409 IDEMPOTENCY_CONFLICT when the same key is reused with a different product", async () => {
    const iKey = `${TEST_TAG}-conflict-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);
    fetchMock.mockResolvedValueOnce(nmiApprovedResponse("TXN_CONFLICT_001"));

    const first = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({ productId: nmiProductId, paymentToken: "tok_test_approved", idempotencyKey: iKey });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({ productId: walletProductId, paymentToken: "tok_test_approved", idempotencyKey: iKey });
    expect(second.status).toBe(409);
    const errCode = (second.body.error as { code?: string } | string | undefined);
    const codeStr = typeof errCode === "object" ? errCode?.code : errCode;
    expect(codeStr).toMatch(/IDEMPOTENCY_CONFLICT/i);

    const order = await db
      .select()
      .from(btsOrdersTable)
      .where(eq(btsOrdersTable.orderNumber, first.body.orderNumber))
      .limit(1);
    if (order.length > 0) seededOrderIds.push(order[0].id);
  });
});

describe("POST /api/billing/checkout — wallet_topup", () => {
  it("creates a paid order but does NOT insert a user_products row", async () => {
    const iKey = `${TEST_TAG}-wallet-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);
    fetchMock.mockResolvedValueOnce(nmiApprovedResponse("TXN_WALLET_001"));

    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({ productId: walletProductId, paymentToken: "tok_wallet", idempotencyKey: iKey });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("paid");

    const order = await db
      .select()
      .from(btsOrdersTable)
      .where(eq(btsOrdersTable.orderNumber, res.body.orderNumber))
      .limit(1);
    expect(order).toHaveLength(1);
    expect(order[0].status).toBe("paid");
    expect(order[0].orderType).toBe("wallet_topup");
    seededOrderIds.push(order[0].id);

    const grant = await db
      .select()
      .from(userProductsTable)
      .where(
        and(
          eq(userProductsTable.userId, testUserId),
          eq(userProductsTable.productId, walletProductId),
        ),
      )
      .limit(1);
    expect(grant).toHaveLength(0);
  });
});

describe("POST /api/billing/checkout — paid_reconciliation_needed replay", () => {
  it("replays reconciliation-needed result as 202 (not 402) on second call", async () => {
    const iKey = `${TEST_TAG}-recon-replay-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);

    await db.insert(checkoutIdempotencyTable).values({
      idempotencyKey: iKey,
      userId: testUserId,
      productId: nmiProductId,
      status: "completed",
      orderId: null,
      result: {
        outcomeType: "paid_reconciliation_needed",
        status: "paid_reconciliation_needed",
        orderNumber: "NMI-RECON-TEST-001",
        transactionId: "TXN_RECON_001",
      },
      completedAt: new Date(),
    });

    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({ productId: nmiProductId, paymentToken: "tok_any", idempotencyKey: iKey });

    expect(res.status).toBe(202);
    expect(res.body.orderNumber).toBe("NMI-RECON-TEST-001");
    expect(res.body.reconciling).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/billing/checkout — idempotency in_progress", () => {
  it("returns 409 IDEMPOTENCY_IN_PROGRESS when a concurrent request already holds the key", async () => {
    const iKey = `${TEST_TAG}-inprogress-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);

    await db.insert(checkoutIdempotencyTable).values({
      idempotencyKey: iKey,
      userId: testUserId,
      productId: nmiProductId,
      status: "in_progress",
    });

    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({ productId: nmiProductId, paymentToken: "tok_any", idempotencyKey: iKey });

    expect(res.status).toBe(409);
    const errCode = (res.body.error as { code?: string } | string | undefined);
    const codeStr = typeof errCode === "object" ? errCode?.code : errCode;
    expect(codeStr).toMatch(/IDEMPOTENCY_IN_PROGRESS/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/billing/checkout — validation", () => {
  it("returns 400 when the product is not is_native_nmi", async () => {
    const iKey = `${TEST_TAG}-nonnmi-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);

    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({ productId: nonNmiProductId, paymentToken: "tok_any", idempotencyKey: iKey });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when productId is missing", async () => {
    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({ paymentToken: "tok_any", idempotencyKey: randomUUID() });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when paymentToken is missing", async () => {
    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", authCookie)
      .send({ productId: nmiProductId, idempotencyKey: randomUUID() });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 when not authenticated", async () => {
    const res = await request(app)
      .post("/api/billing/checkout")
      .send({ productId: nmiProductId, paymentToken: "tok_any", idempotencyKey: randomUUID() });

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
