/**
 * End-to-end-ish test for the fix that makes on-call alerts work correctly
 * when the api-server runs on multiple instances. Two pods share the same
 * "Redis" (a single in-memory fake) and both observe the same DB rows, then
 * both try to dispatch alerts. Only one of them should actually page on-call
 * for any given fire/clear transition; the other must report the transition
 * as already-handled or throttled.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

interface FakeAuditRow {
  actionType: string;
  entityType: string;
  entityId: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

const auditRows: FakeAuditRow[] = [];

vi.mock("@workspace/db", () => {
  const auditLogTable = {
    actionType: { name: "action_type" },
    entityType: { name: "entity_type" },
    entityId: { name: "entity_id" },
    createdAt: { name: "created_at" },
  };
  const db = {
    insert: (_table: unknown) => ({
      values: async (row: FakeAuditRow) => {
        auditRows.push(row);
      },
    }),
    select: (_cols: unknown) => ({
      from: (_table: unknown) => ({
        where: async (_condition: unknown) => {
          const cutoff = Date.now() - 24 * 60 * 60 * 1000;
          return auditRows
            .filter(
              (r) => r.actionType === "queue_fallback" && r.createdAt.getTime() >= cutoff,
            )
            .map((r) => ({ entityId: r.entityId, createdAt: r.createdAt }));
        },
      }),
    }),
  };
  return { db, auditLogTable };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (a: unknown, b: unknown) => ({ _eq: [a, b] }),
  gte: (a: unknown, b: unknown) => ({ _gte: [a, b] }),
}));

interface FakeRedisStore {
  store: Map<string, { value: string; expiresAt?: number }>;
}

const sharedStore: FakeRedisStore = { store: new Map() };

vi.mock("../lib/redis", () => {
  const expired = (entry: { expiresAt?: number } | undefined, now: number) =>
    entry?.expiresAt !== undefined && entry.expiresAt <= now;

  const fakeRedis = {
    set: async (key: string, value: string, ...optsRaw: Array<string | number>) => {
      const opts = optsRaw.map((o) => String(o));
      const now = Date.now();
      const upper = opts.map((o) => o.toUpperCase());
      const isNX = upper.includes("NX");
      const exIdx = upper.indexOf("EX");
      const ttlSeconds = exIdx >= 0 ? Number(opts[exIdx + 1]) : undefined;
      const existing = sharedStore.store.get(key);
      if (isNX && existing && !expired(existing, now)) return null;
      sharedStore.store.set(key, {
        value,
        expiresAt: ttlSeconds !== undefined ? now + ttlSeconds * 1000 : undefined,
      });
      return "OK";
    },
    del: async (key: string) => (sharedStore.store.delete(key) ? 1 : 0),
    eval: async (_script: string, _numKeys: number, ...rest: string[]) => {
      // Mirror the real Lua: missing key defaults to "0" (not alerting).
      const key = rest[0];
      const newValue = rest[1];
      const ttlSeconds = Number(rest[2]);
      const now = Date.now();
      const existing = sharedStore.store.get(key);
      const cur = existing && !expired(existing, now) ? existing.value : "0";
      if (cur === newValue) return 0;
      sharedStore.store.set(key, {
        value: newValue,
        expiresAt: now + ttlSeconds * 1000,
      });
      return 1;
    },
  };

  return {
    getRedis: () => fakeRedis,
    getRedisConnection: vi.fn(),
    createRedisConnection: vi.fn(),
    isRedisConnected: vi.fn(async () => true),
    isRedisReady: () => true,
  };
});

import {
  evaluateQueueFallbackAlerts,
  __resetQueueFallbackAlerterForTests,
  __setQueueFallbackAlerterDeliveriesForTests,
  type AlertPayload,
  type DeliveryResult,
} from "../lib/queue-fallback-alerter";
import {
  recordQueueFallback,
  __resetQueueFallbackTrackerForTests,
} from "../lib/queue-fallback-tracker";

interface DeliveryRecorder {
  fn: (p: AlertPayload) => Promise<DeliveryResult>;
  calls: AlertPayload[];
}

function recorder(channel: "pagerduty" | "email" | "slack"): DeliveryRecorder {
  const calls: AlertPayload[] = [];
  return {
    calls,
    fn: async (p: AlertPayload): Promise<DeliveryResult> => {
      calls.push(p);
      return { channel, ok: true };
    },
  };
}

describe("queue-fallback-alerter multi-instance", () => {
  let pd: DeliveryRecorder;
  let email: DeliveryRecorder;
  let slack: DeliveryRecorder;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    auditRows.length = 0;
    sharedStore.store.clear();
    __resetQueueFallbackTrackerForTests();
    __resetQueueFallbackAlerterForTests();
    pd = recorder("pagerduty");
    email = recorder("email");
    slack = recorder("slack");
    __setQueueFallbackAlerterDeliveriesForTests({
      pagerduty: pd.fn,
      email: email.fn,
      slack: slack.fn,
    });
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    __setQueueFallbackAlerterDeliveriesForTests(null);
    warnSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.useRealTimers();
  });

  it("two pods racing on the same fire transition only page on-call once", async () => {
    // Pod A records the fallback (so the audit row exists). Awaiting ensures
    // the persist + listener chain has resolved before either pod evaluates.
    await recordQueueFallback("email", { reason: "queue_unavailable" });

    // Both pods evaluate concurrently. Both share the same fake DB and the
    // same fake Redis, so they see the same "currently alerting" truth.
    const [resultsA, resultsB] = await Promise.all([
      evaluateQueueFallbackAlerts(),
      evaluateQueueFallbackAlerts(),
    ]);

    // Across both pods we expect exactly one fire delivery per channel.
    const fireCount = (calls: AlertPayload[]) =>
      calls.filter((c) => c.kind === "fire").length;
    expect(fireCount(pd.calls)).toBe(1);
    expect(fireCount(email.calls)).toBe(1);
    expect(fireCount(slack.calls)).toBe(1);

    // The pod that lost the race reports either no transition (no results
    // for that channel) or a throttled result. Either way it doesn't
    // produce a fresh "ok && !skipped" delivery.
    const allResults = [...resultsA, ...resultsB];
    const realDeliveries = allResults.filter((r) => r.ok && !r.skipped);
    expect(realDeliveries).toHaveLength(3); // one per delivery channel
  });

  it("two pods racing on the same clear transition only resolve once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    await recordQueueFallback("email");
    // First fire (just one pod for setup).
    await evaluateQueueFallbackAlerts();

    // Age the event out so the next evaluation is a clear transition.
    vi.setSystemTime(new Date("2026-01-01T00:10:00Z"));
    __resetQueueFallbackTrackerForTests();
    auditRows.length = 0;

    const [resultsA, resultsB] = await Promise.all([
      evaluateQueueFallbackAlerts(),
      evaluateQueueFallbackAlerts(),
    ]);

    const clearCount = (calls: AlertPayload[]) =>
      calls.filter((c) => c.kind === "clear").length;
    expect(clearCount(pd.calls)).toBe(1);
    expect(clearCount(email.calls)).toBe(1);
    expect(clearCount(slack.calls)).toBe(1);

    const allResults = [...resultsA, ...resultsB];
    const clearsDelivered = allResults.filter(
      (r) => r.ok && !r.skipped,
    );
    expect(clearsDelivered).toHaveLength(3);
  });

  it("after one pod fires, a second pod that observes the same outage does not re-fire", async () => {
    await recordQueueFallback("email");
    await evaluateQueueFallbackAlerts(); // pod A's first evaluation — fires
    expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);

    // Pod B comes online and runs its first evaluation. It sees the same DB
    // events but the shared "alerting" flag in Redis is already true, so
    // the compareAndSet returns "no transition" and nothing is sent.
    const resultsB = await evaluateQueueFallbackAlerts();
    expect(resultsB).toHaveLength(0);
    expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
    expect(email.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
    expect(slack.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
  });
});
