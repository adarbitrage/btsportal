import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { db, webhookLogsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import {
  YSE_GRANT_EVENT_TYPE,
  YSE_GRANT_MAX_ATTEMPTS,
  type ExternalGrantPayload,
} from "../lib/external-grant-product";
import {
  evaluateExhaustedYseGrants,
  __resetYseGrantExhaustedAlerterForTests,
  __setYseGrantExhaustedAlerterDeliveriesForTests,
  type YseGrantExhaustedPayload,
  type DeliveryResult,
} from "../lib/yse-grant-exhausted-alerter";

const TAG = `yse-exh-${randomUUID().slice(0, 8)}`;
const seededIds: number[] = [];

function makePayload(suffix: string): ExternalGrantPayload {
  return {
    externalOrderId: `ord-${TAG}-${suffix}`,
    externalSource: "yse",
    customer: { email: `${suffix}-${TAG}@example.test` },
    productSlugs: [`${TAG}-pa`],
    purchasedAt: new Date().toISOString(),
  };
}

async function seedRow(opts: {
  suffix: string;
  attempts: number;
  status?: string;
  result?: Record<string, unknown> | null;
  alertSentAt?: Date | null;
  alertClaimedAt?: Date | null;
}): Promise<number> {
  const payload = makePayload(opts.suffix);
  const [row] = await db
    .insert(webhookLogsTable)
    .values({
      externalId: `yse_${payload.externalOrderId}`,
      eventType: YSE_GRANT_EVENT_TYPE,
      status: opts.status ?? "failed",
      payload: payload as unknown as Record<string, unknown>,
      result: opts.result ?? null,
      attempts: opts.attempts,
      errorMessage: "boom",
      lastAttemptAt: new Date(),
      nextRetryAt: null,
      alertSentAt: opts.alertSentAt ?? null,
      alertClaimedAt: opts.alertClaimedAt ?? null,
    })
    .returning({ id: webhookLogsTable.id });
  seededIds.push(row.id);
  return row.id;
}

beforeAll(() => {
  // Quiet down the console output for the assertion-only flow.
});

afterAll(async () => {
  if (seededIds.length > 0) {
    await db
      .delete(webhookLogsTable)
      .where(inArray(webhookLogsTable.id, seededIds));
  }
});

interface StubDelivery {
  fn: (p: YseGrantExhaustedPayload) => Promise<DeliveryResult>;
  calls: YseGrantExhaustedPayload[];
}

function makeStub(channel: "pagerduty" | "email" | "slack"): StubDelivery {
  const calls: YseGrantExhaustedPayload[] = [];
  const fn = vi.fn(
    async (p: YseGrantExhaustedPayload): Promise<DeliveryResult> => {
      calls.push(p);
      return { channel, ok: true };
    },
  );
  return { fn, calls };
}

describe("YSE grant exhausted-retries alerter", () => {
  let pd: StubDelivery;
  let email: StubDelivery;
  let slack: StubDelivery;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetYseGrantExhaustedAlerterForTests();
    pd = makeStub("pagerduty");
    email = makeStub("email");
    slack = makeStub("slack");
    __setYseGrantExhaustedAlerterDeliveriesForTests({
      pagerduty: pd.fn,
      email: email.fn,
      slack: slack.fn,
    });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(() => {
    __setYseGrantExhaustedAlerterDeliveriesForTests(null);
    logSpy?.mockRestore();
    errSpy?.mockRestore();
  });

  it("pages on-call once per exhausted row and marks alert_sent_at", async () => {
    const id = await seedRow({
      suffix: "fires",
      attempts: YSE_GRANT_MAX_ATTEMPTS,
    });

    const r1 = await evaluateExhaustedYseGrants();
    expect(r1.alerted).toBeGreaterThanOrEqual(1);

    const ours = pd.calls.find((c) => c.webhookLogId === id);
    expect(ours).toBeDefined();
    expect(ours?.attempts).toBe(YSE_GRANT_MAX_ATTEMPTS);
    expect(ours?.customerEmail).toBe(`fires-${TAG}@example.test`);
    expect(email.calls.find((c) => c.webhookLogId === id)).toBeDefined();
    expect(slack.calls.find((c) => c.webhookLogId === id)).toBeDefined();

    const [after] = await db
      .select({ alertSentAt: webhookLogsTable.alertSentAt })
      .from(webhookLogsTable)
      .where(eq(webhookLogsTable.id, id));
    expect(after.alertSentAt).toBeInstanceOf(Date);

    // Second sweep should NOT re-page (alert_sent_at gate is set).
    const callsBefore = pd.calls.length;
    const r2 = await evaluateExhaustedYseGrants();
    void r2;
    expect(pd.calls.length).toBe(callsBefore);
  });

  it("does not page rows that are still under the retry cap", async () => {
    const id = await seedRow({
      suffix: "under",
      attempts: Math.max(0, YSE_GRANT_MAX_ATTEMPTS - 1),
    });

    await evaluateExhaustedYseGrants();

    expect(pd.calls.find((c) => c.webhookLogId === id)).toBeUndefined();

    const [after] = await db
      .select({ alertSentAt: webhookLogsTable.alertSentAt })
      .from(webhookLogsTable)
      .where(eq(webhookLogsTable.id, id));
    expect(after.alertSentAt).toBeNull();
  });

  it("does not page rows that have already been processed", async () => {
    const id = await seedRow({
      suffix: "processed",
      attempts: YSE_GRANT_MAX_ATTEMPTS,
      status: "processed",
      result: { ok: true },
    });

    await evaluateExhaustedYseGrants();

    expect(pd.calls.find((c) => c.webhookLogId === id)).toBeUndefined();
  });

  it("does not re-page a row whose alert_sent_at is already set", async () => {
    const id = await seedRow({
      suffix: "already",
      attempts: YSE_GRANT_MAX_ATTEMPTS,
      alertSentAt: new Date(Date.now() - 60_000),
    });

    await evaluateExhaustedYseGrants();

    expect(pd.calls.find((c) => c.webhookLogId === id)).toBeUndefined();
  });

  it("does not mark alert_sent_at when every delivery channel hard-fails", async () => {
    __setYseGrantExhaustedAlerterDeliveriesForTests({
      pagerduty: async () => ({ channel: "pagerduty", ok: false, reason: "boom" }),
      email: async () => ({ channel: "email", ok: false, reason: "boom" }),
      slack: async () => ({ channel: "slack", ok: false, reason: "boom" }),
    });

    const id = await seedRow({
      suffix: "allfail",
      attempts: YSE_GRANT_MAX_ATTEMPTS,
    });

    await evaluateExhaustedYseGrants();

    const [after] = await db
      .select({ alertSentAt: webhookLogsTable.alertSentAt })
      .from(webhookLogsTable)
      .where(eq(webhookLogsTable.id, id));
    expect(after.alertSentAt).toBeNull();
  });

  it("does not re-page a row whose claim is still within the TTL (simulated other-pod in-flight)", async () => {
    // Another pod just claimed this row 10ms ago. Default TTL is 2min,
    // so our sweep must skip the row entirely.
    const id = await seedRow({
      suffix: "leased",
      attempts: YSE_GRANT_MAX_ATTEMPTS,
      alertClaimedAt: new Date(Date.now() - 10),
    });

    await evaluateExhaustedYseGrants();

    expect(pd.calls.find((c) => c.webhookLogId === id)).toBeUndefined();

    const [after] = await db
      .select({
        alertSentAt: webhookLogsTable.alertSentAt,
        alertClaimedAt: webhookLogsTable.alertClaimedAt,
      })
      .from(webhookLogsTable)
      .where(eq(webhookLogsTable.id, id));
    expect(after.alertSentAt).toBeNull();
    expect(after.alertClaimedAt).toBeInstanceOf(Date);
  });

  it("steals an expired claim from a presumed-dead pod and pages on-call", async () => {
    // A previous pod claimed the row but never wrote alert_sent_at —
    // i.e. it crashed between claim and dispatch. The claim is well
    // past the TTL. Our sweep must re-claim and alert.
    const id = await seedRow({
      suffix: "stale",
      attempts: YSE_GRANT_MAX_ATTEMPTS,
      alertClaimedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    await evaluateExhaustedYseGrants();

    expect(pd.calls.find((c) => c.webhookLogId === id)).toBeDefined();

    const [after] = await db
      .select({
        alertSentAt: webhookLogsTable.alertSentAt,
        alertClaimedAt: webhookLogsTable.alertClaimedAt,
      })
      .from(webhookLogsTable)
      .where(eq(webhookLogsTable.id, id));
    expect(after.alertSentAt).toBeInstanceOf(Date);
    expect(after.alertClaimedAt).toBeNull();
  });

  it("treats a fully-skipped (not_configured) dispatch as delivered so we don't re-page every sweep", async () => {
    __setYseGrantExhaustedAlerterDeliveriesForTests({
      pagerduty: async () => ({
        channel: "pagerduty",
        ok: true,
        skipped: true,
        reason: "not_configured",
      }),
      email: async () => ({
        channel: "email",
        ok: true,
        skipped: true,
        reason: "not_configured",
      }),
      slack: async () => ({
        channel: "slack",
        ok: true,
        skipped: true,
        reason: "not_configured",
      }),
    });

    const id = await seedRow({
      suffix: "skipped",
      attempts: YSE_GRANT_MAX_ATTEMPTS,
    });

    await evaluateExhaustedYseGrants();

    const [after] = await db
      .select({ alertSentAt: webhookLogsTable.alertSentAt })
      .from(webhookLogsTable)
      .where(eq(webhookLogsTable.id, id));
    expect(after.alertSentAt).toBeInstanceOf(Date);
  });
});
