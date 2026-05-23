import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

interface FakeAuditRow {
  actionType: string;
  entityType: string | null;
  entityId: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

interface FakeMismatchRow {
  externalOrderId: string;
  grantedSlugs: string[] | null;
  portalProductKeys: unknown;
  mostRecentPurchasedAt: Date | null;
}

const auditRows: FakeAuditRow[] = [];
// Controllable rows the mocked `db.select(...).from(userProductsTable)`
// chain returns. Tests mutate this to drive how many mismatched orders the
// alerter sees per evaluation.
let mismatchRows: FakeMismatchRow[] = [];
// Flip true in tests that exercise the "transient DB outage" branch — the
// mocked chain throws on `.orderBy(...)` so the alerter falls into its
// statsAvailable=false fallback.
let mismatchQueryShouldThrow = false;

vi.mock("@workspace/db", () => {
  // Drizzle's chain returns objects with the next-step methods. We only
  // implement the methods this alerter actually calls — anything else
  // would silently `undefined.method()` which is a useful failure signal.
  const select = (_cols: unknown) => ({
    from: (_table: unknown) => ({
      innerJoin: (_t: unknown, _on: unknown) => ({
        leftJoin: (_t2: unknown, _on2: unknown) => ({
          where: (_cond: unknown) => ({
            groupBy: (_col: unknown) => ({
              orderBy: async (_o: unknown) => {
                if (mismatchQueryShouldThrow) {
                  throw new Error("simulated DB outage");
                }
                return mismatchRows;
              },
            }),
          }),
        }),
      }),
    }),
  });

  const db = {
    insert: (_table: unknown) => ({
      values: async (row: FakeAuditRow) => {
        auditRows.push(row);
      },
    }),
    select,
  };

  return {
    db,
    userProductsTable: { externalOrderId: { name: "external_order_id" }, externalSource: { name: "external_source" }, purchasedAt: { name: "purchased_at" }, productId: { name: "product_id" } },
    productsTable: { id: { name: "id" }, slug: { name: "slug" } },
    webhookLogsTable: { externalId: { name: "external_id" }, payload: { name: "payload" } },
    auditLogTable: {
      actionType: { name: "action_type" },
      entityType: { name: "entity_type" },
      entityId: { name: "entity_id" },
      description: { name: "description" },
      metadata: { name: "metadata" },
      createdAt: { name: "created_at" },
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  desc: (a: unknown) => ({ _desc: a }),
  eq: (a: unknown, b: unknown) => ({ _eq: [a, b] }),
  gte: (a: unknown, b: unknown) => ({ _gte: [a, b] }),
  isNotNull: (a: unknown) => ({ _isNotNull: a }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ..._values: unknown[]) =>
      ({ _sql: strings.join("?") }) as unknown,
    {},
  ),
}));

// Keep the on-call destinations dependency well-behaved — the alerter
// dispatch path is overridden via the test hook anyway.
vi.mock("../lib/oncall-settings", () => ({
  getOnCallDestinations: async () => ({
    pagerdutyIntegrationKey: null,
    opsAlertEmail: null,
    opsAlertSlackWebhookUrl: null,
  }),
}));

const { mockConfig, DEFAULT_MOCK_CONFIG } = vi.hoisted(() => {
  const DEFAULT_MOCK_CONFIG = { threshold: 5, windowHours: 24 };
  return { mockConfig: { ...DEFAULT_MOCK_CONFIG }, DEFAULT_MOCK_CONFIG };
});
vi.mock("../lib/machine-mismatch-alert-settings", () => ({
  getMachineMismatchAlertConfig: async () => ({ ...mockConfig }),
  MACHINE_MISMATCH_ALERT_DEFAULTS: { ...DEFAULT_MOCK_CONFIG },
}));

// Force every row our fake DB returns to be classified as a mismatch so
// tests can drive `total` purely by adjusting `mismatchRows.length`.
// computeOrderMismatch's real heuristic is exercised in
// external-order-mismatch.test.ts.
vi.mock("../lib/external-order-mismatch", () => ({
  computeOrderMismatch: () => true,
  parsePortalProductKeys: () => null,
}));

import {
  evaluateMachineMismatchAlert,
  __resetMachineMismatchAlerterForTests,
  __setMachineMismatchAlerterDeliveriesForTests,
  __getMachineMismatchAlerterStateForTests,
  MACHINE_MISMATCH_ALERT_ACTION_TYPE,
  MACHINE_MISMATCH_ALERT_ENTITY_TYPE,
  MACHINE_MISMATCH_ALERT_ENTITY_ID,
  type DeliveryResult,
  type MachineMismatchAlertPayload,
} from "../lib/machine-mismatch-alerter";

function buildRows(n: number): FakeMismatchRow[] {
  const rows: FakeMismatchRow[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      externalOrderId: `order-${i + 1}`,
      grantedSlugs: ["wrong-slug"],
      portalProductKeys: null,
      mostRecentPurchasedAt: new Date(),
    });
  }
  return rows;
}

beforeEach(() => {
  auditRows.length = 0;
  mismatchRows = [];
  mismatchQueryShouldThrow = false;
  mockConfig.threshold = DEFAULT_MOCK_CONFIG.threshold;
  mockConfig.windowHours = DEFAULT_MOCK_CONFIG.windowHours;
  __resetMachineMismatchAlerterForTests();
});

afterEach(() => {
  __resetMachineMismatchAlerterForTests();
});

describe("evaluateMachineMismatchAlert — fire/clear transitions", () => {
  it("does not fire when total is below threshold", async () => {
    mismatchRows = buildRows(2);
    const seen: MachineMismatchAlertPayload[] = [];
    __setMachineMismatchAlerterDeliveriesForTests({
      pagerduty: async (p) => { seen.push(p); return { channel: "pagerduty", ok: true }; },
      email: async (p) => { seen.push(p); return { channel: "email", ok: true }; },
      slack: async (p) => { seen.push(p); return { channel: "slack", ok: true }; },
    });
    const result = await evaluateMachineMismatchAlert();
    expect(result.stats.total).toBe(2);
    expect(result.stats.alerting).toBe(false);
    expect(result.deliveries).toEqual([]);
    expect(seen).toEqual([]);
    expect(__getMachineMismatchAlerterStateForTests()).toBe(false);
  });

  it("fires on the not-alerting → alerting transition and dispatches to every channel", async () => {
    mismatchRows = buildRows(6);
    const seen: DeliveryResult[] = [];
    __setMachineMismatchAlerterDeliveriesForTests({
      pagerduty: async () => { const r: DeliveryResult = { channel: "pagerduty", ok: true }; seen.push(r); return r; },
      email: async () => { const r: DeliveryResult = { channel: "email", ok: true }; seen.push(r); return r; },
      slack: async () => { const r: DeliveryResult = { channel: "slack", ok: true }; seen.push(r); return r; },
    });
    const result = await evaluateMachineMismatchAlert();
    expect(result.stats.alerting).toBe(true);
    expect(result.deliveries.length).toBe(3);
    expect(seen.map((r) => r.channel).sort()).toEqual(["email", "pagerduty", "slack"]);
    expect(__getMachineMismatchAlerterStateForTests()).toBe(true);
  });

  it("does not re-fire on subsequent polls while already alerting", async () => {
    mismatchRows = buildRows(6);
    let calls = 0;
    __setMachineMismatchAlerterDeliveriesForTests({
      pagerduty: async () => { calls++; return { channel: "pagerduty", ok: true }; },
      email: async () => { calls++; return { channel: "email", ok: true }; },
      slack: async () => { calls++; return { channel: "slack", ok: true }; },
    });
    await evaluateMachineMismatchAlert();
    expect(calls).toBe(3);
    const second = await evaluateMachineMismatchAlert();
    expect(second.deliveries).toEqual([]);
    expect(calls).toBe(3);
  });

  it("dispatches a clear on the alerting → not-alerting transition", async () => {
    mismatchRows = buildRows(6);
    const kinds: string[] = [];
    __setMachineMismatchAlerterDeliveriesForTests({
      pagerduty: async (p) => { kinds.push(`pd:${p.kind}`); return { channel: "pagerduty", ok: true }; },
      email: async (p) => { kinds.push(`em:${p.kind}`); return { channel: "email", ok: true }; },
      slack: async (p) => { kinds.push(`sl:${p.kind}`); return { channel: "slack", ok: true }; },
    });
    await evaluateMachineMismatchAlert();
    expect(kinds.filter((k) => k.endsWith(":fire")).length).toBe(3);

    mismatchRows = buildRows(1);
    const clear = await evaluateMachineMismatchAlert();
    expect(clear.stats.alerting).toBe(false);
    expect(clear.deliveries.length).toBe(3);
    expect(kinds.filter((k) => k.endsWith(":clear")).length).toBe(3);
    expect(__getMachineMismatchAlerterStateForTests()).toBe(false);
  });

  it("preserves alerting state when the stats query throws (does not auto-resolve on a DB outage)", async () => {
    mismatchRows = buildRows(6);
    __setMachineMismatchAlerterDeliveriesForTests({
      pagerduty: async () => ({ channel: "pagerduty", ok: true }),
      email: async () => ({ channel: "email", ok: true }),
      slack: async () => ({ channel: "slack", ok: true }),
    });
    await evaluateMachineMismatchAlert();
    expect(__getMachineMismatchAlerterStateForTests()).toBe(true);

    mismatchQueryShouldThrow = true;
    const result = await evaluateMachineMismatchAlert();
    expect(result.stats.statsAvailable).toBe(false);
    expect(result.deliveries).toEqual([]);
    // Alerting state must be preserved so the next successful poll either
    // re-fires (no) or correctly dispatches the clear.
    expect(__getMachineMismatchAlerterStateForTests()).toBe(true);
  });
});

describe("evaluateMachineMismatchAlert — throttling", () => {
  it("throttles re-fires within the throttle window after a flap back to alerting", async () => {
    process.env.MACHINE_MISMATCH_NOTIFICATION_THROTTLE_MS = String(60 * 60 * 1000);
    try {
      mismatchRows = buildRows(6);
      let fireCalls = 0;
      __setMachineMismatchAlerterDeliveriesForTests({
        pagerduty: async (p) => { if (p.kind === "fire") fireCalls++; return { channel: "pagerduty", ok: true }; },
        email: async (p) => { if (p.kind === "fire") fireCalls++; return { channel: "email", ok: true }; },
        slack: async (p) => { if (p.kind === "fire") fireCalls++; return { channel: "slack", ok: true }; },
      });
      // First fire — three channels.
      await evaluateMachineMismatchAlert();
      expect(fireCalls).toBe(3);

      // Flap: drop below threshold → clear, then go above again immediately
      // → second fire transition. Channels should refuse because they are
      // still inside the throttle window.
      mismatchRows = buildRows(1);
      await evaluateMachineMismatchAlert();
      mismatchRows = buildRows(6);
      const refire = await evaluateMachineMismatchAlert();
      expect(refire.stats.alerting).toBe(true);
      // All three should report skipped+throttled rather than calling the
      // delivery function again.
      expect(refire.deliveries.every((d) => d.ok && d.skipped && d.reason === "throttled")).toBe(true);
      expect(fireCalls).toBe(3);
    } finally {
      delete process.env.MACHINE_MISMATCH_NOTIFICATION_THROTTLE_MS;
    }
  });
});

describe("evaluateMachineMismatchAlert — audit log", () => {
  it("writes one audit row per delivery attempt with the alerter's action/entity types", async () => {
    mismatchRows = buildRows(6);
    __setMachineMismatchAlerterDeliveriesForTests({
      pagerduty: async () => ({ channel: "pagerduty", ok: true }),
      email: async () => ({ channel: "email", ok: true }),
      slack: async () => ({ channel: "slack", ok: true }),
    });
    await evaluateMachineMismatchAlert();
    expect(auditRows.length).toBe(3);
    for (const row of auditRows) {
      expect(row.actionType).toBe(MACHINE_MISMATCH_ALERT_ACTION_TYPE);
      expect(row.entityType).toBe(MACHINE_MISMATCH_ALERT_ENTITY_TYPE);
      expect(row.entityId).toBe(MACHINE_MISMATCH_ALERT_ENTITY_ID);
      expect(row.metadata).toMatchObject({
        kind: "fire",
        outcome: "sent",
        total: 6,
        threshold: 5,
        windowMs: 24 * 60 * 60 * 1000,
      });
      expect(Array.isArray((row.metadata as any).sampleOrderIds)).toBe(true);
      expect((row.metadata as any).sampleOrderIds.length).toBeLessThanOrEqual(5);
    }
  });

  it("records failed deliveries with outcome=failed and a reason", async () => {
    mismatchRows = buildRows(6);
    __setMachineMismatchAlerterDeliveriesForTests({
      pagerduty: async () => ({ channel: "pagerduty", ok: false, reason: "http_502" }),
      email: async () => ({ channel: "email", ok: true }),
      slack: async () => ({ channel: "slack", ok: true }),
    });
    await evaluateMachineMismatchAlert();
    const pdRow = auditRows.find((r) => (r.metadata as any)?.deliveryChannel === "pagerduty");
    expect(pdRow).toBeTruthy();
    expect((pdRow!.metadata as any).outcome).toBe("failed");
    expect((pdRow!.metadata as any).reason).toBe("http_502");
  });
});

describe("evaluateMachineMismatchAlert — admin-tunable thresholds", () => {
  it("respects a tightened threshold so a smaller count now fires", async () => {
    mockConfig.threshold = 2;
    mismatchRows = buildRows(2);
    __setMachineMismatchAlerterDeliveriesForTests({
      pagerduty: async () => ({ channel: "pagerduty", ok: true }),
      email: async () => ({ channel: "email", ok: true }),
      slack: async () => ({ channel: "slack", ok: true }),
    });
    const result = await evaluateMachineMismatchAlert();
    expect(result.stats.alerting).toBe(true);
    expect(result.stats.threshold).toBe(2);
    expect(result.deliveries.length).toBe(3);
  });

  it("respects a relaxed threshold so a previously-alerting count stays quiet", async () => {
    mockConfig.threshold = 50;
    mismatchRows = buildRows(10);
    __setMachineMismatchAlerterDeliveriesForTests({
      pagerduty: async () => ({ channel: "pagerduty", ok: true }),
      email: async () => ({ channel: "email", ok: true }),
      slack: async () => ({ channel: "slack", ok: true }),
    });
    const result = await evaluateMachineMismatchAlert();
    expect(result.stats.alerting).toBe(false);
    expect(result.deliveries).toEqual([]);
  });

  it("reflects the configured windowHours in stats.windowMs", async () => {
    mockConfig.windowHours = 6;
    mismatchRows = buildRows(1);
    const result = await evaluateMachineMismatchAlert();
    expect(result.stats.windowMs).toBe(6 * 60 * 60 * 1000);
  });
});
