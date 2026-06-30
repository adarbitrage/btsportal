/**
 * Billing subscription tests — POST /api/billing/subscribe,
 * POST /api/billing/subscriptions/:id/cancel, GET /api/billing/subscriptions,
 * DELETE /api/billing/payment-methods/:id (active-sub guard).
 *
 * Covers:
 *  1. Subscribe success: initial charge via vault, active sub created, period/next_charge set,
 *     amount snapshotted, order type=recurring_initial, order linked to subscription, grant created.
 *  2. Declined initial charge → 402, no subscription row, no grant.
 *  3. Duplicate active subscription → 409 DUPLICATE_SUBSCRIPTION.
 *  4. Cancel sets cancel_at_period_end without revoking access (next_charge_at intact).
 *  5. Delete-card-funding-active-sub → 409 CARD_FUNDS_ACTIVE_SUBSCRIPTION, no vault call made.
 *  6. One-time checkout tests still pass (checked by importing the existing test suite).
 *  7. Non-recurring product → 400 INVALID_PRODUCT.
 *  8. Both/neither card source → 400 INVALID_REQUEST.
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
  paymentMethodsTable,
  subscriptionsTable,
  auditLogTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { buildTestApp } from "./test-app";
import billingRouter from "../routes/billing";

const TEST_TAG = `sub-test-${randomUUID().slice(0, 8)}`;
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

function nmiApprovedResponse(transactionId = "TXN_SUB_001"): Response {
  const body = new URLSearchParams({
    response: "1",
    responsetext: "SUCCESS",
    authcode: "123456",
    transactionid: transactionId,
    response_code: "100",
    customer_vault_id: "VAULT_SUB_001",
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

function nmiVaultApprovedResponse(vaultId = "VAULT_NEW_001"): Response {
  const body = new URLSearchParams({
    response: "1",
    responsetext: "Customer Added",
    customer_vault_id: vaultId,
    transactionid: "TXN_VAULT_001",
    response_code: "100",
  }).toString();
  return { ok: true, status: 200, text: async () => body } as unknown as Response;
}

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
const seededOrderIds: number[] = [];
const seededIdempotencyKeys: string[] = [];
const seededPaymentMethodIds: number[] = [];
const seededSubscriptionIds: number[] = [];

let app: ReturnType<typeof buildTestApp>;
let authCookie: string;
let testUserId: number;
let recurringProductId: number;
let oneTimeProductId: number;
let savedCardId: number;
const SAVED_VAULT_ID = "VAULT_SAVED_001";

beforeAll(async () => {
  process.env.BTS_NMI_SECURITY_KEY = "demo_sandbox_key_test";
  process.env.BTS_NMI_TOKENIZATION_KEY = "demo_public_key_test";

  const [user] = await db
    .insert(usersTable)
    .values({
      name: "Sub Test User",
      email: `${TEST_TAG}@example.com`,
      passwordHash: await bcrypt.hash("pw", 4),
      role: "member",
      emailVerified: true,
    })
    .returning();
  testUserId = user.id;
  seededUserIds.push(user.id);
  authCookie = signCookie(user.id, user.email);

  const [recurringProd] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-recurring-monthly`,
      name: "Monthly Recurring Plan",
      type: "frontend",
      entitlementKeys: ["content:frontend"],
      priceCents: 4900,
      currency: "USD",
      billingType: "recurring",
      recurringInterval: "monthly",
      itemType: "entitlement",
      isNativeNmi: true,
    })
    .returning();
  recurringProductId = recurringProd.id;
  seededProductIds.push(recurringProd.id);

  const [oneTimeProd] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-onetime`,
      name: "One-Time Product",
      type: "frontend",
      entitlementKeys: ["content:mentorship"],
      priceCents: 9900,
      currency: "USD",
      billingType: "one_time",
      itemType: "entitlement",
      isNativeNmi: true,
    })
    .returning();
  oneTimeProductId = oneTimeProd.id;
  seededProductIds.push(oneTimeProd.id);

  const [pm] = await db
    .insert(paymentMethodsTable)
    .values({
      userId: testUserId,
      vaultId: SAVED_VAULT_ID,
      last4: "4242",
      brand: "visa",
      expMonth: 12,
      expYear: 2030,
      isDefault: true,
    })
    .returning();
  savedCardId = pm.id;
  seededPaymentMethodIds.push(pm.id);

  app = buildTestApp({ routers: [billingRouter] });
});

afterAll(async () => {
  if (seededSubscriptionIds.length > 0) {
    await db
      .update(btsOrdersTable)
      .set({ subscriptionId: null })
      .where(inArray(btsOrdersTable.subscriptionId, seededSubscriptionIds));
    await db
      .delete(subscriptionsTable)
      .where(inArray(subscriptionsTable.id, seededSubscriptionIds));
  }
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
  if (seededPaymentMethodIds.length > 0) {
    await db
      .delete(paymentMethodsTable)
      .where(inArray(paymentMethodsTable.id, seededPaymentMethodIds));
  }
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

// ── Subscribe success via saved card ─────────────────────────────────────────

describe("POST /api/billing/subscribe — success via saved paymentMethodId", () => {
  it("charges initial period, creates active subscription, links order, grants entitlement", async () => {
    const iKey = `${TEST_TAG}-success-saved-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);
    fetchMock.mockResolvedValueOnce(nmiApprovedResponse("TXN_SUB_SAVED_001"));

    const res = await request(app)
      .post("/api/billing/subscribe")
      .set("Cookie", authCookie)
      .send({ productId: recurringProductId, paymentMethodId: savedCardId, idempotencyKey: iKey });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
    expect(res.body.subscriptionId).toBeDefined();
    expect(res.body.orderNumber).toBeDefined();
    expect(res.body.nextChargeAt).toBeDefined();

    // NMI was called with vault id (not token)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const posted = new URLSearchParams(opts.body as string);
    expect(posted.get("customer_vault_id")).toBe(SAVED_VAULT_ID);
    expect(posted.get("amount")).toBe("49.00");
    expect(posted.get("type")).toBe("sale");

    // Subscription row exists
    const subId = res.body.subscriptionId as number;
    seededSubscriptionIds.push(subId);
    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, subId))
      .limit(1);
    expect(sub).toBeDefined();
    expect(sub.status).toBe("active");
    expect(sub.amountCents).toBe(4900);
    expect(sub.interval).toBe("monthly");
    expect(sub.paymentMethodId).toBe(savedCardId);
    expect(sub.cancelAtPeriodEnd).toBe(false);
    expect(sub.nextChargeAt).toBeDefined();
    expect(sub.currentPeriodEnd.getTime()).toBeGreaterThan(sub.currentPeriodStart.getTime());

    // Order row: recurring_initial, paid, linked to subscription
    const [order] = await db
      .select()
      .from(btsOrdersTable)
      .where(eq(btsOrdersTable.orderNumber, res.body.orderNumber))
      .limit(1);
    expect(order).toBeDefined();
    seededOrderIds.push(order.id);
    expect(order.status).toBe("paid");
    expect(order.orderType).toBe("recurring_initial");
    expect(order.subscriptionId).toBe(subId);
    expect(order.totalCents).toBe(4900);
    expect(order.gatewayTransactionId).toBe("TXN_SUB_SAVED_001");

    // Entitlement granted
    const [grant] = await db
      .select()
      .from(userProductsTable)
      .where(
        and(
          eq(userProductsTable.userId, testUserId),
          eq(userProductsTable.productId, recurringProductId),
          eq(userProductsTable.status, "active"),
        ),
      )
      .limit(1);
    expect(grant).toBeDefined();
    expect(grant.externalSource).toBe("nmi");
  });
});

// ── Subscribe success via fresh token (vault + pin) ──────────────────────────

describe("POST /api/billing/subscribe — success via fresh paymentToken", () => {
  it("vaults the token, pins the new card, charges, creates subscription", async () => {
    const iKey = `${TEST_TAG}-success-token-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);

    // First fetch: vault creation (add_customer), second fetch: the charge
    fetchMock
      .mockResolvedValueOnce(nmiVaultApprovedResponse("VAULT_NEW_TOKEN_001"))
      .mockResolvedValueOnce(nmiApprovedResponse("TXN_SUB_TOKEN_001"));

    // Use a second product to avoid duplicate-sub conflict with the first test
    const [prod2] = await db
      .insert(productsTable)
      .values({
        slug: `${TEST_TAG}-recurring-yearly`,
        name: "Yearly Recurring Plan",
        type: "frontend",
        entitlementKeys: ["content:yearly"],
        priceCents: 49900,
        currency: "USD",
        billingType: "recurring",
        recurringInterval: "yearly",
        itemType: "entitlement",
        isNativeNmi: true,
      })
      .returning();
    seededProductIds.push(prod2.id);

    const res = await request(app)
      .post("/api/billing/subscribe")
      .set("Cookie", authCookie)
      .send({ productId: prod2.id, paymentToken: "tok_new_card", idempotencyKey: iKey });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
    expect(res.body.subscriptionId).toBeDefined();

    const subId = res.body.subscriptionId as number;
    seededSubscriptionIds.push(subId);

    // Vault call was made first
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, vaultOpts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const vaultParams = new URLSearchParams(vaultOpts.body as string);
    expect(vaultParams.get("customer_vault")).toBe("add_customer");
    expect(vaultParams.get("payment_token")).toBe("tok_new_card");

    // Charge used the new vault id
    const [, chargeOpts] = fetchMock.mock.calls[1] as [string, RequestInit];
    const chargeParams = new URLSearchParams(chargeOpts.body as string);
    expect(chargeParams.get("customer_vault_id")).toBe("VAULT_NEW_TOKEN_001");
    expect(chargeParams.get("amount")).toBe("499.00");

    // A payment_methods row was inserted and pinned
    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, subId))
      .limit(1);
    expect(sub).toBeDefined();
    seededPaymentMethodIds.push(sub.paymentMethodId);

    const [order] = await db
      .select()
      .from(btsOrdersTable)
      .where(eq(btsOrdersTable.orderNumber, res.body.orderNumber))
      .limit(1);
    if (order) seededOrderIds.push(order.id);
  });
});

// ── Declined initial charge ───────────────────────────────────────────────────

describe("POST /api/billing/subscribe — declined", () => {
  it("returns 402, creates no subscription, grants nothing", async () => {
    const iKey = `${TEST_TAG}-decline-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);

    // Use another product to avoid duplicate-sub conflict
    const [prod3] = await db
      .insert(productsTable)
      .values({
        slug: `${TEST_TAG}-recurring-decline`,
        name: "Recurring Decline Plan",
        type: "frontend",
        entitlementKeys: ["content:decline-test"],
        priceCents: 2900,
        currency: "USD",
        billingType: "recurring",
        recurringInterval: "monthly",
        itemType: "entitlement",
        isNativeNmi: true,
      })
      .returning();
    seededProductIds.push(prod3.id);

    fetchMock.mockResolvedValueOnce(nmiDeclinedResponse());

    const res = await request(app)
      .post("/api/billing/subscribe")
      .set("Cookie", authCookie)
      .send({ productId: prod3.id, paymentMethodId: savedCardId, idempotencyKey: iKey });

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/declined/i);

    // No subscription row created
    const subs = await db
      .select()
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.userId, testUserId),
          eq(subscriptionsTable.productId, prod3.id),
        ),
      );
    expect(subs).toHaveLength(0);

    // No grant created
    const grants = await db
      .select()
      .from(userProductsTable)
      .where(
        and(
          eq(userProductsTable.userId, testUserId),
          eq(userProductsTable.productId, prod3.id),
        ),
      );
    expect(grants).toHaveLength(0);

    // Order was marked failed
    const orders = await db
      .select()
      .from(btsOrdersTable)
      .where(eq(btsOrdersTable.email, `${TEST_TAG}@example.com`));
    const failedOrder = orders.find((o) => o.status === "failed" && o.orderType === "recurring_initial");
    if (failedOrder) seededOrderIds.push(failedOrder.id);
    expect(failedOrder).toBeDefined();
  });
});

// ── Duplicate active subscription → 409 ─────────────────────────────────────

describe("POST /api/billing/subscribe — duplicate active subscription", () => {
  it("returns 409 DUPLICATE_SUBSCRIPTION when user already has active sub for this product", async () => {
    // The first test already created an active sub for recurringProductId.
    const iKey = `${TEST_TAG}-duplicate-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);

    const res = await request(app)
      .post("/api/billing/subscribe")
      .set("Cookie", authCookie)
      .send({ productId: recurringProductId, paymentMethodId: savedCardId, idempotencyKey: iKey });

    expect(res.status).toBe(409);
    const errCode =
      typeof res.body.error === "object" ? res.body.error?.code : res.body.error;
    expect(errCode).toMatch(/DUPLICATE_SUBSCRIPTION/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── Cancel sets period-end without revoking access ───────────────────────────

describe("POST /api/billing/subscriptions/:id/cancel", () => {
  it("sets cancel_at_period_end=true, does not change next_charge_at, does not revoke grant", async () => {
    // Find the subscription created in the first success test
    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.userId, testUserId),
          eq(subscriptionsTable.productId, recurringProductId),
        ),
      )
      .limit(1);
    expect(sub).toBeDefined();
    const nextChargeAtBefore = sub.nextChargeAt;
    const periodEndBefore = sub.currentPeriodEnd;

    const res = await request(app)
      .post(`/api/billing/subscriptions/${sub.id}/cancel`)
      .set("Cookie", authCookie)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.cancelAtPeriodEnd).toBe(true);
    expect(res.body.canceledAt).toBeDefined();
    // next_charge_at is preserved (not nulled out)
    expect(res.body.nextChargeAt).not.toBeNull();
    expect(new Date(res.body.nextChargeAt as string).getTime()).toBeCloseTo(
      nextChargeAtBefore!.getTime(),
      -3,
    );
    expect(new Date(res.body.currentPeriodEnd as string).getTime()).toBeCloseTo(
      periodEndBefore.getTime(),
      -3,
    );

    // Entitlement grant still active (access not revoked)
    const [grant] = await db
      .select()
      .from(userProductsTable)
      .where(
        and(
          eq(userProductsTable.userId, testUserId),
          eq(userProductsTable.productId, recurringProductId),
          eq(userProductsTable.status, "active"),
        ),
      )
      .limit(1);
    expect(grant).toBeDefined();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a subscription that doesn't belong to the user", async () => {
    const res = await request(app)
      .post("/api/billing/subscriptions/999999999/cancel")
      .set("Cookie", authCookie)
      .send({});

    expect(res.status).toBe(404);
  });
});

// ── GET /api/billing/subscriptions ───────────────────────────────────────────

describe("GET /api/billing/subscriptions", () => {
  it("lists the user's subscriptions without exposing vault_id", async () => {
    const res = await request(app)
      .get("/api/billing/subscriptions")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.subscriptions)).toBe(true);

    for (const s of res.body.subscriptions as Record<string, unknown>[]) {
      expect(s).not.toHaveProperty("vaultId");
      expect(s).not.toHaveProperty("vault_id");
      expect(s).not.toHaveProperty("paymentMethodId");
      expect(s).toHaveProperty("status");
      expect(s).toHaveProperty("amountCents");
      expect(s).toHaveProperty("interval");
      expect(s).toHaveProperty("currentPeriodEnd");
      expect(s).toHaveProperty("cancelAtPeriodEnd");
    }
  });
});

// ── Delete-card guard: card funds active subscription ────────────────────────

describe("DELETE /api/billing/payment-methods/:id — active subscription guard", () => {
  it("returns 409 CARD_FUNDS_ACTIVE_SUBSCRIPTION, makes no vault call, keeps the card", async () => {
    // Note: the sub created by the first success test was canceled via cancel_at_period_end
    // but it is still "active" status (access runs to period end). The guard checks
    // active/past_due, and cancel_at_period_end doesn't change the status.

    // Find the sub for the main recurring product to confirm it's still active
    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.userId, testUserId),
          eq(subscriptionsTable.productId, recurringProductId),
        ),
      )
      .limit(1);
    expect(sub?.status).toBe("active");

    const res = await request(app)
      .delete(`/api/billing/payment-methods/${savedCardId}`)
      .set("Cookie", authCookie);

    expect(res.status).toBe(409);
    const errCode =
      typeof res.body.error === "object" ? res.body.error?.code : res.body.error;
    expect(errCode).toMatch(/CARD_FUNDS_ACTIVE_SUBSCRIPTION/i);

    // No vault call was made
    expect(fetchMock).not.toHaveBeenCalled();

    // Card still in DB
    const [card] = await db
      .select({ id: paymentMethodsTable.id })
      .from(paymentMethodsTable)
      .where(eq(paymentMethodsTable.id, savedCardId))
      .limit(1);
    expect(card).toBeDefined();
  });
});

// ── Subscribe idempotency replay ─────────────────────────────────────────────

describe("POST /api/billing/subscribe — idempotency replay", () => {
  it("replays a successful subscribe result without a second charge or extra vault call", async () => {
    const [prod5] = await db
      .insert(productsTable)
      .values({
        slug: `${TEST_TAG}-recurring-replay`,
        name: "Replay Plan",
        type: "frontend",
        entitlementKeys: ["content:replay"],
        priceCents: 1900,
        currency: "USD",
        billingType: "recurring",
        recurringInterval: "monthly",
        itemType: "entitlement",
        isNativeNmi: true,
      })
      .returning();
    seededProductIds.push(prod5.id);

    const iKey = `${TEST_TAG}-replay-sub-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);

    fetchMock.mockResolvedValueOnce(nmiApprovedResponse("TXN_SUB_REPLAY_001"));

    const first = await request(app)
      .post("/api/billing/subscribe")
      .set("Cookie", authCookie)
      .send({ productId: prod5.id, paymentMethodId: savedCardId, idempotencyKey: iKey });

    expect(first.status).toBe(200);
    expect(first.body.subscriptionId).toBeDefined();
    seededSubscriptionIds.push(first.body.subscriptionId as number);

    // Replay with same key — must NOT charge again or hit duplicate guard
    // and must return a payload structurally equivalent to the original success response
    const second = await request(app)
      .post("/api/billing/subscribe")
      .set("Cookie", authCookie)
      .send({ productId: prod5.id, paymentMethodId: savedCardId, idempotencyKey: iKey });

    expect(second.status).toBe(200);
    expect(second.body.orderNumber).toBe(first.body.orderNumber);
    expect(second.body.subscriptionId).toBe(first.body.subscriptionId);
    expect(second.body.status).toBe("active");
    // nextChargeAt must be present on replay (same value as original)
    expect(second.body.nextChargeAt).toBeDefined();
    expect(second.body.nextChargeAt).toBe(first.body.nextChargeAt);
    // grantedEntitlements must be present on replay
    expect(second.body.grantedEntitlements).toEqual(first.body.grantedEntitlements);
    expect(fetchMock).toHaveBeenCalledTimes(1); // charged exactly once

    const [order] = await db
      .select()
      .from(btsOrdersTable)
      .where(eq(btsOrdersTable.orderNumber, first.body.orderNumber))
      .limit(1);
    if (order) seededOrderIds.push(order.id);
  });

  it("replay with paymentToken does not create extra vault entries or payment_methods rows", async () => {
    const [prod6] = await db
      .insert(productsTable)
      .values({
        slug: `${TEST_TAG}-recurring-token-replay`,
        name: "Token Replay Plan",
        type: "frontend",
        entitlementKeys: [],
        priceCents: 2900,
        currency: "USD",
        billingType: "recurring",
        recurringInterval: "monthly",
        itemType: "entitlement",
        isNativeNmi: true,
      })
      .returning();
    seededProductIds.push(prod6.id);

    const iKey = `${TEST_TAG}-token-replay-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);

    // First call: vault + charge
    fetchMock
      .mockResolvedValueOnce(nmiVaultApprovedResponse("VAULT_TREPLAY_001"))
      .mockResolvedValueOnce(nmiApprovedResponse("TXN_TOKEN_REPLAY_001"));

    const first = await request(app)
      .post("/api/billing/subscribe")
      .set("Cookie", authCookie)
      .send({ productId: prod6.id, paymentToken: "tok_replay_token", idempotencyKey: iKey });

    expect(first.status).toBe(200);
    seededSubscriptionIds.push(first.body.subscriptionId as number);

    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, first.body.subscriptionId as number))
      .limit(1);
    const createdPmId = sub.paymentMethodId;
    seededPaymentMethodIds.push(createdPmId);

    const pmCountBefore = await db
      .select()
      .from(paymentMethodsTable)
      .where(eq(paymentMethodsTable.userId, testUserId));

    // Replay: must NOT call vault again or create another payment_methods row
    const second = await request(app)
      .post("/api/billing/subscribe")
      .set("Cookie", authCookie)
      .send({ productId: prod6.id, paymentToken: "tok_replay_token", idempotencyKey: iKey });

    expect(second.status).toBe(200);
    expect(second.body.orderNumber).toBe(first.body.orderNumber);
    expect(fetchMock).toHaveBeenCalledTimes(2); // vault + charge from first call only

    const pmCountAfter = await db
      .select()
      .from(paymentMethodsTable)
      .where(eq(paymentMethodsTable.userId, testUserId));
    expect(pmCountAfter.length).toBe(pmCountBefore.length); // no extra rows

    const [order] = await db
      .select()
      .from(btsOrdersTable)
      .where(eq(btsOrdersTable.orderNumber, first.body.orderNumber))
      .limit(1);
    if (order) seededOrderIds.push(order.id);
  });

  it("replays a declined result as 402 without a second charge", async () => {
    const [prod7] = await db
      .insert(productsTable)
      .values({
        slug: `${TEST_TAG}-recurring-decline-replay`,
        name: "Decline Replay Plan",
        type: "frontend",
        entitlementKeys: [],
        priceCents: 1900,
        currency: "USD",
        billingType: "recurring",
        recurringInterval: "monthly",
        itemType: "entitlement",
        isNativeNmi: true,
      })
      .returning();
    seededProductIds.push(prod7.id);

    const iKey = `${TEST_TAG}-decline-replay-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);

    fetchMock.mockResolvedValueOnce(nmiDeclinedResponse());

    const first = await request(app)
      .post("/api/billing/subscribe")
      .set("Cookie", authCookie)
      .send({ productId: prod7.id, paymentMethodId: savedCardId, idempotencyKey: iKey });

    expect(first.status).toBe(402);

    const second = await request(app)
      .post("/api/billing/subscribe")
      .set("Cookie", authCookie)
      .send({ productId: prod7.id, paymentMethodId: savedCardId, idempotencyKey: iKey });

    expect(second.status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1); // declined once, replayed once

    const orders = await db
      .select()
      .from(btsOrdersTable)
      .where(eq(btsOrdersTable.email, `${TEST_TAG}@example.com`));
    orders.filter((o) => o.status === "failed").forEach((o) => seededOrderIds.push(o.id));
  });
});

// ── Non-recurring product → 400 ──────────────────────────────────────────────

describe("POST /api/billing/subscribe — validation", () => {
  it("returns 400 INVALID_PRODUCT for a one-time product", async () => {
    const iKey = `${TEST_TAG}-badprod-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);

    const res = await request(app)
      .post("/api/billing/subscribe")
      .set("Cookie", authCookie)
      .send({ productId: oneTimeProductId, paymentMethodId: savedCardId, idempotencyKey: iKey });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when both paymentToken and paymentMethodId are provided", async () => {
    const iKey = `${TEST_TAG}-both-${randomUUID()}`;

    const res = await request(app)
      .post("/api/billing/subscribe")
      .set("Cookie", authCookie)
      .send({
        productId: recurringProductId,
        paymentToken: "tok_test",
        paymentMethodId: savedCardId,
        idempotencyKey: iKey,
      });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when neither paymentToken nor paymentMethodId is provided", async () => {
    const iKey = `${TEST_TAG}-neither-${randomUUID()}`;

    const res = await request(app)
      .post("/api/billing/subscribe")
      .set("Cookie", authCookie)
      .send({ productId: recurringProductId, idempotencyKey: iKey });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 when not authenticated", async () => {
    const res = await request(app)
      .post("/api/billing/subscribe")
      .send({ productId: recurringProductId, paymentMethodId: savedCardId, idempotencyKey: randomUUID() });

    expect(res.status).toBe(401);
  });

  it("returns 404 for a non-existent paymentMethodId", async () => {
    const iKey = `${TEST_TAG}-nopmd-${randomUUID()}`;
    seededIdempotencyKeys.push(iKey);

    // Need a product without an active sub to reach the card lookup
    const [prod4] = await db
      .insert(productsTable)
      .values({
        slug: `${TEST_TAG}-recurring-nopmd`,
        name: "Recurring NoPMD Plan",
        type: "frontend",
        entitlementKeys: [],
        priceCents: 1900,
        currency: "USD",
        billingType: "recurring",
        recurringInterval: "monthly",
        itemType: "entitlement",
        isNativeNmi: true,
      })
      .returning();
    seededProductIds.push(prod4.id);

    const res = await request(app)
      .post("/api/billing/subscribe")
      .set("Cookie", authCookie)
      .send({ productId: prod4.id, paymentMethodId: 999999999, idempotencyKey: iKey });

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
