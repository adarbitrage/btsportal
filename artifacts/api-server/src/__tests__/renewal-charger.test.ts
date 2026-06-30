/**
 * NMI recurring renewal charger tests — processDueRenewals (Tier 6.2a, happy path).
 *
 * Exercises the pure, directly-callable function (no BullMQ/Redis):
 *  1. Success: charges the pinned vault at the SNAPSHOTTED amount, records a
 *     `recurring_renewal` order linked to the subscription, advances the period,
 *     and extends the active grant's expiry.
 *  2. Double-run safety: the deterministic per-period idempotency key replays the
 *     first result on a second run instead of charging the card again.
 *  3. Per-run cap: maxPerRun bounds how many due subs a single run processes.
 *  4. Decline: marks the subscription past_due, does NOT advance the period, does
 *     NOT extend the grant, and is not re-charged on a later run.
 *  5. cancel_at_period_end subs are skipped (never selected).
 *  6. A lifetime (NULL expires_at) grant is never shrunk to a finite expiry.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
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
import { eq, and, inArray, like } from "drizzle-orm";

const TEST_TAG = `renewal-test-${randomUUID().slice(0, 8)}`;
const TEST_EMAIL = `${TEST_TAG}@example.com`;

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
  QUEUE_REDIS_OPTIONS: {},
  makeThrottledRedisErrorLogger: () => () => {},
}));

vi.mock("../lib/webhook-events", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
  WEBHOOK_EVENT_TYPES: [],
}));

vi.mock("../lib/commissions", () => ({
  ensureAffiliateProfile: vi.fn().mockResolvedValue(null),
  resolveUserCommissionTier: vi.fn().mockResolvedValue(null),
}));

// Imported AFTER mocks so the module graph picks them up.
import { processDueRenewals } from "../lib/renewal-charger";

function nmiApprovedResponse(transactionId = "TXN_RENEW_001"): Response {
  const body = new URLSearchParams({
    response: "1",
    responsetext: "SUCCESS",
    authcode: "123456",
    transactionid: transactionId,
    response_code: "100",
    customer_vault_id: "VAULT_RENEW_001",
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
const seededPaymentMethodIds: number[] = [];
const seededSubscriptionIds: number[] = [];

let testUserId: number;
let savedCardId: number;
const SAVED_VAULT_ID = "VAULT_SAVED_RENEW_001";

interface SeedSubOptions {
  productId: number;
  amountCents: number;
  interval?: "monthly" | "yearly";
  status?: string;
  nextChargeAt: Date;
  periodStart: Date;
  periodEnd: Date;
  cancelAtPeriodEnd?: boolean;
  /** undefined = no grant row, null = lifetime grant, Date = finite expiry */
  grantExpiresAt?: Date | null;
}

async function seedProduct(slugSuffix: string, priceCents: number): Promise<number> {
  const [prod] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-${slugSuffix}`,
      name: `Renewal Plan ${slugSuffix}`,
      type: "frontend",
      entitlementKeys: ["content:frontend"],
      priceCents,
      currency: "USD",
      billingType: "recurring",
      recurringInterval: "monthly",
      itemType: "entitlement",
      isNativeNmi: true,
    })
    .returning();
  seededProductIds.push(prod.id);
  return prod.id;
}

async function seedSub(opts: SeedSubOptions): Promise<typeof subscriptionsTable.$inferSelect> {
  const [sub] = await db
    .insert(subscriptionsTable)
    .values({
      userId: testUserId,
      productId: opts.productId,
      paymentMethodId: savedCardId,
      status: opts.status ?? "active",
      interval: opts.interval ?? "monthly",
      amountCents: opts.amountCents,
      currency: "USD",
      currentPeriodStart: opts.periodStart,
      currentPeriodEnd: opts.periodEnd,
      nextChargeAt: opts.nextChargeAt,
      retryCount: 0,
      cancelAtPeriodEnd: opts.cancelAtPeriodEnd ?? false,
    })
    .returning();
  seededSubscriptionIds.push(sub.id);

  if (opts.grantExpiresAt !== undefined) {
    await db.insert(userProductsTable).values({
      userId: testUserId,
      productId: opts.productId,
      status: "active",
      externalSource: "nmi",
      externalOrderId: `seed-${sub.id}`,
      expiresAt: opts.grantExpiresAt,
    });
  }
  return sub;
}

beforeAll(async () => {
  process.env.BTS_NMI_SECURITY_KEY = "demo_sandbox_key_test";
  process.env.BTS_NMI_TOKENIZATION_KEY = "demo_public_key_test";

  const [user] = await db
    .insert(usersTable)
    .values({
      name: "Renewal Test User",
      email: TEST_EMAIL,
      passwordHash: await bcrypt.hash("pw", 4),
      role: "member",
      emailVerified: true,
    })
    .returning();
  testUserId = user.id;
  seededUserIds.push(user.id);

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
});

afterAll(async () => {
  // FK chain: checkout_idempotency.order_id → bts_orders.id, and
  // bts_orders.subscription_id → subscriptions.id. Delete idempotency first,
  // then orders, then subscriptions.
  for (const subId of seededSubscriptionIds) {
    await db
      .delete(checkoutIdempotencyTable)
      .where(like(checkoutIdempotencyTable.idempotencyKey, `sub_${subId}_period_%`));
  }
  await db.delete(btsOrdersTable).where(eq(btsOrdersTable.email, TEST_EMAIL));
  if (seededSubscriptionIds.length > 0) {
    await db
      .delete(subscriptionsTable)
      .where(inArray(subscriptionsTable.id, seededSubscriptionIds));
  }
  if (seededProductIds.length > 0) {
    await db
      .delete(userProductsTable)
      .where(
        and(
          inArray(userProductsTable.userId, seededUserIds),
          inArray(userProductsTable.productId, seededProductIds),
        ),
      );
  }
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

beforeEach(async () => {
  fetchMock.mockReset();
  // processDueRenewals is a GLOBAL batch processor — it picks up EVERY due
  // subscription, not just the current test's. Push all existing subs'
  // next_charge_at far into the future so each test's count assertions only
  // reflect the sub(s) it seeds itself (also neutralizes orphans from prior
  // crashed runs). Non-destructive: rows keep their ids for afterAll cleanup.
  await db
    .update(subscriptionsTable)
    .set({ nextChargeAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) });
});

async function reloadSub(id: number) {
  const [row] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.id, id))
    .limit(1);
  return row;
}

async function reloadGrant(productId: number) {
  const [row] = await db
    .select()
    .from(userProductsTable)
    .where(
      and(
        eq(userProductsTable.userId, testUserId),
        eq(userProductsTable.productId, productId),
        eq(userProductsTable.status, "active"),
      ),
    )
    .limit(1);
  return row;
}

// ── 1. Success ────────────────────────────────────────────────────────────────

describe("processDueRenewals — successful renewal", () => {
  it("charges snapshot amount, records recurring_renewal order, advances period, extends grant", async () => {
    const productId = await seedProduct("success", 9900); // product price differs from snapshot
    const now = new Date();
    const periodStart = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // due 5 days ago
    const sub = await seedSub({
      productId,
      amountCents: 4900, // SNAPSHOT — not the 9900 product price
      nextChargeAt: periodEnd,
      periodStart,
      periodEnd,
      grantExpiresAt: periodEnd,
    });

    fetchMock.mockResolvedValueOnce(nmiApprovedResponse("TXN_RENEW_SUCCESS"));

    const result = await processDueRenewals({ now });

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.declined).toBe(0);
    expect(result.errored).toBe(0);

    // Charged exactly once, on the pinned vault, at the snapshot amount.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const posted = new URLSearchParams(opts.body as string);
    expect(posted.get("customer_vault_id")).toBe(SAVED_VAULT_ID);
    expect(posted.get("amount")).toBe("49.00");
    expect(posted.get("type")).toBe("sale");

    // Period advanced: new start = old end, new end = old end + 1 month, next_charge = new end.
    const reloaded = await reloadSub(sub.id);
    expect(reloaded.status).toBe("active");
    expect(reloaded.currentPeriodStart.getTime()).toBe(periodEnd.getTime());
    const expectedEnd = new Date(periodEnd);
    expectedEnd.setMonth(expectedEnd.getMonth() + 1);
    expect(reloaded.currentPeriodEnd.getTime()).toBe(expectedEnd.getTime());
    expect(reloaded.nextChargeAt!.getTime()).toBe(expectedEnd.getTime());
    expect(reloaded.retryCount).toBe(0);
    expect(reloaded.lastFailureReason).toBeNull();
    expect(reloaded.lastChargeAttemptAt).not.toBeNull();

    // Order recorded: recurring_renewal, paid, linked to the subscription, snapshot total.
    const orders = await db
      .select()
      .from(btsOrdersTable)
      .where(eq(btsOrdersTable.subscriptionId, sub.id));
    expect(orders).toHaveLength(1);
    expect(orders[0].orderType).toBe("recurring_renewal");
    expect(orders[0].status).toBe("paid");
    expect(orders[0].totalCents).toBe(4900);
    expect(orders[0].gatewayTransactionId).toBe("TXN_RENEW_SUCCESS");

    // Grant expiry extended forward to the new period end.
    const grant = await reloadGrant(productId);
    expect(grant.expiresAt!.getTime()).toBe(expectedEnd.getTime());
  });
});

// ── 2. Double-run safety (deterministic per-period key) ─────────────────────────

describe("processDueRenewals — double-run safety", () => {
  it("replays the first charge instead of charging twice for the same period", async () => {
    const productId = await seedProduct("double-run", 4900);
    const now = new Date();
    const periodStart = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const sub = await seedSub({
      productId,
      amountCents: 4900,
      nextChargeAt: periodEnd,
      periodStart,
      periodEnd,
      grantExpiresAt: periodEnd,
    });

    fetchMock.mockResolvedValue(nmiApprovedResponse("TXN_RENEW_DOUBLE"));

    const first = await processDueRenewals({ now });
    expect(first.succeeded).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Simulate a duplicate/overlapping tick that observes the PRE-advance state
    // (same current_period_end → same idempotency key). Revert the row to how it
    // looked before the first run.
    await db
      .update(subscriptionsTable)
      .set({
        status: "active",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        nextChargeAt: periodEnd,
        retryCount: 0,
        lastFailureReason: null,
      })
      .where(eq(subscriptionsTable.id, sub.id));

    const second = await processDueRenewals({ now });
    // Second run selected the sub and resolved it via idempotency REPLAY — counted
    // as succeeded but WITHOUT a second gateway charge.
    expect(second.processed).toBe(1);
    expect(second.succeeded).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Still exactly one order for the period (replay creates no new order).
    const orders = await db
      .select()
      .from(btsOrdersTable)
      .where(eq(btsOrdersTable.subscriptionId, sub.id));
    expect(orders).toHaveLength(1);
  });
});

// ── 3. Per-run cap ──────────────────────────────────────────────────────────────

describe("processDueRenewals — per-run cap", () => {
  it("processes at most maxPerRun due subscriptions, oldest-due first", async () => {
    const now = new Date();
    const base = now.getTime();
    // Three due subs with distinct next_charge_at (oldest first).
    for (let i = 0; i < 3; i++) {
      const productId = await seedProduct(`cap-${i}`, 4900);
      const periodEnd = new Date(base - (30 - i) * 24 * 60 * 60 * 1000); // i=0 oldest
      const periodStart = new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
      await seedSub({
        productId,
        amountCents: 4900,
        nextChargeAt: periodEnd,
        periodStart,
        periodEnd,
        grantExpiresAt: periodEnd,
      });
    }

    fetchMock.mockResolvedValue(nmiApprovedResponse("TXN_RENEW_CAP"));

    const result = await processDueRenewals({ now, maxPerRun: 2 });
    expect(result.processed).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ── 4. Decline → past_due, no advance, not re-charged ──────────────────────────

describe("processDueRenewals — declined renewal", () => {
  it("marks past_due, does not advance period or extend grant, and is not re-charged", async () => {
    const productId = await seedProduct("decline", 4900);
    const now = new Date();
    const periodStart = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const sub = await seedSub({
      productId,
      amountCents: 4900,
      nextChargeAt: periodEnd,
      periodStart,
      periodEnd,
      grantExpiresAt: periodEnd,
    });

    fetchMock.mockResolvedValueOnce(nmiDeclinedResponse());

    const result = await processDueRenewals({ now });
    expect(result.processed).toBe(1);
    expect(result.declined).toBe(1);
    expect(result.succeeded).toBe(0);

    const reloaded = await reloadSub(sub.id);
    expect(reloaded.status).toBe("past_due");
    // Period NOT advanced.
    expect(reloaded.currentPeriodEnd.getTime()).toBe(periodEnd.getTime());
    expect(reloaded.nextChargeAt!.getTime()).toBe(periodEnd.getTime());
    expect(reloaded.lastFailureReason).toBeTruthy();

    // Grant expiry NOT extended.
    const grant = await reloadGrant(productId);
    expect(grant.expiresAt!.getTime()).toBe(periodEnd.getTime());

    // A second run does NOT re-charge (past_due is excluded from due selection).
    const second = await processDueRenewals({ now });
    expect(second.processed).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ── 5. cancel_at_period_end skipped ─────────────────────────────────────────────

describe("processDueRenewals — cancel_at_period_end", () => {
  it("never charges a subscription flagged to cancel at period end", async () => {
    const productId = await seedProduct("cancel", 4900);
    const now = new Date();
    const periodStart = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const sub = await seedSub({
      productId,
      amountCents: 4900,
      nextChargeAt: periodEnd,
      periodStart,
      periodEnd,
      cancelAtPeriodEnd: true,
      grantExpiresAt: periodEnd,
    });

    fetchMock.mockResolvedValue(nmiApprovedResponse("TXN_RENEW_CANCEL"));

    const result = await processDueRenewals({ now });
    expect(result.processed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();

    const reloaded = await reloadSub(sub.id);
    expect(reloaded.currentPeriodEnd.getTime()).toBe(periodEnd.getTime());
    expect(reloaded.status).toBe("active");
  });
});

// ── 6. Lifetime (NULL) grant not shrunk ─────────────────────────────────────────

describe("processDueRenewals — lifetime grant preserved", () => {
  it("does not shrink a lifetime (NULL expires_at) grant to a finite expiry", async () => {
    const productId = await seedProduct("lifetime", 4900);
    const now = new Date();
    const periodStart = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const sub = await seedSub({
      productId,
      amountCents: 4900,
      nextChargeAt: periodEnd,
      periodStart,
      periodEnd,
      grantExpiresAt: null, // lifetime
    });

    fetchMock.mockResolvedValueOnce(nmiApprovedResponse("TXN_RENEW_LIFETIME"));

    const result = await processDueRenewals({ now });
    expect(result.succeeded).toBe(1);

    // Period still advanced on success.
    const reloaded = await reloadSub(sub.id);
    const expectedEnd = new Date(periodEnd);
    expectedEnd.setMonth(expectedEnd.getMonth() + 1);
    expect(reloaded.currentPeriodEnd.getTime()).toBe(expectedEnd.getTime());

    // Grant remains lifetime — NOT shrunk to the period end.
    const grant = await reloadGrant(productId);
    expect(grant.expiresAt).toBeNull();
  });
});
