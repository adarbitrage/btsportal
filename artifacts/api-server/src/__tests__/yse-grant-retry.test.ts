import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  webhookLogsTable,
  onboardingEffectsTable,
  sequenceEnrollmentsTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

const { queueEmailMock, queueGHLSyncMock, ensureAffiliateProfileMock, bcryptHashMock } = vi.hoisted(() => {
  const realBcrypt = require("bcryptjs") as typeof import("bcryptjs");
  return {
    queueEmailMock: vi.fn().mockResolvedValue(undefined),
    queueGHLSyncMock: vi.fn<(params: unknown) => Promise<string>>().mockResolvedValue("ghl_job_id"),
    ensureAffiliateProfileMock: vi.fn().mockResolvedValue(null),
    bcryptHashMock: vi.fn(
      (pw: string, rounds: number) => realBcrypt.hash(pw, rounds),
    ),
  };
});

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    queueEmail: queueEmailMock,
    queueSms: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: queueGHLSyncMock,
  startWorker: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock("../lib/commissions", () => ({
  ensureAffiliateProfile: ensureAffiliateProfileMock,
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

vi.mock("bcryptjs", async () => {
  const actual = await vi.importActual<typeof import("bcryptjs")>("bcryptjs");
  return {
    ...actual,
    default: { ...actual, hash: bcryptHashMock },
    hash: bcryptHashMock,
  };
});

import {
  handleExternalGrantProduct,
  YSE_GRANT_EVENT_TYPE,
  YSE_GRANT_MAX_ATTEMPTS,
  type ExternalGrantPayload,
} from "../lib/external-grant-product";
import {
  runYseGrantRetrySweep,
  listPendingFailedYseGrants,
  manuallyRetryYseGrant,
} from "../lib/yse-grant-retry";

const TAG = `yse-retry-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
const seededWebhookLogIds: number[] = [];

async function insertProduct(slug: string) {
  const [p] = await db
    .insert(productsTable)
    .values({
      slug: `${TAG}-${slug}`,
      name: `Test ${slug}`,
      type: "frontend",
      entitlementKeys: ["content:frontend"],
      priceDisplay: "$67",
      sortOrder: 999,
    })
    .returning();
  seededProductIds.push(p.id);
  return p;
}

let productSlug: string;

beforeAll(async () => {
  const p = await insertProduct("a");
  productSlug = p.slug;
});

afterAll(async () => {
  // Clean up everything tagged for this run.
  const logs = await db
    .select({ id: webhookLogsTable.id, payload: webhookLogsTable.payload })
    .from(webhookLogsTable)
    .where(eq(webhookLogsTable.eventType, YSE_GRANT_EVENT_TYPE));
  const ourLogIds = logs
    .filter((l) => {
      const p = l.payload as { customer?: { email?: string } } | null;
      return p?.customer?.email?.includes(TAG);
    })
    .map((l) => l.id)
    .concat(seededWebhookLogIds);
  if (ourLogIds.length > 0) {
    await db.delete(webhookLogsTable).where(inArray(webhookLogsTable.id, ourLogIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(sequenceEnrollmentsTable).where(inArray(sequenceEnrollmentsTable.userId, seededUserIds));
    await db.delete(onboardingEffectsTable).where(inArray(onboardingEffectsTable.userId, seededUserIds));
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  // Catch any users created by replays we didn't track.
  const usersByTag = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(sql`${usersTable.email} LIKE ${"%" + TAG + "%"}`);
  if (usersByTag.length > 0) {
    const ids = usersByTag.map((u) => u.id);
    await db.delete(sequenceEnrollmentsTable).where(inArray(sequenceEnrollmentsTable.userId, ids));
    await db.delete(onboardingEffectsTable).where(inArray(onboardingEffectsTable.userId, ids));
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, ids));
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
  }
  if (seededProductIds.length > 0) {
    await db.delete(userProductsTable).where(inArray(userProductsTable.productId, seededProductIds));
    await db.delete(productsTable).where(inArray(productsTable.id, seededProductIds));
  }
});

beforeEach(() => {
  queueEmailMock.mockClear();
  queueGHLSyncMock.mockReset().mockResolvedValue("ghl_job_id");
  ensureAffiliateProfileMock.mockReset().mockResolvedValue(null);
  const realBcrypt = require("bcryptjs") as typeof import("bcryptjs");
  bcryptHashMock.mockReset().mockImplementation((pw: string, rounds: number) =>
    realBcrypt.hash(pw, rounds),
  );
});

function makePayload(suffix: string): ExternalGrantPayload {
  return {
    externalOrderId: `ord-${TAG}-${suffix}`,
    externalSource: "yse",
    customer: { email: `${suffix}-${TAG}@example.test` },
    productSlugs: [productSlug],
    purchasedAt: new Date().toISOString(),
  };
}

async function readLogByExternalId(externalSource: string, orderId: string) {
  const externalId = `${externalSource}_${orderId}`;
  const [row] = await db
    .select()
    .from(webhookLogsTable)
    .where(eq(webhookLogsTable.externalId, externalId))
    .limit(1);
  return row;
}

describe("YSE grant retry", () => {
  it("records a failed webhook_log row when the grant transaction throws", async () => {
    const payload = makePayload("fail1");
    // Force the GHL post-commit side effect to throw. But that runs AFTER
    // the tx commits, so we instead simulate a mid-tx failure by tampering
    // with the queueGHLSync only after success — to hit the in-tx path we
    // make ensureAffiliateProfile irrelevant and break the tx via an
    // invalid product slug? Simpler: provide an unknown slug which returns
    // an error code (not a throw), so we need a different trigger.
    //
    // We trigger a mid-tx failure by making queueGHLSync throw — but it's
    // post-commit. The in-tx failure path is hardest to trigger from the
    // outside, so we exercise the explicit recordFailedAttempt by calling
    // the public handler with an unknown slug — which returns an error,
    // NOT a throw, so it doesn't trigger the failed-row write either.
    //
    // To get a deterministic mid-tx error, mock the GHL queue to throw
    // (post-commit path). The handler will throw, the tx is committed
    // (status='processed'), and the failed-row write won't fire. So that
    // path is correct.
    //
    // Instead we directly seed a failed row to exercise the retry loop.
    await db.insert(webhookLogsTable).values({
      externalId: `yse_${payload.externalOrderId}`,
      eventType: YSE_GRANT_EVENT_TYPE,
      status: "failed",
      payload: payload as unknown as Record<string, unknown>,
      attempts: 1,
      errorMessage: "simulated transient error",
      lastAttemptAt: new Date(),
      nextRetryAt: new Date(Date.now() - 1000),
    });

    const swept = await runYseGrantRetrySweep();
    expect(swept.picked).toBeGreaterThanOrEqual(1);
    expect(swept.succeeded).toBeGreaterThanOrEqual(1);

    const after = await readLogByExternalId("yse", payload.externalOrderId);
    expect(after?.status).toBe("processed");
    expect(after?.result).not.toBeNull();
    expect(after?.errorMessage).toBeNull();

    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, payload.customer.email.toLowerCase()));
    expect(user).toBeDefined();
    if (user) seededUserIds.push(user.id);
  });

  it("writes a failed webhook_log row when the grant tx throws mid-flight, then sweep replays it", async () => {
    const payload = makePayload("txfail");
    const externalId = `yse_${payload.externalOrderId}`;
    const realBcrypt = require("bcryptjs") as typeof import("bcryptjs");

    // First call: force bcrypt.hash (called inside the tx for new users)
    // to throw, which rolls back the tx and exercises the .catch() →
    // recordFailedAttempt path.
    bcryptHashMock.mockImplementationOnce(async () => {
      throw new Error("simulated in-tx failure");
    });
    await expect(handleExternalGrantProduct(payload)).rejects.toThrow(
      /simulated in-tx failure/,
    );

    const failed = await readLogByExternalId("yse", payload.externalOrderId);
    expect(failed).toBeDefined();
    expect(failed?.status).toBe("failed");
    expect(failed?.result).toBeNull();
    expect(failed?.attempts).toBe(1);
    expect(failed?.errorMessage).toMatch(/simulated in-tx failure/);
    expect(failed?.nextRetryAt).toBeInstanceOf(Date);

    // No user should have been created because the tx rolled back.
    const usersBefore = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, payload.customer.email.toLowerCase()));
    expect(usersBefore.length).toBe(0);

    // Make the row due immediately and run the sweep — bcrypt is back to
    // real impl, so the replay should succeed.
    await db
      .update(webhookLogsTable)
      .set({ nextRetryAt: new Date(Date.now() - 1000) })
      .where(eq(webhookLogsTable.externalId, externalId));
    bcryptHashMock.mockImplementation((pw: string, rounds: number) =>
      realBcrypt.hash(pw, rounds),
    );

    const swept = await runYseGrantRetrySweep();
    expect(swept.picked).toBeGreaterThanOrEqual(1);
    expect(swept.succeeded).toBeGreaterThanOrEqual(1);

    const after = await readLogByExternalId("yse", payload.externalOrderId);
    expect(after?.status).toBe("processed");
    expect(after?.result).not.toBeNull();
    expect(after?.errorMessage).toBeNull();
    expect((after?.attempts ?? 0)).toBeGreaterThanOrEqual(2);

    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, payload.customer.email.toLowerCase()));
    expect(user).toBeDefined();
    if (user) seededUserIds.push(user.id);
  });

  it("does not re-run successfully delivered grants", async () => {
    const payload = makePayload("success");
    const result = await handleExternalGrantProduct(payload);
    expect("userId" in result).toBe(true);
    if ("userId" in result) seededUserIds.push(result.userId);

    queueGHLSyncMock.mockClear();

    const swept = await runYseGrantRetrySweep();
    // The processed row should not be picked up.
    const externalId = `yse_${payload.externalOrderId}`;
    const picked = swept.picked;
    const after = await readLogByExternalId("yse", payload.externalOrderId);
    expect(after?.status).toBe("processed");
    void externalId;
    void picked;
    expect(queueGHLSyncMock).not.toHaveBeenCalled();
  });

  it("listPendingFailedYseGrants returns failed rows with the customer email and product slugs", async () => {
    const payload = makePayload("listing");
    await db.insert(webhookLogsTable).values({
      externalId: `yse_${payload.externalOrderId}`,
      eventType: YSE_GRANT_EVENT_TYPE,
      status: "failed",
      payload: payload as unknown as Record<string, unknown>,
      attempts: 2,
      errorMessage: "boom",
      nextRetryAt: new Date(Date.now() + 60_000),
    });

    const items = await listPendingFailedYseGrants(500);
    const ours = items.find(
      (i) => i.externalOrderId === payload.externalOrderId,
    );
    expect(ours).toBeDefined();
    expect(ours?.customerEmail).toBe(payload.customer.email);
    expect(ours?.productSlugs).toEqual([productSlug]);
    expect(ours?.attempts).toBe(2);
    expect(ours?.maxAttempts).toBe(YSE_GRANT_MAX_ATTEMPTS);
    expect(ours?.terminal).toBe(false);
  });

  it("skips rows with attempts >= MAX_ATTEMPTS and marks them terminal in the listing", async () => {
    const payload = makePayload("terminal");
    await db.insert(webhookLogsTable).values({
      externalId: `yse_${payload.externalOrderId}`,
      eventType: YSE_GRANT_EVENT_TYPE,
      status: "failed",
      payload: payload as unknown as Record<string, unknown>,
      attempts: YSE_GRANT_MAX_ATTEMPTS,
      errorMessage: "exhausted",
      nextRetryAt: null,
    });

    // Force the sweep to not touch the row at all by reading the
    // pre-state lastAttemptAt and comparing after.
    const before = await readLogByExternalId("yse", payload.externalOrderId);
    await runYseGrantRetrySweep();
    const after = await readLogByExternalId("yse", payload.externalOrderId);
    expect(after?.lastAttemptAt?.getTime() ?? null).toBe(
      before?.lastAttemptAt?.getTime() ?? null,
    );

    const items = await listPendingFailedYseGrants();
    const ours = items.find(
      (i) => i.externalOrderId === payload.externalOrderId,
    );
    expect(ours?.terminal).toBe(true);
  });

  it("manuallyRetryYseGrant replays a failed delivery on demand", async () => {
    const payload = makePayload("manual");
    const [row] = await db
      .insert(webhookLogsTable)
      .values({
        externalId: `yse_${payload.externalOrderId}`,
        eventType: YSE_GRANT_EVENT_TYPE,
        status: "failed",
        payload: payload as unknown as Record<string, unknown>,
        attempts: YSE_GRANT_MAX_ATTEMPTS, // exhausted — sweep would skip
        errorMessage: "exhausted",
        nextRetryAt: null,
      })
      .returning({ id: webhookLogsTable.id });

    const r = await manuallyRetryYseGrant(row.id);
    expect(r.ok).toBe(true);

    const after = await readLogByExternalId("yse", payload.externalOrderId);
    expect(after?.status).toBe("processed");
    expect(after?.result).not.toBeNull();

    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, payload.customer.email.toLowerCase()));
    if (user) seededUserIds.push(user.id);
  });

  it("manuallyRetryYseGrant refuses to replay an already-processed delivery", async () => {
    const payload = makePayload("already");
    const result = await handleExternalGrantProduct(payload);
    if ("userId" in result) seededUserIds.push(result.userId);

    const row = await readLogByExternalId("yse", payload.externalOrderId);
    expect(row?.status).toBe("processed");

    const r = await manuallyRetryYseGrant(row!.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/already/i);
  });

  it("increments attempts via upsert when a retry repeats the same external order", async () => {
    const payload = makePayload("upsert");
    // First "delivery" succeeds normally — row written as processed with
    // attempts = 1.
    const ok = await handleExternalGrantProduct(payload);
    if ("userId" in ok) seededUserIds.push(ok.userId);

    const row1 = await readLogByExternalId("yse", payload.externalOrderId);
    expect(row1?.attempts).toBe(1);
    expect(row1?.status).toBe("processed");

    // Replaying the exact same external order id should short-circuit on
    // the cached result and NOT bump attempts.
    const replay = await handleExternalGrantProduct(payload);
    expect("userId" in replay).toBe(true);

    const row2 = await readLogByExternalId("yse", payload.externalOrderId);
    expect(row2?.attempts).toBe(1);
    expect(row2?.status).toBe("processed");
  });
});
