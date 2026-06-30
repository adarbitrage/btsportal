/**
 * NMI recurring renewal charger tests — processDueRenewals (Tier 6.2a + 6.2b).
 *
 * Exercises the pure, directly-callable function (no BullMQ/Redis):
 *  Phase 1 (6.2a)
 *  1. Success: charges the pinned vault at the SNAPSHOTTED amount, records a
 *     `recurring_renewal` order linked to the subscription, advances the period,
 *     and extends the active grant's expiry.
 *  2. Double-run safety: the deterministic per-period idempotency key replays the
 *     first result on a second run instead of charging the card again.
 *  3. Per-run cap: maxPerRun bounds how many due subs a single run processes.
 *  4. Decline: marks the subscription past_due, does NOT advance the period, does
 *     NOT extend the grant, and is not re-charged on a later run. Arms dunning
 *     schedule (retry_count=1, next_retry_at=now+3d). Queues payment_failed email.
 *  5. cancel_at_period_end subs are skipped by Phase 1 (never selected).
 *  6. A lifetime (NULL expires_at) grant is never shrunk to a finite expiry.
 *
 *  Phase 2a (6.2b) — dunning retries
 *  7. Retry success (attempt #2): subscription recovers to active, period
 *     advanced, grant extended, no new email.
 *  8. Retry decline (attempt #2 → advance): retry_count advances to 2 and
 *     next_retry_at is set to now+4d, status stays past_due. No email.
 *  9. Final retry decline (attempt #3 → exhausted): status becomes unpaid,
 *     grant is revoked (status='cancelled'), payment_failed_final email queued.
 *  10. Per-attempt idempotency: a re-run of the same retry slot replays without
 *      charging a second time.
 *
 *  Phase 2b (6.2b) — cancel finalization
 *  11. cancel_at_period_end sub whose period has ended: status→canceled, grant
 *      revoked, no charge.
 *  12. cancel_at_period_end sub whose period has NOT ended: not touched.
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

// vi.hoisted ensures these are initialised before vi.mock factories run.
const { mockQueueEmail, mockQueueSms } = vi.hoisted(() => ({
  mockQueueEmail: vi.fn().mockResolvedValue(undefined),
  mockQueueSms: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    queueEmail: mockQueueEmail,
    queueSms: mockQueueSms,
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
  retryCount?: number;
  nextRetryAt?: Date | null;
  nextChargeAt: Date;
  periodStart: Date;
  periodEnd: Date;
  cancelAtPeriodEnd?: boolean;
  /** undefined = no grant row, null = lifetime grant, Date = finite expiry */
  grantExpiresAt?: Date | null;
  /** undefined = active grant, 'cancelled' = already revoked */
  grantStatus?: string;
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
      retryCount: opts.retryCount ?? 0,
      nextRetryAt: opts.nextRetryAt,
      cancelAtPeriodEnd: opts.cancelAtPeriodEnd ?? false,
    })
    .returning();
  seededSubscriptionIds.push(sub.id);

  if (opts.grantExpiresAt !== undefined) {
    await db.insert(userProductsTable).values({
      userId: testUserId,
      productId: opts.productId,
      status: opts.grantStatus ?? "active",
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

const FAR_FUTURE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

beforeEach(async () => {
  fetchMock.mockReset();
  mockQueueEmail.mockReset();
  mockQueueSms.mockReset();
  // processDueRenewals is a GLOBAL batch processor — it picks up EVERY due
  // subscription, not just the current test's. Push all subscriptions' charge
  // and retry timestamps far into the future so each test's count assertions
  // only reflect the sub(s) it seeds itself (also neutralizes orphans from prior
  // crashed runs). Non-destructive: rows keep their ids for afterAll cleanup.
  await db.update(subscriptionsTable).set({
    nextChargeAt: FAR_FUTURE,
    nextRetryAt: null,
    // Keep status as-is but ensure past_due orphans don't get retried.
  });
  // Finalize orphaned cancel_at_period_end subs that would otherwise be picked up.
  await db
    .update(subscriptionsTable)
    .set({ status: "canceled", cancelAtPeriodEnd: false })
    .where(and(eq(subscriptionsTable.cancelAtPeriodEnd, true)));
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

async function reloadGrantAny(productId: number) {
  const [row] = await db
    .select()
    .from(userProductsTable)
    .where(
      and(
        eq(userProductsTable.userId, testUserId),
        eq(userProductsTable.productId, productId),
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
    expect(reloaded.nextRetryAt).toBeNull();
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
        nextRetryAt: null,
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

// ── 4. Decline → past_due, arms dunning, queues email ──────────────────────────

describe("processDueRenewals — declined renewal", () => {
  it("marks past_due, arms dunning schedule, queues payment_failed email, not re-charged", async () => {
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
    expect(reloaded.retryCount).toBe(1);
    // Period NOT advanced.
    expect(reloaded.currentPeriodEnd.getTime()).toBe(periodEnd.getTime());
    expect(reloaded.nextChargeAt!.getTime()).toBe(periodEnd.getTime());
    expect(reloaded.lastFailureReason).toBeTruthy();
    // Dunning schedule armed: next_retry_at ≈ now + 3 days.
    expect(reloaded.nextRetryAt).not.toBeNull();
    const expectedRetry = now.getTime() + 3 * 24 * 60 * 60 * 1000;
    expect(Math.abs(reloaded.nextRetryAt!.getTime() - expectedRetry)).toBeLessThan(5000);

    // payment_failed email queued.
    expect(mockQueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({ templateSlug: "payment_failed" }),
    );

    // Grant expiry NOT extended.
    const grant = await reloadGrant(productId);
    expect(grant.expiresAt!.getTime()).toBe(periodEnd.getTime());

    // A second run does NOT re-charge (past_due is excluded from Phase 1 selection).
    fetchMock.mockReset();
    const second = await processDueRenewals({ now });
    expect(second.processed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── 5. cancel_at_period_end skipped by Phase 1 ──────────────────────────────────

describe("processDueRenewals — cancel_at_period_end (Phase 1 skip)", () => {
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
    // Phase 1 skips it; Phase 2b finalizes it (period ended).
    expect(fetchMock).not.toHaveBeenCalled();

    const reloaded = await reloadSub(sub.id);
    // Phase 2b ran and finalized it as canceled.
    expect(reloaded.status).toBe("canceled");
    expect(result.canceled).toBe(1);
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

// ── 7. Retry success (attempt #2): recovery to active ───────────────────────────

describe("processDueRenewals — dunning retry success", () => {
  it("recovers subscription to active, advances period, extends grant, no email on recovery", async () => {
    const productId = await seedProduct("retry-success", 4900);
    const now = new Date();
    const periodStart = new Date(now.getTime() - 38 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    // Simulate: original decline happened 5d ago, retry is now due (+3d cadence).
    const nextRetryAt = new Date(now.getTime() - 60_000); // just past due
    const sub = await seedSub({
      productId,
      amountCents: 4900,
      status: "past_due",
      retryCount: 1,
      nextRetryAt,
      nextChargeAt: periodEnd, // stays at original period end
      periodStart,
      periodEnd,
      grantExpiresAt: periodEnd, // access still on
    });

    fetchMock.mockResolvedValueOnce(nmiApprovedResponse("TXN_RETRY_SUCCESS"));

    const result = await processDueRenewals({ now });

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.declined).toBe(0);
    expect(result.revoked).toBe(0);

    const reloaded = await reloadSub(sub.id);
    expect(reloaded.status).toBe("active");
    expect(reloaded.retryCount).toBe(0);
    expect(reloaded.nextRetryAt).toBeNull();
    expect(reloaded.lastFailureReason).toBeNull();
    // Period advanced from where it left off (not from now).
    expect(reloaded.currentPeriodStart.getTime()).toBe(periodEnd.getTime());
    const expectedEnd = new Date(periodEnd);
    expectedEnd.setMonth(expectedEnd.getMonth() + 1);
    expect(reloaded.currentPeriodEnd.getTime()).toBe(expectedEnd.getTime());

    // Grant extended.
    const grant = await reloadGrant(productId);
    expect(grant.expiresAt!.getTime()).toBe(expectedEnd.getTime());

    // Charged on the pinned vault at the snapshot amount.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const posted = new URLSearchParams(opts.body as string);
    expect(posted.get("customer_vault_id")).toBe(SAVED_VAULT_ID);
    expect(posted.get("amount")).toBe("49.00");

    // No email on recovery.
    expect(mockQueueEmail).not.toHaveBeenCalled();
  });
});

// ── 8. Retry decline (attempt #2 → advance cadence anchored to schedule) ───────

describe("processDueRenewals — dunning retry decline (advance cadence)", () => {
  it("advances retry_count to 2, anchors next_retry to seeded schedule (+4d), no email", async () => {
    const productId = await seedProduct("retry-advance", 4900);
    const now = new Date();
    const periodStart = new Date(now.getTime() - 38 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    // The seeded nextRetryAt represents the SCHEDULED attempt #2 time.
    // Even if the worker runs slightly late, the next slot should be anchored
    // to this value (+4d), not to execution time — so the cadence is fixed.
    const seededNextRetryAt = new Date(now.getTime() - 5 * 60 * 1000); // 5 min overdue
    const sub = await seedSub({
      productId,
      amountCents: 4900,
      status: "past_due",
      retryCount: 1,
      nextRetryAt: seededNextRetryAt,
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
    expect(result.revoked).toBe(0);

    const reloaded = await reloadSub(sub.id);
    expect(reloaded.status).toBe("past_due");
    expect(reloaded.retryCount).toBe(2);
    // next_retry_at is anchored to the SEEDED schedule (+4d), not execution time.
    // This preserves due→+3d→+7d even if the worker ran late.
    const expectedNext = seededNextRetryAt.getTime() + 4 * 24 * 60 * 60 * 1000;
    expect(Math.abs(reloaded.nextRetryAt!.getTime() - expectedNext)).toBeLessThan(5000);

    // Access still on: grant not revoked.
    const grant = await reloadGrant(productId);
    expect(grant).toBeDefined();
    expect(grant.expiresAt!.getTime()).toBe(periodEnd.getTime());

    // No email on intermediate retry decline.
    expect(mockQueueEmail).not.toHaveBeenCalled();
  });

  it("does NOT re-queue an email when the same retry slot is replayed (replay_declined)", async () => {
    const productId = await seedProduct("retry-replay-nodupe", 4900);
    const now = new Date();
    const periodStart = new Date(now.getTime() - 38 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const seededNextRetryAt = new Date(now.getTime() - 60_000);
    const sub = await seedSub({
      productId,
      amountCents: 4900,
      status: "past_due",
      retryCount: 1,
      nextRetryAt: seededNextRetryAt,
      nextChargeAt: periodEnd,
      periodStart,
      periodEnd,
      grantExpiresAt: periodEnd,
    });

    // First run: fresh decline → stores idempotency key with declined outcomeType.
    fetchMock.mockResolvedValueOnce(nmiDeclinedResponse());
    const first = await processDueRenewals({ now });
    expect(first.declined).toBe(1);
    expect(mockQueueEmail).not.toHaveBeenCalled(); // no email for intermediate retry

    // Revert the sub so the second run picks it up again (same period_end → same key).
    await db
      .update(subscriptionsTable)
      .set({
        status: "past_due",
        retryCount: 1,
        nextRetryAt: seededNextRetryAt,
        lastFailureReason: null,
      })
      .where(eq(subscriptionsTable.id, sub.id));

    mockQueueEmail.mockReset();

    // Second run: replay_declined — idempotency key already stored → NO second charge, NO email.
    const second = await processDueRenewals({ now });
    expect(second.processed).toBe(1);
    expect(second.declined).toBe(1);
    // No second gateway call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // No email re-queued on replay.
    expect(mockQueueEmail).not.toHaveBeenCalled();
  });
});

// ── 9. Final retry decline (attempt #3 → unpaid + revoke) ─────────────────────

describe("processDueRenewals — dunning final failure", () => {
  it("marks unpaid, revokes grant, queues payment_failed_final email", async () => {
    const productId = await seedProduct("retry-final", 4900);
    const now = new Date();
    const periodStart = new Date(now.getTime() - 42 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000);
    const nextRetryAt = new Date(now.getTime() - 60_000);
    const sub = await seedSub({
      productId,
      amountCents: 4900,
      status: "past_due",
      retryCount: 2,            // attempt #3 is the final attempt
      nextRetryAt,
      nextChargeAt: periodEnd,
      periodStart,
      periodEnd,
      grantExpiresAt: periodEnd,  // access still on going into the charge
    });

    fetchMock.mockResolvedValueOnce(nmiDeclinedResponse());

    const result = await processDueRenewals({ now });

    expect(result.processed).toBe(1);
    expect(result.declined).toBe(1);
    expect(result.revoked).toBe(1);
    expect(result.succeeded).toBe(0);

    const reloaded = await reloadSub(sub.id);
    expect(reloaded.status).toBe("unpaid");
    expect(reloaded.nextRetryAt).toBeNull();
    expect(reloaded.lastFailureReason).toBeTruthy();

    // Grant revoked.
    const grant = await reloadGrantAny(productId);
    expect(grant.status).toBe("cancelled");
    expect(grant.cancelledAt).not.toBeNull();

    // Final failure email queued.
    expect(mockQueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({ templateSlug: "payment_failed_final" }),
    );

    // No further retries: a subsequent run does not pick up the unpaid sub.
    fetchMock.mockReset();
    mockQueueEmail.mockReset();
    const second = await processDueRenewals({ now });
    expect(second.processed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockQueueEmail).not.toHaveBeenCalled();
  });
});

// ── 10. Final failure revoke scope — only the failed product is revoked ─────────

describe("processDueRenewals — final failure revoke scope", () => {
  it("revokes only the failing subscription product, not other active grants for the same user", async () => {
    const productIdFailing = await seedProduct("revoke-scope-fail", 4900);
    const productIdOther = await seedProduct("revoke-scope-other", 4900);
    const now = new Date();
    const periodStart = new Date(now.getTime() - 42 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000);
    const nextRetryAt = new Date(now.getTime() - 60_000);

    // The failing subscription — final retry.
    const sub = await seedSub({
      productId: productIdFailing,
      amountCents: 4900,
      status: "past_due",
      retryCount: 2,
      nextRetryAt,
      nextChargeAt: periodEnd,
      periodStart,
      periodEnd,
      grantExpiresAt: periodEnd,
    });

    // Separate active grant on a different product — must be untouched.
    const [otherGrant] = await db
      .insert(userProductsTable)
      .values({
        userId: testUserId,
        productId: productIdOther,
        status: "active",
        externalSource: "nmi",
        externalOrderId: `seed-scope-other-${sub.id}`,
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      })
      .returning();

    fetchMock.mockResolvedValueOnce(nmiDeclinedResponse());

    const result = await processDueRenewals({ now });
    expect(result.declined).toBe(1);
    expect(result.revoked).toBe(1);

    // Failing product grant revoked.
    const failedGrant = await reloadGrantAny(productIdFailing);
    expect(failedGrant.status).toBe("cancelled");

    // Other product grant untouched.
    const [otherReloaded] = await db
      .select()
      .from(userProductsTable)
      .where(eq(userProductsTable.id, otherGrant.id));
    expect(otherReloaded.status).toBe("active");
    expect(otherReloaded.cancelledAt).toBeNull();
  });
});

// ── 11. Per-attempt idempotency ─────────────────────────────────────────────────

describe("processDueRenewals — retry idempotency", () => {
  it("replays the retry without a second charge when the same attempt slot runs twice", async () => {
    const productId = await seedProduct("retry-idempotent", 4900);
    const now = new Date();
    const periodStart = new Date(now.getTime() - 38 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const nextRetryAt = new Date(now.getTime() - 60_000);
    const sub = await seedSub({
      productId,
      amountCents: 4900,
      status: "past_due",
      retryCount: 1,
      nextRetryAt,
      nextChargeAt: periodEnd,
      periodStart,
      periodEnd,
      grantExpiresAt: periodEnd,
    });

    fetchMock.mockResolvedValue(nmiApprovedResponse("TXN_RETRY_IDEM"));

    const first = await processDueRenewals({ now });
    expect(first.succeeded).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Revert sub to past_due state (same period_end = same key).
    await db
      .update(subscriptionsTable)
      .set({
        status: "past_due",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        nextChargeAt: periodEnd,
        nextRetryAt,
        retryCount: 1,
        lastFailureReason: null,
      })
      .where(eq(subscriptionsTable.id, sub.id));

    const second = await processDueRenewals({ now });
    expect(second.processed).toBe(1);
    expect(second.succeeded).toBe(1);
    // No second gateway charge.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ── 11. cancel_at_period_end finalization (period ended) ────────────────────────

describe("processDueRenewals — cancel_at_period_end finalization", () => {
  it("finalizes as canceled and revokes grant when period has ended", async () => {
    const productId = await seedProduct("finalize-cancel", 4900);
    const now = new Date();
    const periodStart = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // ended yesterday

    // Insert manually to avoid the beforeEach neutralizer (which runs BEFORE seedSub).
    const [sub] = await db
      .insert(subscriptionsTable)
      .values({
        userId: testUserId,
        productId,
        paymentMethodId: savedCardId,
        status: "active",
        interval: "monthly",
        amountCents: 4900,
        currency: "USD",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        nextChargeAt: FAR_FUTURE,       // Phase 1 won't touch it
        retryCount: 0,
        cancelAtPeriodEnd: true,
        canceledAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      })
      .returning();
    seededSubscriptionIds.push(sub.id);
    await db.insert(userProductsTable).values({
      userId: testUserId,
      productId,
      status: "active",
      externalSource: "nmi",
      externalOrderId: `seed-cancel-${sub.id}`,
      expiresAt: periodEnd,
    });

    const result = await processDueRenewals({ now });

    expect(result.canceled).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();

    const reloaded = await reloadSub(sub.id);
    expect(reloaded.status).toBe("canceled");
    expect(reloaded.nextChargeAt).toBeNull();
    expect(reloaded.nextRetryAt).toBeNull();

    // Grant revoked.
    const grant = await reloadGrantAny(productId);
    expect(grant.status).toBe("cancelled");
    expect(grant.cancelledAt).not.toBeNull();

    // No email for user-initiated cancellation.
    expect(mockQueueEmail).not.toHaveBeenCalled();
  });
});

// ── 12. past_due + cancel_at_period_end overlap — finalized, never charged ──────

describe("processDueRenewals — past_due + cancel_at_period_end overlap", () => {
  it("finalizes as canceled without charging when past_due sub also has cancel_at_period_end and period ended", async () => {
    const productId = await seedProduct("pastdue-cancel-overlap", 4900);
    const now = new Date();
    const periodStart = new Date(now.getTime() - 42 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000); // period ended
    const nextRetryAt = new Date(now.getTime() - 60_000); // retry also due

    // A sub that is BOTH past_due (with a pending retry) AND cancel_at_period_end.
    // This can happen when a member cancels while already in dunning.
    // The correct behavior: finalize as canceled (no charge).
    const [sub] = await db
      .insert(subscriptionsTable)
      .values({
        userId: testUserId,
        productId,
        paymentMethodId: savedCardId,
        status: "past_due",
        interval: "monthly",
        amountCents: 4900,
        currency: "USD",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        nextChargeAt: periodEnd,
        retryCount: 1,
        nextRetryAt,
        cancelAtPeriodEnd: true,
        canceledAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      })
      .returning();
    seededSubscriptionIds.push(sub.id);
    await db.insert(userProductsTable).values({
      userId: testUserId,
      productId,
      status: "active",
      externalSource: "nmi",
      externalOrderId: `seed-overlap-${sub.id}`,
      expiresAt: periodEnd,
    });

    const result = await processDueRenewals({ now });

    // Finalized as canceled — no charge.
    expect(result.canceled).toBe(1);
    expect(result.declined).toBe(0);
    expect(result.revoked).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();

    const reloaded = await reloadSub(sub.id);
    expect(reloaded.status).toBe("canceled");

    // Grant revoked.
    const grant = await reloadGrantAny(productId);
    expect(grant.status).toBe("cancelled");

    // No dunning email sent.
    expect(mockQueueEmail).not.toHaveBeenCalled();
  });
});

// ── 13. cancel_at_period_end not yet ended — not touched ───────────────────────

describe("processDueRenewals — cancel_at_period_end period not yet ended", () => {
  it("leaves the subscription untouched when the period has not yet elapsed", async () => {
    const productId = await seedProduct("cancel-future", 4900);
    const now = new Date();
    const periodStart = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000); // ends in future

    const [sub] = await db
      .insert(subscriptionsTable)
      .values({
        userId: testUserId,
        productId,
        paymentMethodId: savedCardId,
        status: "active",
        interval: "monthly",
        amountCents: 4900,
        currency: "USD",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        nextChargeAt: periodEnd,      // not yet due for Phase 1 either
        retryCount: 0,
        cancelAtPeriodEnd: true,
        canceledAt: new Date(),
      })
      .returning();
    seededSubscriptionIds.push(sub.id);

    const result = await processDueRenewals({ now });

    expect(result.processed).toBe(0);
    expect(result.canceled).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();

    const reloaded = await reloadSub(sub.id);
    expect(reloaded.status).toBe("active");
  });
});
