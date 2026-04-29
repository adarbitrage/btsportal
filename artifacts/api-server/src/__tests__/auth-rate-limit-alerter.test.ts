import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

interface FakeAuditRow {
  actionType: string;
  entityType: string | null;
  entityId: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: Date;
}

const auditRows: FakeAuditRow[] = [];
let insertImpl: (row: FakeAuditRow) => Promise<void> = async (row) => {
  auditRows.push(row);
};

// The alerter reads `auth_rate_limit_blocked` rows directly from
// auditLogTable to compute its burst stats. Mock @workspace/db so the
// alerter unit tests don't touch the real DB and don't leak rows between
// tests. We model the minimum surface the alerter and audit-log helper use:
//   - `db.insert(table).values(row)` for `logAuditEvent`
//   - `db.select(...).from(table).where(cond).groupBy(col)` for the burst
//     stats query
const ALERT_WINDOW_MS_DEFAULT = 15 * 60 * 1000;

vi.mock("@workspace/db", () => {
  const ipColumn = { name: "ip_address" };
  const auditLogTable = {
    actionType: { name: "action_type" },
    entityType: { name: "entity_type" },
    entityId: { name: "entity_id" },
    ipAddress: ipColumn,
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
        where: (_condition: unknown) => ({
          groupBy: async (_col: unknown) => {
            // Honor the live `mockConfig.windowMinutes` so tests that
            // narrow the window (e.g. to 5m) actually exclude rows that
            // fall outside it. The real Drizzle query uses the WHERE
            // clause's `>= since` predicate; this mock recreates that
            // by recomputing the cutoff from the same source the alerter
            // just used.
            const cutoff = Date.now() - mockConfig.windowMinutes * 60_000;
            const matching = auditRows.filter(
              (r) =>
                r.actionType === "auth_rate_limit_blocked" &&
                r.createdAt.getTime() >= cutoff,
            );
            const groups = new Map<string | null, number>();
            for (const row of matching) {
              groups.set(row.ipAddress, (groups.get(row.ipAddress) ?? 0) + 1);
            }
            return Array.from(groups.entries()).map(([ip, count]) => ({
              ip,
              count,
            }));
          },
        }),
      }),
    }),
  };

  return { db, auditLogTable };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (a: unknown, b: unknown) => ({ _eq: [a, b] }),
  gte: (a: unknown, b: unknown) => ({ _gte: [a, b] }),
  sql: (strings: TemplateStringsArray, ..._values: unknown[]) =>
    ({ _sql: strings.join("?") }) as unknown,
}));

// Ensure on-call destinations always look "not configured" in unit tests so
// the real default deliveries can run as a safety net (we override them via
// the test hook regardless, but this keeps the dependency well-behaved).
vi.mock("../lib/oncall-settings", () => ({
  getOnCallDestinations: async () => ({
    pagerdutyIntegrationKey: null,
    opsAlertEmail: null,
    opsAlertSlackWebhookUrl: null,
  }),
}));

// Mock the alert-settings module so the alerter's per-evaluation config read
// is deterministic in unit tests (the real module hits the DB). The
// `mockConfig` object is reset in beforeEach and individual tests can mutate
// fields to verify the alerter respects the live admin-tunable settings.
// `vi.hoisted` is required because `vi.mock` factories are hoisted above
// top-level `const` declarations — without hoisting `mockConfig` itself the
// factory would TDZ-throw at evaluation time.
const { mockConfig, DEFAULT_MOCK_CONFIG } = vi.hoisted(() => {
  const DEFAULT_MOCK_CONFIG = {
    threshold: 10,
    windowMinutes: 15,
    dominantIpRatio: 0.6,
  };
  return { mockConfig: { ...DEFAULT_MOCK_CONFIG }, DEFAULT_MOCK_CONFIG };
});
vi.mock("../lib/auth-rate-limit-alert-settings", () => ({
  getAuthRateLimitAlertConfig: async () => ({ ...mockConfig }),
  AUTH_RATE_LIMIT_ALERT_DEFAULTS: { ...DEFAULT_MOCK_CONFIG },
}));

import {
  evaluateAuthRateLimitAlert,
  __resetAuthRateLimitAlerterForTests,
  __setAuthRateLimitAlerterDeliveriesForTests,
  __getAuthRateLimitAlerterStateForTests,
  type AuthRateLimitAlertPayload,
  type DeliveryResult,
} from "../lib/auth-rate-limit-alerter";

interface StubDelivery {
  fn: (p: AuthRateLimitAlertPayload) => Promise<DeliveryResult>;
  calls: AuthRateLimitAlertPayload[];
}

function makeStub(channel: "pagerduty" | "email" | "slack"): StubDelivery {
  const calls: AuthRateLimitAlertPayload[] = [];
  const fn = vi.fn(
    async (p: AuthRateLimitAlertPayload): Promise<DeliveryResult> => {
      calls.push(p);
      return { channel, ok: true };
    },
  );
  return { fn, calls };
}

function pushHits(
  count: number,
  opts: { ip?: string | null; ageMinutes?: number } = {},
): void {
  const ageMinutes = opts.ageMinutes ?? 1;
  const ip = opts.ip ?? null;
  for (let i = 0; i < count; i++) {
    auditRows.push({
      actionType: "auth_rate_limit_blocked",
      entityType: "auth_rate_limit",
      entityId: "login",
      description: "stub",
      metadata: null,
      ipAddress: ip,
      createdAt: new Date(Date.now() - ageMinutes * 60_000),
    });
  }
}

describe("auth-rate-limit-alerter", () => {
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
    Object.assign(mockConfig, DEFAULT_MOCK_CONFIG);
    __resetAuthRateLimitAlerterForTests();
    pd = makeStub("pagerduty");
    email = makeStub("email");
    slack = makeStub("slack");
    __setAuthRateLimitAlerterDeliveriesForTests({
      pagerduty: pd.fn,
      email: email.fn,
      slack: slack.fn,
    });
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    __setAuthRateLimitAlerterDeliveriesForTests(null);
    warnSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.useRealTimers();
  });

  it("does not page on-call when activity is below the threshold", async () => {
    pushHits(5, { ip: "10.0.0.1" });

    const result = await evaluateAuthRateLimitAlert();

    expect(result.stats.total).toBe(5);
    expect(result.stats.alerting).toBe(false);
    expect(result.deliveries).toEqual([]);
    expect(pd.calls).toHaveLength(0);
    expect(email.calls).toHaveLength(0);
    expect(slack.calls).toHaveLength(0);
  });

  it("fires on every channel when the threshold is crossed and reports the dominant IP", async () => {
    pushHits(12, { ip: "203.0.113.7" });

    const result = await evaluateAuthRateLimitAlert();

    expect(result.stats.alerting).toBe(true);
    expect(result.stats.total).toBe(12);
    expect(result.stats.dominantIp).toBe("203.0.113.7");
    expect(result.stats.dominantCount).toBe(12);
    expect(result.stats.dominantShare).toBe(1);

    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].kind).toBe("fire");
    expect(pd.calls[0].stats.total).toBe(12);
    expect(email.calls).toHaveLength(1);
    expect(email.calls[0].kind).toBe("fire");
    expect(slack.calls).toHaveLength(1);
    expect(slack.calls[0].kind).toBe("fire");
  });

  it("does not re-fire while the burst stays above the threshold", async () => {
    pushHits(12, { ip: "203.0.113.7" });
    await evaluateAuthRateLimitAlert();
    expect(pd.calls).toHaveLength(1);

    pushHits(3, { ip: "203.0.113.7" });
    await evaluateAuthRateLimitAlert();
    await evaluateAuthRateLimitAlert();
    expect(pd.calls).toHaveLength(1);
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });

  it("sends an 'all clear' when the burst recovers below threshold", async () => {
    pushHits(12, { ip: "203.0.113.7" });
    await evaluateAuthRateLimitAlert();
    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].kind).toBe("fire");

    // Burst ends — wipe the rows that fed the burst.
    auditRows.length = 0;
    await evaluateAuthRateLimitAlert();

    expect(pd.calls).toHaveLength(2);
    expect(pd.calls[1].kind).toBe("clear");
    expect(email.calls[1].kind).toBe("clear");
    expect(slack.calls[1].kind).toBe("clear");
    expect(__getAuthRateLimitAlerterStateForTests()).toBe(false);
  });

  it("re-fires after a recovery once a new burst transitions in", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    pushHits(12, { ip: "203.0.113.7" });
    await evaluateAuthRateLimitAlert();

    // Recover.
    auditRows.length = 0;
    await evaluateAuthRateLimitAlert();

    // Wait past the per-delivery throttle window before the next burst.
    vi.setSystemTime(new Date("2026-01-01T02:00:00Z"));
    pushHits(15, { ip: "203.0.113.7" });
    await evaluateAuthRateLimitAlert();

    const fires = pd.calls.filter((c) => c.kind === "fire");
    const clears = pd.calls.filter((c) => c.kind === "clear");
    expect(fires).toHaveLength(2);
    expect(clears).toHaveLength(1);
  });

  it("throttles a re-fire that happens within the per-delivery throttle window", async () => {
    const prev = process.env.AUTH_RATE_LIMIT_NOTIFICATION_THROTTLE_MS;
    process.env.AUTH_RATE_LIMIT_NOTIFICATION_THROTTLE_MS = String(
      24 * 60 * 60 * 1000,
    );
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

      pushHits(12, { ip: "203.0.113.7" });
      await evaluateAuthRateLimitAlert();
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);

      // Recover.
      auditRows.length = 0;
      await evaluateAuthRateLimitAlert();

      // New burst 5m later — well inside the 24h throttle window.
      vi.setSystemTime(new Date("2026-01-01T00:05:00Z"));
      pushHits(20, { ip: "203.0.113.7" });
      const evaluation = await evaluateAuthRateLimitAlert();

      // No NEW fire delivery on any channel.
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
      expect(email.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
      expect(slack.calls.filter((c) => c.kind === "fire")).toHaveLength(1);

      const throttled = evaluation.deliveries.filter(
        (r) => r.skipped && r.reason === "throttled",
      );
      expect(throttled).toHaveLength(3);
    } finally {
      if (prev === undefined) {
        delete process.env.AUTH_RATE_LIMIT_NOTIFICATION_THROTTLE_MS;
      } else {
        process.env.AUTH_RATE_LIMIT_NOTIFICATION_THROTTLE_MS = prev;
      }
    }
  });

  it("omits the dominant-IP suffix when the burst is spread across many IPs", async () => {
    for (let i = 0; i < 12; i++) {
      pushHits(1, { ip: `198.51.100.${i + 1}` });
    }

    const result = await evaluateAuthRateLimitAlert();

    expect(result.stats.alerting).toBe(true);
    // No single IP has ≥60% share, so dominantShare is well below the
    // dominant-IP threshold.
    expect(result.stats.dominantShare).toBeLessThan(0.6);
  });

  it("does not let a single delivery failure block other deliveries", async () => {
    __setAuthRateLimitAlerterDeliveriesForTests({
      pagerduty: async () => {
        throw new Error("pd boom");
      },
      email: email.fn,
      slack: slack.fn,
    });

    pushHits(12, { ip: "203.0.113.7" });
    const evaluation = await evaluateAuthRateLimitAlert();

    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
    const pdResult = evaluation.deliveries.find(
      (r) => r.channel === "pagerduty",
    );
    expect(pdResult?.ok).toBe(false);
    expect(pdResult?.reason).toContain("pd boom");
  });

  it("does not double-fire when two evaluations race on the same first-time burst", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let pdInflight = 0;
    let pdMaxInflight = 0;
    __setAuthRateLimitAlerterDeliveriesForTests({
      pagerduty: async (_p) => {
        pdInflight += 1;
        pdMaxInflight = Math.max(pdMaxInflight, pdInflight);
        await gate;
        pdInflight -= 1;
        return { channel: "pagerduty", ok: true };
      },
      email: email.fn,
      slack: slack.fn,
    });

    pushHits(12, { ip: "203.0.113.7" });
    const a = evaluateAuthRateLimitAlert();
    const b = evaluateAuthRateLimitAlert();
    release();
    const [resA, resB] = await Promise.all([a, b]);

    // Exactly one of the two evaluations actually dispatched.
    const dispatched = [resA, resB].filter((r) => r.deliveries.length > 0);
    expect(dispatched).toHaveLength(1);
    expect(pdMaxInflight).toBe(1);
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });

  it("treats unconfigured providers as skipped without consuming the throttle slot", async () => {
    __setAuthRateLimitAlerterDeliveriesForTests({
      pagerduty: async () => ({
        channel: "pagerduty",
        ok: true,
        skipped: true,
        reason: "not_configured",
      }),
      email: email.fn,
      slack: slack.fn,
    });

    pushHits(12, { ip: "203.0.113.7" });
    const evaluation = await evaluateAuthRateLimitAlert();

    const pd1 = evaluation.deliveries.find((r) => r.channel === "pagerduty");
    expect(pd1?.skipped).toBe(true);
    expect(pd1?.reason).toBe("not_configured");
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });

  it("respects threshold overrides set in admin Settings", async () => {
    mockConfig.threshold = 3;
    pushHits(3, { ip: "203.0.113.7" });
    const result = await evaluateAuthRateLimitAlert();
    expect(result.stats.threshold).toBe(3);
    expect(result.stats.alerting).toBe(true);
    expect(pd.calls).toHaveLength(1);
  });

  it("respects window-length overrides set in admin Settings", async () => {
    mockConfig.windowMinutes = 5;
    // Hit 7m ago — outside the new 5m window — should NOT count.
    pushHits(20, { ip: "203.0.113.7", ageMinutes: 7 });
    const result = await evaluateAuthRateLimitAlert();
    expect(result.stats.windowMs).toBe(5 * 60 * 1000);
    expect(result.stats.total).toBe(0);
    expect(result.stats.alerting).toBe(false);
    expect(pd.calls).toHaveLength(0);
  });

  it("respects dominant-IP-ratio overrides set in admin Settings", async () => {
    // Lower the ratio so a smaller share is enough to call out the IP.
    mockConfig.dominantIpRatio = 0.2;
    pushHits(8, { ip: "203.0.113.7" });
    pushHits(7, { ip: "198.51.100.1" });
    const result = await evaluateAuthRateLimitAlert();
    expect(result.stats.alerting).toBe(true);
    expect(result.stats.dominantIpRatio).toBe(0.2);
    // The IP-suffix decision now uses the lowered ratio, so the dispatch
    // payload's dominant IP must be present.
    expect(pd.calls[0].stats.dominantIp).toBe("203.0.113.7");
  });

  it("does NOT auto-resolve an active incident when the burst-stats query fails", async () => {
    // First, fire a real burst so the alerter's in-memory state is "alerting".
    pushHits(12, { ip: "203.0.113.7" });
    await evaluateAuthRateLimitAlert();
    expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
    expect(__getAuthRateLimitAlerterStateForTests()).toBe(true);

    // Now simulate a transient DB outage on the burst-stats query.
    // The mocked db.select() lives in the vi.mock above, so we monkey-patch
    // the underlying audit row store with a getter that throws when iterated
    // — that's the only path computeBurstStats touches.
    const originalRows = auditRows.slice();
    auditRows.length = 0;
    const sentinel = new Error("simulated db outage");
    Object.defineProperty(auditRows, "filter", {
      configurable: true,
      value: () => {
        throw sentinel;
      },
    });

    let evaluation;
    try {
      evaluation = await evaluateAuthRateLimitAlert();
    } finally {
      // Restore the array prototype filter so subsequent tests don't break.
      delete (auditRows as unknown as { filter?: unknown }).filter;
      auditRows.push(...originalRows);
    }

    // Stats are flagged unavailable, no transitions fired, prior state preserved.
    expect(evaluation.stats.statsAvailable).toBe(false);
    expect(evaluation.stats.alerting).toBe(false);
    expect(evaluation.deliveries).toEqual([]);
    expect(__getAuthRateLimitAlerterStateForTests()).toBe(true);

    // Crucially: NO clear delivery was sent on any channel.
    expect(pd.calls.filter((c) => c.kind === "clear")).toHaveLength(0);
    expect(email.calls.filter((c) => c.kind === "clear")).toHaveLength(0);
    expect(slack.calls.filter((c) => c.kind === "clear")).toHaveLength(0);
  });
});
