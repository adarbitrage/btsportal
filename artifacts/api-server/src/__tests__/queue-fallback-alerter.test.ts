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
let insertImpl: (row: FakeAuditRow) => Promise<void> = async (row) => {
  auditRows.push(row);
};

// The alerter now reads from `getQueueFallbackStatsFromDb` (so all api-server
// instances see the same cluster-wide truth), which goes through @workspace/db.
// Mock the DB module so the alerter tests don't touch the real DB and don't
// leak rows between tests.
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
        await insertImpl(row);
      },
    }),
    select: (_cols: unknown) => ({
      from: (_table: unknown) => ({
        where: async (_condition: unknown) => {
          const cutoff = Date.now() - 24 * 60 * 60 * 1000;
          return auditRows
            .filter((r) => r.actionType === "queue_fallback" && r.createdAt.getTime() >= cutoff)
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

import {
  evaluateQueueFallbackAlerts,
  startQueueFallbackAlerter,
  stopQueueFallbackAlerter,
  __resetQueueFallbackAlerterForTests,
  __setQueueFallbackAlerterDeliveriesForTests,
  type AlertPayload,
  type DeliveryResult,
} from "../lib/queue-fallback-alerter";
import {
  recordQueueFallback,
  __resetQueueFallbackTrackerForTests,
} from "../lib/queue-fallback-tracker";

interface StubDelivery {
  fn: (p: AlertPayload) => Promise<DeliveryResult>;
  calls: AlertPayload[];
}

function makeStub(channel: "pagerduty" | "email" | "slack"): StubDelivery {
  const calls: AlertPayload[] = [];
  const fn = vi.fn(async (p: AlertPayload): Promise<DeliveryResult> => {
    calls.push(p);
    return { channel, ok: true };
  });
  return { fn, calls };
}

/**
 * The listener-driven path is fire-and-forget: it kicks off
 * `evaluateQueueFallbackAlerts()` without awaiting. With the new
 * implementation that read goes through an async DB query, so a single
 * `setImmediate` flush isn't enough to settle every microtask. Spin a few
 * macrotask flips so the chained promises resolve.
 */
async function flushListenerEvaluation(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

describe("queue-fallback-alerter", () => {
  let pd: StubDelivery;
  let email: StubDelivery;
  let slack: StubDelivery;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    auditRows.length = 0;
    insertImpl = async (row) => {
      auditRows.push(row);
    };
    __resetQueueFallbackTrackerForTests();
    __resetQueueFallbackAlerterForTests();
    pd = makeStub("pagerduty");
    email = makeStub("email");
    slack = makeStub("slack");
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
    stopQueueFallbackAlerter();
    __setQueueFallbackAlerterDeliveriesForTests(null);
    warnSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.useRealTimers();
  });

  it("fires a 'fire' alert on all delivery channels when a queue starts bypassing Redis", async () => {
    recordQueueFallback("email", { recipient: "a@b.com", reason: "queue_unavailable" });

    await evaluateQueueFallbackAlerts();

    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].kind).toBe("fire");
    expect(pd.calls[0].queueChannel).toBe("email");
    expect(pd.calls[0].stats.email.recentCount).toBe(1);
    expect(email.calls).toHaveLength(1);
    expect(email.calls[0].kind).toBe("fire");
    expect(slack.calls).toHaveLength(1);
    expect(slack.calls[0].kind).toBe("fire");
  });

  it("does not re-fire while the channel stays in alerting state", async () => {
    recordQueueFallback("email");
    await evaluateQueueFallbackAlerts();
    expect(pd.calls).toHaveLength(1);

    // Another fallback recorded — still alerting, no second fire.
    recordQueueFallback("email");
    await evaluateQueueFallbackAlerts();
    expect(pd.calls).toHaveLength(1);
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });

  it("sends an 'all clear' alert when the recent window empties", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    recordQueueFallback("email");
    await evaluateQueueFallbackAlerts();
    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].kind).toBe("fire");

    // Advance past the recent window (default 5m) so the event ages out.
    vi.setSystemTime(new Date("2026-01-01T00:10:00Z"));
    await evaluateQueueFallbackAlerts();

    expect(pd.calls).toHaveLength(2);
    expect(pd.calls[1].kind).toBe("clear");
    expect(email.calls[1].kind).toBe("clear");
    expect(slack.calls[1].kind).toBe("clear");
  });

  it("re-fires after recovery, then a new outage", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    recordQueueFallback("email");
    await evaluateQueueFallbackAlerts();

    // Recover.
    vi.setSystemTime(new Date("2026-01-01T00:10:00Z"));
    await evaluateQueueFallbackAlerts();

    // Wait past the per-delivery throttle window before the next outage.
    vi.setSystemTime(new Date("2026-01-01T00:20:00Z"));
    recordQueueFallback("email");
    await evaluateQueueFallbackAlerts();

    const fires = pd.calls.filter((c) => c.kind === "fire");
    const clears = pd.calls.filter((c) => c.kind === "clear");
    expect(fires).toHaveLength(2);
    expect(clears).toHaveLength(1);
  });

  it("tracks email and sms queues independently", async () => {
    recordQueueFallback("email");
    await evaluateQueueFallbackAlerts();
    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].queueChannel).toBe("email");

    recordQueueFallback("sms");
    await evaluateQueueFallbackAlerts();
    expect(pd.calls).toHaveLength(2);
    expect(pd.calls[1].queueChannel).toBe("sms");
    expect(pd.calls[1].kind).toBe("fire");
  });

  it("throttles a re-fire that happens within the per-delivery throttle window", async () => {
    // Set the throttle high enough that a fast recover-then-refire flap
    // lands inside the throttle window. The recent-fallback window is 5m,
    // so a clean recover is at least ~5m after the last event; setting
    // throttle to 60m guarantees the next fire is throttled.
    const prevThrottle = process.env.QUEUE_FALLBACK_NOTIFICATION_THROTTLE_MS;
    process.env.QUEUE_FALLBACK_NOTIFICATION_THROTTLE_MS = String(60 * 60 * 1000);
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

      recordQueueFallback("email");
      await evaluateQueueFallbackAlerts();
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);

      // Recover (event ages out of the 5-minute recent window).
      vi.setSystemTime(new Date("2026-01-01T00:10:00Z"));
      await evaluateQueueFallbackAlerts();

      // New outage 11 minutes after the first fire — well inside the 60m
      // throttle window. Transition still happens, but every delivery
      // channel reports "throttled" instead of sending.
      vi.setSystemTime(new Date("2026-01-01T00:11:00Z"));
      recordQueueFallback("email");
      const results = await evaluateQueueFallbackAlerts();

      // No NEW fire delivery on any channel.
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
      expect(email.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
      expect(slack.calls.filter((c) => c.kind === "fire")).toHaveLength(1);

      // And every delivery in this evaluation reports it was throttled.
      const fireResults = results.filter(
        (r) => r.skipped && r.reason === "throttled",
      );
      expect(fireResults).toHaveLength(3);
    } finally {
      if (prevThrottle === undefined) delete process.env.QUEUE_FALLBACK_NOTIFICATION_THROTTLE_MS;
      else process.env.QUEUE_FALLBACK_NOTIFICATION_THROTTLE_MS = prevThrottle;
    }
  });

  it("does not let a single delivery failure block other deliveries", async () => {
    __setQueueFallbackAlerterDeliveriesForTests({
      pagerduty: async () => {
        throw new Error("pd boom");
      },
      email: email.fn,
      slack: slack.fn,
    });

    recordQueueFallback("email");
    const results = await evaluateQueueFallbackAlerts();

    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
    const pdResult = results.find((r) => r.channel === "pagerduty");
    expect(pdResult?.ok).toBe(false);
    expect(pdResult?.reason).toContain("pd boom");
  });

  it("treats unconfigured providers as skipped (no throttle slot consumed)", async () => {
    __setQueueFallbackAlerterDeliveriesForTests({
      pagerduty: async () => ({ channel: "pagerduty", ok: true, skipped: true, reason: "not_configured" }),
      email: email.fn,
      slack: slack.fn,
    });

    recordQueueFallback("email");
    const r1 = await evaluateQueueFallbackAlerts();
    const pd1 = r1.find((r) => r.channel === "pagerduty");
    expect(pd1?.skipped).toBe(true);
    expect(pd1?.reason).toBe("not_configured");

    // Email channel was successfully sent to.
    expect(email.calls).toHaveLength(1);
  });

  it("auto-evaluates on tracker events once start() has wired the listener", async () => {
    startQueueFallbackAlerter();
    recordQueueFallback("email");
    await flushListenerEvaluation();
    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].kind).toBe("fire");
  });

  it("start() is idempotent and stop() removes the listener", async () => {
    startQueueFallbackAlerter();
    startQueueFallbackAlerter();

    recordQueueFallback("email");
    await flushListenerEvaluation();
    expect(pd.calls).toHaveLength(1);

    stopQueueFallbackAlerter();
    __resetQueueFallbackAlerterForTests();
    pd = makeStub("pagerduty");
    email = makeStub("email");
    slack = makeStub("slack");
    __setQueueFallbackAlerterDeliveriesForTests({
      pagerduty: pd.fn,
      email: email.fn,
      slack: slack.fn,
    });

    recordQueueFallback("email");
    await flushListenerEvaluation();
    // Listener is detached, so no auto-dispatch.
    expect(pd.calls).toHaveLength(0);
  });
});
