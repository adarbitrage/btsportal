import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  webhookLogsTable,
} from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";

// The webhook handler fans out to a number of side-effect helpers. We mock
// them all so the test exercises only the billing-SMS gating decision
// (smsOptIn && billingSmsOptIn && phone) and never reaches Redis/GHL/email.
const { queueEmailMock, queueSmsMock, queueGHLSyncMock, ensureAffiliateProfileMock, enrollInSequenceMock } =
  vi.hoisted(() => ({
    queueEmailMock: vi.fn(async (..._args: any[]) => ({ result: "queued" as const })),
    queueSmsMock: vi.fn(async (..._args: any[]) => ({ result: "queued" as const })),
    queueGHLSyncMock: vi.fn(async (..._args: any[]) => "ghl_job_id"),
    ensureAffiliateProfileMock: vi.fn(async (..._args: any[]) => null),
    enrollInSequenceMock: vi.fn(async (..._args: any[]) => undefined),
  }));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    queueEmail: queueEmailMock,
    queueSms: queueSmsMock,
  },
}));

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: queueGHLSyncMock,
  startWorker: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock("../lib/commissions", () => ({
  ensureAffiliateProfile: ensureAffiliateProfileMock,
  resolveUserCommissionTier: vi.fn(async () => null),
}));

vi.mock("../lib/sequence-helpers", () => ({
  enrollInSequence: enrollInSequenceMock,
}));

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

vi.mock("../lib/webhook-events", () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
  WEBHOOK_EVENT_TYPES: [],
}));

import { processWebhookEvent } from "../lib/webhook-handler";

const TEST_TAG = `billing-sms-${randomUUID().slice(0, 8)}`;
const THRIVECART_PRODUCT_ID = `tc_${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];

let productId: number;

interface SmsPrefs {
  smsOptIn: boolean;
  billingSmsOptIn: boolean;
  phone: string | null;
}

async function seedMember(suffix: string, prefs: SmsPrefs): Promise<{ id: number; email: string }> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test ${suffix}`,
      passwordHash,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
      phone: prefs.phone,
      smsOptIn: prefs.smsOptIn,
      billingSmsOptIn: prefs.billingSmsOptIn,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email };
}

function purchaseBody(email: string) {
  return {
    event: "order.success",
    order: {
      id: `ord_${randomUUID().slice(0, 10)}`,
      customer: { email },
      item: { id: THRIVECART_PRODUCT_ID, name: "Billing SMS Test Product" },
      subscription: { id: `sub_${randomUUID().slice(0, 8)}` },
    },
  };
}

function paymentFailedBody(email: string) {
  return {
    event: "order.subscription_payment_failed",
    order: {
      id: `ord_${randomUUID().slice(0, 10)}`,
      customer: { email },
      item: { id: THRIVECART_PRODUCT_ID },
    },
  };
}

function smsCallsFor(templateSlug: string) {
  return queueSmsMock.mock.calls.filter(
    (c: unknown[]) => (c[0] as { templateSlug: string }).templateSlug === templateSlug,
  );
}

beforeAll(async () => {
  const [product] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-product`,
      name: "Billing SMS Test Product",
      type: "frontend",
      entitlementKeys: ["content:frontend", "support:basic"],
      thrivecartProductId: THRIVECART_PRODUCT_ID,
      priceDisplay: "$67",
      sortOrder: 999,
    })
    .returning({ id: productsTable.id });
  productId = product.id;
  seededProductIds.push(product.id);
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  if (seededProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, seededProductIds));
  }
  await db.delete(webhookLogsTable).where(like(webhookLogsTable.externalId, "order.%"));
});

beforeEach(() => {
  queueEmailMock.mockClear();
  queueSmsMock.mockClear();
  queueGHLSyncMock.mockClear();
  ensureAffiliateProfileMock.mockClear();
  enrollInSequenceMock.mockClear();
});

describe("webhook purchase_confirmation SMS — billing category gating", () => {
  it("does NOT send the purchase-confirmation text when the member turned off billing texts (master SMS still on)", async () => {
    const member = await seedMember("purchase-billing-off", {
      smsOptIn: true,
      billingSmsOptIn: false,
      phone: "+15555550301",
    });

    const result = await processWebhookEvent(purchaseBody(member.email), true);
    expect(result.success).toBe(true);

    // The product is still granted and the email still goes out…
    const grants = await db
      .select({ id: userProductsTable.id })
      .from(userProductsTable)
      .where(eq(userProductsTable.userId, member.id));
    expect(grants.length).toBeGreaterThanOrEqual(1);
    expect(
      queueEmailMock.mock.calls.some(
        (c: unknown[]) => (c[0] as { templateSlug: string }).templateSlug === "purchase_confirmation",
      ),
    ).toBe(true);

    // …but no billing text is queued.
    expect(smsCallsFor("purchase_confirmation")).toHaveLength(0);
  });

  it("sends the purchase-confirmation text when both master SMS and billing texts are on", async () => {
    const member = await seedMember("purchase-billing-on", {
      smsOptIn: true,
      billingSmsOptIn: true,
      phone: "+15555550302",
    });

    const result = await processWebhookEvent(purchaseBody(member.email), true);
    expect(result.success).toBe(true);

    const calls = smsCallsFor("purchase_confirmation");
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({
      templateSlug: "purchase_confirmation",
      to: "+15555550302",
      userId: member.id,
    });
  });
});

describe("webhook payment_failed SMS — billing category gating", () => {
  it("does NOT send the failed-payment text when the member turned off billing texts (master SMS still on)", async () => {
    const member = await seedMember("failed-billing-off", {
      smsOptIn: true,
      billingSmsOptIn: false,
      phone: "+15555550303",
    });
    await db.insert(userProductsTable).values({
      userId: member.id,
      productId,
      status: "active",
    });

    const result = await processWebhookEvent(paymentFailedBody(member.email), true);
    expect(result.success).toBe(true);

    // The dunning email still goes out…
    expect(
      queueEmailMock.mock.calls.some(
        (c: unknown[]) => (c[0] as { templateSlug: string }).templateSlug === "payment_failed",
      ),
    ).toBe(true);
    // …but no billing text is queued.
    expect(smsCallsFor("payment_failed")).toHaveLength(0);
  });

  it("sends the failed-payment text when both master SMS and billing texts are on", async () => {
    const member = await seedMember("failed-billing-on", {
      smsOptIn: true,
      billingSmsOptIn: true,
      phone: "+15555550304",
    });
    await db.insert(userProductsTable).values({
      userId: member.id,
      productId,
      status: "active",
    });

    const result = await processWebhookEvent(paymentFailedBody(member.email), true);
    expect(result.success).toBe(true);

    const calls = smsCallsFor("payment_failed");
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({
      templateSlug: "payment_failed",
      to: "+15555550304",
      userId: member.id,
    });
  });
});
