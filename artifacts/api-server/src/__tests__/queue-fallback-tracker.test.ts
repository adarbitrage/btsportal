import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

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
          // Return rows that match the action_type filter; the where clause
          // built by getQueueFallbackStatsFromDb already includes the 24h
          // recency filter, but the in-memory store is small and we mirror
          // the prod filter here so the test exercises the bucketing logic.
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
  recordQueueFallback,
  getQueueFallbackStats,
  getQueueFallbackStatsFromDb,
  __resetQueueFallbackTrackerForTests,
} from "../lib/queue-fallback-tracker";

async function flushPersistence(): Promise<void> {
  // recordQueueFallback fires the DB write with `void persistFallback(...)`.
  // A microtask flush is enough because our mocked insert resolves on a
  // resolved promise.
  await Promise.resolve();
  await Promise.resolve();
}

describe("queue-fallback-tracker", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetQueueFallbackTrackerForTests();
    auditRows.length = 0;
    insertImpl = async (row) => {
      auditRows.push(row);
    };
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.useRealTimers();
  });

  it("records each fallback event with a structured log line", () => {
    recordQueueFallback("email", { recipient: "alice@example.com", reason: "queue_unavailable" });

    expect(logSpy).toHaveBeenCalled();
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain("[Comms][Fallback]");
    expect(line).toContain("channel=email");
    expect(line).toContain("recipient=alice@example.com");
    expect(line).toContain("reason=queue_unavailable");
  });

  it("counts fallbacks per channel and exposes them via getQueueFallbackStats", () => {
    recordQueueFallback("email");
    recordQueueFallback("email");
    recordQueueFallback("sms");

    const stats = getQueueFallbackStats();
    expect(stats.email.recentCount).toBe(2);
    expect(stats.email.hourCount).toBe(2);
    expect(stats.email.dayCount).toBe(2);
    expect(stats.sms.recentCount).toBe(1);
    expect(stats.alerting).toBe(true);
    expect(stats.email.lastAt).not.toBeNull();
    expect(stats.sms.lastAt).not.toBeNull();
  });

  it("emits an [ALERT] warning the first time a channel falls back", () => {
    recordQueueFallback("email");

    const alertCall = warnSpy.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].includes("[Comms][ALERT]"),
    );
    expect(alertCall).toBeDefined();
    expect(alertCall![0]).toContain("email");
  });

  it("throttles repeated alert warnings within the throttle window", () => {
    // 5 fallbacks in quick succession should produce exactly one ALERT.
    for (let i = 0; i < 5; i++) recordQueueFallback("email");

    const alertCalls = warnSpy.mock.calls.filter((c) =>
      typeof c[0] === "string" && c[0].includes("[Comms][ALERT]"),
    );
    expect(alertCalls).toHaveLength(1);
  });

  it("re-alerts after the throttle window passes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    recordQueueFallback("email");

    // Advance past both the recent window and the alert throttle (>5m).
    vi.setSystemTime(new Date("2026-01-01T00:06:00Z"));
    recordQueueFallback("email");

    const alertCalls = warnSpy.mock.calls.filter((c) =>
      typeof c[0] === "string" && c[0].includes("[Comms][ALERT]"),
    );
    expect(alertCalls).toHaveLength(2);
  });

  it("only reports alerting=true while events are inside the recent window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    recordQueueFallback("email");
    expect(getQueueFallbackStats().alerting).toBe(true);

    // Move 10 minutes ahead — the event should fall out of the recent window.
    vi.setSystemTime(new Date("2026-01-01T00:10:00Z"));
    const stats = getQueueFallbackStats();
    expect(stats.alerting).toBe(false);
    expect(stats.email.recentCount).toBe(0);
    // But it should still appear in the 1h and 24h counts.
    expect(stats.email.hourCount).toBe(1);
    expect(stats.email.dayCount).toBe(1);
  });

  it("prunes events older than 24 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    recordQueueFallback("email");

    vi.setSystemTime(new Date("2026-01-02T01:00:00Z"));
    const stats = getQueueFallbackStats();
    expect(stats.email.dayCount).toBe(0);
    expect(stats.email.recentCount).toBe(0);
  });

  it("tracks email and sms channels independently", () => {
    recordQueueFallback("email");
    recordQueueFallback("email");

    const stats = getQueueFallbackStats();
    expect(stats.email.recentCount).toBe(2);
    expect(stats.sms.recentCount).toBe(0);
    expect(stats.sms.lastAt).toBeNull();
  });

  describe("durable persistence", () => {
    it("writes a queue_fallback audit row for each fallback so history survives a restart", async () => {
      recordQueueFallback("email", { recipient: "alice@example.com", reason: "redis_not_ready" });
      recordQueueFallback("sms", { recipient: "+15551234567", reason: "queue_unavailable" });
      await flushPersistence();

      expect(auditRows).toHaveLength(2);
      const emailRow = auditRows.find((r) => r.entityId === "email");
      const smsRow = auditRows.find((r) => r.entityId === "sms");
      expect(emailRow).toBeDefined();
      expect(smsRow).toBeDefined();
      expect(emailRow!.actionType).toBe("queue_fallback");
      expect(emailRow!.entityType).toBe("queue");
      expect(emailRow!.metadata).toMatchObject({
        channel: "email",
        recipient: "alice@example.com",
        reason: "redis_not_ready",
      });
      expect(smsRow!.metadata).toMatchObject({ channel: "sms", recipient: "+15551234567" });
    });

    it("getQueueFallbackStatsFromDb reflects rows written by previous process lifetimes", async () => {
      // Simulate a previous server lifetime by seeding the DB directly,
      // then reset the in-memory tracker as if the process had restarted.
      const now = Date.now();
      auditRows.push(
        {
          actionType: "queue_fallback",
          entityType: "queue",
          entityId: "email",
          description: "x",
          metadata: { channel: "email" },
          createdAt: new Date(now - 90 * 60 * 1000), // 1.5h ago
        },
        {
          actionType: "queue_fallback",
          entityType: "queue",
          entityId: "email",
          description: "x",
          metadata: { channel: "email" },
          createdAt: new Date(now - 30 * 1000), // 30s ago
        },
        {
          actionType: "queue_fallback",
          entityType: "queue",
          entityId: "sms",
          description: "x",
          metadata: { channel: "sms" },
          createdAt: new Date(now - 10 * 60 * 1000), // 10m ago
        },
      );
      __resetQueueFallbackTrackerForTests();

      const stats = await getQueueFallbackStatsFromDb();
      expect(stats.email.dayCount).toBe(2);
      expect(stats.email.hourCount).toBe(1);
      expect(stats.email.recentCount).toBe(1);
      expect(stats.sms.dayCount).toBe(1);
      expect(stats.sms.hourCount).toBe(1);
      expect(stats.sms.recentCount).toBe(0);
      expect(stats.alerting).toBe(true);
      expect(stats.email.lastAt).not.toBeNull();
    });

    it("ignores audit rows whose entity_id is not a known channel", async () => {
      auditRows.push({
        actionType: "queue_fallback",
        entityType: "queue",
        entityId: "carrier-pigeon",
        description: "x",
        metadata: null,
        createdAt: new Date(),
      });

      const stats = await getQueueFallbackStatsFromDb();
      expect(stats.email.dayCount).toBe(0);
      expect(stats.sms.dayCount).toBe(0);
    });

    it("never blocks the send path on a DB write failure", async () => {
      insertImpl = async () => {
        throw new Error("connection refused");
      };

      // Should not throw — the fire-and-forget write must swallow errors.
      expect(() =>
        recordQueueFallback("email", { recipient: "x@example.com" }),
      ).not.toThrow();
      await flushPersistence();

      // The in-memory counter still reflects the event so the alert path
      // keeps firing even when persistence is broken.
      expect(getQueueFallbackStats().email.recentCount).toBe(1);
      expect(errorSpy).toHaveBeenCalled();
    });

    it("falls back to in-memory stats when the DB read fails", async () => {
      // Record an in-memory event first.
      recordQueueFallback("email");
      auditRows.length = 0;

      // Force the next select to throw by replacing the mocked db.select
      // behavior just for this test via vi.doMock is awkward; instead, make
      // insertImpl irrelevant and stub the query path through a thrown error
      // path. We achieve this by temporarily monkey-patching the auditRows
      // accessor to throw — easiest is to push a getter that throws.
      const originalPush = auditRows.push;
      Object.defineProperty(auditRows, "filter", {
        value: () => {
          throw new Error("db gone");
        },
        configurable: true,
      });

      try {
        const stats = await getQueueFallbackStatsFromDb();
        // In-memory tracker still has the event from before.
        expect(stats.email.recentCount).toBe(1);
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        Object.defineProperty(auditRows, "filter", {
          value: Array.prototype.filter,
          configurable: true,
        });
        auditRows.push = originalPush;
      }
    });
  });
});
