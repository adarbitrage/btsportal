import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { randomUUID } from "crypto";
import { db, auditLogTable } from "@workspace/db";
import { and, eq, gt, desc } from "drizzle-orm";
import {
  evaluateAuthRateLimitAlert,
  __resetAuthRateLimitAlerterForTests,
  __setAuthRateLimitAlerterDeliveriesForTests,
  AUTH_RATE_LIMIT_ALERT_ACTION_TYPE,
  AUTH_RATE_LIMIT_ALERT_ENTITY_TYPE,
  AUTH_RATE_LIMIT_ALERT_ENTITY_ID,
  type DeliveryResult,
} from "../lib/auth-rate-limit-alerter";
import { AUTH_RATE_LIMIT_AUDIT_ACTION } from "../routes/auth";

const TAG = `arl-alert-audit-${randomUUID().slice(0, 8)}`;
let baselineAuditId = 0;

beforeAll(async () => {
  const [maxRow] = await db
    .select({ id: auditLogTable.id })
    .from(auditLogTable)
    .orderBy(desc(auditLogTable.id))
    .limit(1);
  baselineAuditId = maxRow?.id ?? 0;
});

async function clearAlertRows() {
  await db
    .delete(auditLogTable)
    .where(
      and(
        gt(auditLogTable.id, baselineAuditId),
        eq(auditLogTable.actionType, AUTH_RATE_LIMIT_ALERT_ACTION_TYPE),
      ),
    );
}

// The alerter computes "currently bursting?" off of `auth_rate_limit_blocked`
// rows in the audit table. Wipe them between tests so each test sees a
// deterministic count and prior tests don't leak into transition decisions.
// Tracker rows are owned end-to-end by tests in this suite, so a wholesale
// delete (limited to recent rows) is safe.
async function clearRateLimitHits() {
  await db
    .delete(auditLogTable)
    .where(eq(auditLogTable.actionType, AUTH_RATE_LIMIT_AUDIT_ACTION));
}

async function insertHit(opts: { ip: string | null; minutesAgo?: number }) {
  await db.insert(auditLogTable).values({
    actorId: null,
    actorEmail: null,
    actionType: AUTH_RATE_LIMIT_AUDIT_ACTION,
    entityType: "auth_rate_limit",
    entityId: "login",
    description: `[${TAG}] simulated rate-limit hit`,
    ipAddress: opts.ip,
    metadata: { source: TAG },
    createdAt: new Date(Date.now() - (opts.minutesAgo ?? 0) * 60 * 1000),
  });
}

async function fetchAlertRows() {
  return db
    .select()
    .from(auditLogTable)
    .where(
      and(
        gt(auditLogTable.id, baselineAuditId),
        eq(auditLogTable.actionType, AUTH_RATE_LIMIT_ALERT_ACTION_TYPE),
      ),
    )
    .orderBy(desc(auditLogTable.id));
}

afterAll(async () => {
  await clearAlertRows();
  await clearRateLimitHits();
});

beforeEach(async () => {
  __resetAuthRateLimitAlerterForTests();
  await clearAlertRows();
  await clearRateLimitHits();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  __setAuthRateLimitAlerterDeliveriesForTests(null);
  vi.restoreAllMocks();
});

describe("auth-rate-limit-alerter writes audit rows for delivery attempts", () => {
  it("records one row per delivery channel on a fire transition", async () => {
    __setAuthRateLimitAlerterDeliveriesForTests({
      pagerduty: async (): Promise<DeliveryResult> => ({
        channel: "pagerduty",
        ok: true,
      }),
      email: async (): Promise<DeliveryResult> => ({ channel: "email", ok: true }),
      slack: async (): Promise<DeliveryResult> => ({ channel: "slack", ok: true }),
    });

    for (let i = 0; i < 12; i++) {
      await insertHit({ ip: "203.0.113.7", minutesAgo: 1 });
    }
    await evaluateAuthRateLimitAlert();

    const rows = await fetchAlertRows();
    expect(rows).toHaveLength(3);

    for (const row of rows) {
      expect(row.entityType).toBe(AUTH_RATE_LIMIT_ALERT_ENTITY_TYPE);
      expect(row.entityId).toBe(AUTH_RATE_LIMIT_ALERT_ENTITY_ID);
      const meta = row.metadata as Record<string, unknown>;
      expect(meta.kind).toBe("fire");
      expect(meta.outcome).toBe("sent");
      expect(meta.total).toBe(12);
      expect(meta.dominantIp).toBe("203.0.113.7");
      expect(meta.dominantCount).toBe(12);
    }

    const channels = rows
      .map((r) => (r.metadata as Record<string, unknown>).deliveryChannel)
      .sort();
    expect(channels).toEqual(["email", "pagerduty", "slack"]);
  });

  it("records skipped/failed/sent outcomes distinctly so admins can filter on them", async () => {
    __setAuthRateLimitAlerterDeliveriesForTests({
      pagerduty: async (): Promise<DeliveryResult> => ({
        channel: "pagerduty",
        ok: true,
        skipped: true,
        reason: "not_configured",
      }),
      email: async (): Promise<DeliveryResult> => ({
        channel: "email",
        ok: false,
        reason: "http_500",
      }),
      slack: async (): Promise<DeliveryResult> => ({ channel: "slack", ok: true }),
    });

    for (let i = 0; i < 12; i++) {
      await insertHit({ ip: "203.0.113.7", minutesAgo: 2 });
    }
    await evaluateAuthRateLimitAlert();

    const rows = await fetchAlertRows();
    expect(rows).toHaveLength(3);

    const byChannel = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const meta = row.metadata as Record<string, unknown>;
      byChannel.set(String(meta.deliveryChannel), meta);
    }

    expect(byChannel.get("pagerduty")?.outcome).toBe("skipped");
    expect(byChannel.get("pagerduty")?.reason).toBe("not_configured");

    expect(byChannel.get("email")?.outcome).toBe("failed");
    expect(byChannel.get("email")?.reason).toBe("http_500");

    expect(byChannel.get("slack")?.outcome).toBe("sent");
  });

  it("records 'throttled' outcomes when a re-fire is suppressed by the per-delivery throttle", async () => {
    const prevThrottle = process.env.AUTH_RATE_LIMIT_NOTIFICATION_THROTTLE_MS;
    process.env.AUTH_RATE_LIMIT_NOTIFICATION_THROTTLE_MS = String(
      24 * 60 * 60 * 1000,
    );
    try {
      __setAuthRateLimitAlerterDeliveriesForTests({
        pagerduty: async (): Promise<DeliveryResult> => ({
          channel: "pagerduty",
          ok: true,
        }),
        email: async (): Promise<DeliveryResult> => ({ channel: "email", ok: true }),
        slack: async (): Promise<DeliveryResult> => ({ channel: "slack", ok: true }),
      });

      // First fire.
      for (let i = 0; i < 12; i++) {
        await insertHit({ ip: "203.0.113.7", minutesAgo: 1 });
      }
      await evaluateAuthRateLimitAlert();

      // Recover and immediately re-burst.
      await clearRateLimitHits();
      await evaluateAuthRateLimitAlert();
      for (let i = 0; i < 12; i++) {
        await insertHit({ ip: "203.0.113.7", minutesAgo: 1 });
      }
      await evaluateAuthRateLimitAlert();

      const rows = await fetchAlertRows();
      // 3 fire (initial) + 3 clear (recover) + 3 throttled (re-fire) = 9
      expect(rows).toHaveLength(9);

      const fireOutcomes = rows
        .filter((r) => (r.metadata as Record<string, unknown>).kind === "fire")
        .map((r) => (r.metadata as Record<string, unknown>).outcome)
        .sort();
      expect(fireOutcomes).toEqual([
        "sent",
        "sent",
        "sent",
        "throttled",
        "throttled",
        "throttled",
      ]);

      const throttledRow = rows.find(
        (r) =>
          (r.metadata as Record<string, unknown>).outcome === "throttled" &&
          (r.metadata as Record<string, unknown>).deliveryChannel === "pagerduty",
      );
      expect(throttledRow).toBeDefined();
      expect(throttledRow!.description).toMatch(
        /Throttled fire alert via pagerduty for auth rate-limit burst/,
      );
      expect(
        (throttledRow!.metadata as Record<string, unknown>).reason,
      ).toBe("throttled");
    } finally {
      if (prevThrottle === undefined) {
        delete process.env.AUTH_RATE_LIMIT_NOTIFICATION_THROTTLE_MS;
      } else {
        process.env.AUTH_RATE_LIMIT_NOTIFICATION_THROTTLE_MS = prevThrottle;
      }
    }
  });

  it("records clear-transition deliveries so admins can confirm a resolve fired", async () => {
    __setAuthRateLimitAlerterDeliveriesForTests({
      pagerduty: async (): Promise<DeliveryResult> => ({
        channel: "pagerduty",
        ok: true,
      }),
      email: async (): Promise<DeliveryResult> => ({ channel: "email", ok: true }),
      slack: async (): Promise<DeliveryResult> => ({ channel: "slack", ok: true }),
    });

    for (let i = 0; i < 12; i++) {
      await insertHit({ ip: "203.0.113.7", minutesAgo: 2 });
    }
    await evaluateAuthRateLimitAlert();

    await clearRateLimitHits();
    await evaluateAuthRateLimitAlert();

    const rows = await fetchAlertRows();
    const clearRows = rows.filter(
      (r) => (r.metadata as Record<string, unknown>).kind === "clear",
    );
    expect(clearRows).toHaveLength(3);
    for (const row of clearRows) {
      expect(row.entityId).toBe(AUTH_RATE_LIMIT_ALERT_ENTITY_ID);
      expect((row.metadata as Record<string, unknown>).outcome).toBe("sent");
      expect(row.description).toMatch(
        /Sent clear alert via .* for auth rate-limit burst/,
      );
    }
  });
});
