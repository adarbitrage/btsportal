import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, auditLogTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import adminPanelRouter from "../routes/admin-panel";
import {
  QUEUE_FALLBACK_ALERT_ACTION_TYPE,
  QUEUE_FALLBACK_ALERT_ENTITY_TYPE,
} from "../lib/queue-fallback-alerter";
import { RETELL_AGENT_ALERT_ACTION_TYPE } from "../lib/retell-agent-alerter";
import { buildTestAppWithRouters } from "./test-app";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `qfb-alert-events-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const insertedAuditIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
let memberCookie = "";

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function seedUser(role: "super_admin" | "member"): Promise<{ id: number; email: string; cookie: string }> {
  const email = `${TEST_TAG}-${role}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test ${role}`,
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email, cookie: signCookie(row.id, email) };
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);
  const admin = await seedUser("super_admin");
  const member = await seedUser("member");
  adminCookie = admin.cookie;
  memberCookie = member.cookie;
});

afterAll(async () => {
  if (insertedAuditIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.id, insertedAuditIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

async function insertAlertRow(args: {
  queueChannel: "email" | "sms" | "carrier-pigeon";
  deliveryChannel?: "pagerduty" | "email" | "slack" | "morse-code";
  kind?: "fire" | "clear" | "ping";
  outcome?: "sent" | "failed" | "throttled" | "skipped" | "weird";
  reason?: string | null;
  actionType?: string;
  entityType?: string;
  createdAt?: Date;
  metaOverride?: Record<string, unknown>;
}): Promise<number> {
  const meta: Record<string, unknown> = args.metaOverride ?? {
    queueChannel: args.queueChannel,
    deliveryChannel: args.deliveryChannel,
    kind: args.kind,
    outcome: args.outcome,
    reason: args.reason ?? null,
  };

  const [row] = await db
    .insert(auditLogTable)
    .values({
      actionType: args.actionType ?? QUEUE_FALLBACK_ALERT_ACTION_TYPE,
      entityType: args.entityType ?? QUEUE_FALLBACK_ALERT_ENTITY_TYPE,
      entityId: args.queueChannel,
      description: `Test alert ${args.kind ?? ""} via ${args.deliveryChannel ?? ""}`,
      metadata: meta,
      createdAt: args.createdAt ?? new Date(),
    })
    .returning({ id: auditLogTable.id });
  insertedAuditIds.push(row.id);
  return row.id;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/admin/system/queue-fallback-alert-events", () => {
  it("returns recent alert delivery rows ordered newest-first with parsed metadata", async () => {
    const now = Date.now();
    const oldId = await insertAlertRow({
      queueChannel: "email",
      deliveryChannel: "pagerduty",
      kind: "fire",
      outcome: "sent",
      reason: null,
      createdAt: new Date(now - 5 * 60 * 1000),
    });
    const newId = await insertAlertRow({
      queueChannel: "sms",
      deliveryChannel: "slack",
      kind: "clear",
      outcome: "failed",
      reason: "webhook_5xx",
      createdAt: new Date(now - 30 * 1000),
    });

    const res = await request(app)
      .get("/api/admin/system/queue-fallback-alert-events?limit=200")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);

    const ours = res.body.events.filter((e: { id: number }) => e.id === oldId || e.id === newId);
    expect(ours).toHaveLength(2);

    const indexNew = ours.findIndex((e: { id: number }) => e.id === newId);
    const indexOld = ours.findIndex((e: { id: number }) => e.id === oldId);
    expect(indexNew).toBeLessThan(indexOld);

    const newRow = ours.find((e: { id: number }) => e.id === newId);
    expect(newRow).toMatchObject({
      queueChannel: "sms",
      deliveryChannel: "slack",
      kind: "clear",
      outcome: "failed",
      reason: "webhook_5xx",
    });
    expect(typeof newRow.createdAt).toBe("string");
  });

  it("forwards the raw audit metadata so System Health can inline-inspect a flagged delivery", async () => {
    // Inject a few delivery-channel-specific identifiers (the kind of thing
    // an admin would want surfaced inline during an incident — e.g. the
    // PagerDuty incident key and routing key — alongside the standard
    // alerter fields). The endpoint should hand all of these back verbatim
    // under `metadata` so the frontend's expand-in-place row can render
    // the full payload without a second round-trip.
    const id = await insertAlertRow({
      queueChannel: "email",
      deliveryChannel: "pagerduty",
      kind: "fire",
      outcome: "failed",
      reason: "PagerDuty rejected dedup_key (HTTP 400)",
      metaOverride: {
        queueChannel: "email",
        deliveryChannel: "pagerduty",
        kind: "fire",
        outcome: "failed",
        reason: "PagerDuty rejected dedup_key (HTTP 400)",
        recentCount: 7,
        hourCount: 12,
        dayCount: 42,
        pagerDutyIncidentKey: "queue-fallback:email:fire",
        pagerDutyRoutingKey: "rk-abcdef",
      },
    });

    const res = await request(app)
      .get("/api/admin/system/queue-fallback-alert-events?limit=200")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const row = res.body.events.find((e: { id: number }) => e.id === id);
    expect(row).toBeDefined();
    expect(row.metadata).toMatchObject({
      queueChannel: "email",
      deliveryChannel: "pagerduty",
      kind: "fire",
      outcome: "failed",
      reason: "PagerDuty rejected dedup_key (HTTP 400)",
      recentCount: 7,
      hourCount: 12,
      dayCount: 42,
      pagerDutyIncidentKey: "queue-fallback:email:fire",
      pagerDutyRoutingKey: "rk-abcdef",
    });
  });

  it("normalizes unknown delivery channel/kind/outcome values to null and falls back to entityId for queueChannel", async () => {
    const weirdId = await insertAlertRow({
      queueChannel: "carrier-pigeon",
      deliveryChannel: "morse-code",
      kind: "ping",
      outcome: "weird",
      reason: null,
    });
    const noQueueChannelInMetaId = await insertAlertRow({
      queueChannel: "email",
      deliveryChannel: "pagerduty",
      kind: "fire",
      outcome: "sent",
      reason: null,
      // Missing queueChannel in metadata; endpoint should fall back to entityId.
      metaOverride: {
        deliveryChannel: "pagerduty",
        kind: "fire",
        outcome: "sent",
      },
    });

    const res = await request(app)
      .get("/api/admin/system/queue-fallback-alert-events?limit=200")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const weirdRow = res.body.events.find((e: { id: number }) => e.id === weirdId);
    expect(weirdRow).toMatchObject({
      queueChannel: null,
      deliveryChannel: null,
      kind: null,
      outcome: null,
    });

    const fallbackRow = res.body.events.find((e: { id: number }) => e.id === noQueueChannelInMetaId);
    expect(fallbackRow.queueChannel).toBe("email");
  });

  it("includes voice-assistant alert rows in the timeline with their actionType populated", async () => {
    // The System Health alert timeline unions every alerter that writes
    // entityType="alert" rows. Voice-assistant (Retell) fire/clear pages must
    // appear alongside queue-fallback rows AND carry their own `actionType`
    // (`retell_agent_alert`) so the UI can label the source "Voice assistant"
    // and deep-link the row to the Voice Assistant panel. A future alerter
    // wiring change that drops the action type from the union or stops echoing
    // it back would silently break that path — this guards it.
    const voiceId = await insertAlertRow({
      queueChannel: "email",
      deliveryChannel: "pagerduty",
      kind: "fire",
      outcome: "failed",
      reason: "Agent pointing at a broken conversation_flow engine",
      actionType: RETELL_AGENT_ALERT_ACTION_TYPE,
      entityType: QUEUE_FALLBACK_ALERT_ENTITY_TYPE,
    });

    const res = await request(app)
      .get("/api/admin/system/queue-fallback-alert-events?limit=200")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const voiceRow = res.body.events.find((e: { id: number }) => e.id === voiceId);
    expect(voiceRow).toBeDefined();
    expect(voiceRow.actionType).toBe("retell_agent_alert");
  });

  it("ignores audit rows with the wrong actionType or entityType", async () => {
    const wrongActionId = await insertAlertRow({
      queueChannel: "email",
      deliveryChannel: "pagerduty",
      kind: "fire",
      outcome: "sent",
      actionType: "queue_fallback",
    });
    const wrongEntityId = await insertAlertRow({
      queueChannel: "email",
      deliveryChannel: "pagerduty",
      kind: "fire",
      outcome: "sent",
      entityType: "queue",
    });
    const goodId = await insertAlertRow({
      queueChannel: "email",
      deliveryChannel: "email",
      kind: "fire",
      outcome: "throttled",
      reason: "throttled",
    });

    const res = await request(app)
      .get("/api/admin/system/queue-fallback-alert-events?limit=200")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const ids = res.body.events.map((e: { id: number }) => e.id);
    expect(ids).toContain(goodId);
    expect(ids).not.toContain(wrongActionId);
    expect(ids).not.toContain(wrongEntityId);
  });

  it("clamps limit between 1 and 200 and defaults to 50", async () => {
    const okRes = await request(app)
      .get("/api/admin/system/queue-fallback-alert-events")
      .set("Cookie", adminCookie);
    expect(okRes.status).toBe(200);
    expect(okRes.body.limit).toBe(50);

    const tooSmall = await request(app)
      .get("/api/admin/system/queue-fallback-alert-events?limit=0")
      .set("Cookie", adminCookie);
    expect(tooSmall.body.limit).toBe(1);

    const tooBig = await request(app)
      .get("/api/admin/system/queue-fallback-alert-events?limit=9999")
      .set("Cookie", adminCookie);
    expect(tooBig.body.limit).toBe(200);

    const garbage = await request(app)
      .get("/api/admin/system/queue-fallback-alert-events?limit=abc")
      .set("Cookie", adminCookie);
    expect(garbage.body.limit).toBe(50);
  });

  it("excludes audit rows older than the rolling window from stats", async () => {
    // Snapshot the current stats, then insert a single >1h-old "sent" row
    // and re-snapshot. The stale row must not bump any stats bucket — that's
    // the whole point of the rolling window being independent of `limit`.
    const before = await request(app)
      .get("/api/admin/system/queue-fallback-alert-events?limit=1")
      .set("Cookie", adminCookie);
    expect(before.status).toBe(200);
    const baseline = before.body.stats;
    expect(baseline).toBeDefined();
    expect(baseline.windowMs).toBe(60 * 60 * 1000);

    await insertAlertRow({
      queueChannel: "email",
      deliveryChannel: "pagerduty",
      kind: "fire",
      outcome: "sent",
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    });

    const after = await request(app)
      .get("/api/admin/system/queue-fallback-alert-events?limit=1")
      .set("Cookie", adminCookie);
    expect(after.status).toBe(200);
    const updated = after.body.stats;
    expect(updated.sent).toBe(baseline.sent);
    expect(updated.failed).toBe(baseline.failed);
    expect(updated.throttled).toBe(baseline.throttled);
    expect(updated.skipped).toBe(baseline.skipped);
    expect(updated.unknown).toBe(baseline.unknown);
    expect(updated.total).toBe(baseline.total);
  });

  it("returns rolling stats grouped by outcome over the last hour", async () => {
    const now = Date.now();
    const recentSent = await insertAlertRow({
      queueChannel: "email",
      deliveryChannel: "pagerduty",
      kind: "fire",
      outcome: "sent",
      createdAt: new Date(now - 5 * 60 * 1000),
    });
    const recentFailed = await insertAlertRow({
      queueChannel: "sms",
      deliveryChannel: "slack",
      kind: "fire",
      outcome: "failed",
      reason: "boom",
      createdAt: new Date(now - 2 * 60 * 1000),
    });
    const recentThrottled = await insertAlertRow({
      queueChannel: "email",
      deliveryChannel: "email",
      kind: "fire",
      outcome: "throttled",
      reason: "throttled",
      createdAt: new Date(now - 30 * 1000),
    });
    // > 1 hour old; must not be counted in the rolling window.
    const stale = await insertAlertRow({
      queueChannel: "email",
      deliveryChannel: "pagerduty",
      kind: "fire",
      outcome: "sent",
      createdAt: new Date(now - 2 * 60 * 60 * 1000),
    });

    const res = await request(app)
      .get("/api/admin/system/queue-fallback-alert-events?limit=200")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.stats).toBeDefined();
    expect(res.body.stats.windowMs).toBe(60 * 60 * 1000);
    // Other tests in the suite seed rows with `createdAt` defaulting to "now",
    // so we use >= rather than equality on each bucket.
    expect(res.body.stats.sent).toBeGreaterThanOrEqual(1);
    expect(res.body.stats.failed).toBeGreaterThanOrEqual(1);
    expect(res.body.stats.throttled).toBeGreaterThanOrEqual(1);
    expect(res.body.stats.total).toBeGreaterThanOrEqual(3);
    // Sanity: at least our 3 in-window rows are reflected, but the stale row
    // (2h old) should not push `sent` higher than the rows visible in the page.
    const ourRecentIds = [recentSent, recentFailed, recentThrottled];
    const visibleIds = res.body.events.map((e: { id: number }) => e.id);
    for (const id of ourRecentIds) expect(visibleIds).toContain(id);
    expect(visibleIds).toContain(stale);
  });

  it("breaks rolling stats down by delivery channel so the summary can show which channel is broken", async () => {
    const now = Date.now();
    // Two PagerDuty failures + one Slack failure in-window — the summary
    // line on /admin/system relies on this shape to render
    // "3 failed (2 PagerDuty, 1 Slack)" without filtering the audit log.
    const pagerFail1 = await insertAlertRow({
      queueChannel: "email",
      deliveryChannel: "pagerduty",
      kind: "fire",
      outcome: "failed",
      reason: "webhook_5xx",
      createdAt: new Date(now - 10 * 60 * 1000),
    });
    const pagerFail2 = await insertAlertRow({
      queueChannel: "sms",
      deliveryChannel: "pagerduty",
      kind: "fire",
      outcome: "failed",
      reason: "webhook_5xx",
      createdAt: new Date(now - 8 * 60 * 1000),
    });
    const slackFail = await insertAlertRow({
      queueChannel: "email",
      deliveryChannel: "slack",
      kind: "fire",
      outcome: "failed",
      reason: "webhook_4xx",
      createdAt: new Date(now - 6 * 60 * 1000),
    });
    // A successful Email delivery so byChannel.email gets a non-zero `sent`
    // bucket too — proves channels track all outcomes, not just failures.
    const emailSent = await insertAlertRow({
      queueChannel: "email",
      deliveryChannel: "email",
      kind: "fire",
      outcome: "sent",
      createdAt: new Date(now - 4 * 60 * 1000),
    });

    const res = await request(app)
      .get("/api/admin/system/queue-fallback-alert-events?limit=200")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    const byChannel = res.body.stats.byChannel;
    expect(byChannel).toBeDefined();
    // All four buckets always present so the frontend can render a
    // stable layout without optional-chaining every channel key.
    expect(Object.keys(byChannel).sort()).toEqual(["email", "pagerduty", "slack", "unknown"]);
    for (const key of ["pagerduty", "email", "slack", "unknown"]) {
      const bucket = byChannel[key];
      expect(bucket).toMatchObject({
        sent: expect.any(Number),
        failed: expect.any(Number),
        throttled: expect.any(Number),
        skipped: expect.any(Number),
        unknown: expect.any(Number),
        total: expect.any(Number),
      });
    }

    // The seeded failures must show up in the right per-channel buckets.
    // Use >= to tolerate other rows seeded by sibling tests.
    expect(byChannel.pagerduty.failed).toBeGreaterThanOrEqual(2);
    expect(byChannel.slack.failed).toBeGreaterThanOrEqual(1);
    expect(byChannel.email.sent).toBeGreaterThanOrEqual(1);

    // Per-channel totals should still equal the sum of their per-outcome
    // counters — otherwise the summary breakdown would disagree with the
    // top-level "N failed" badge it sits next to.
    for (const key of ["pagerduty", "email", "slack", "unknown"]) {
      const b = byChannel[key];
      expect(b.total).toBe(b.sent + b.failed + b.throttled + b.skipped + b.unknown);
    }

    // And the sum of per-channel failures should equal the top-level
    // `failed` bucket — the summary derives its breakdown from `byChannel`
    // and its total from `stats.failed`, so they have to match.
    const failedAcrossChannels =
      byChannel.pagerduty.failed +
      byChannel.email.failed +
      byChannel.slack.failed +
      byChannel.unknown.failed;
    expect(failedAcrossChannels).toBe(res.body.stats.failed);

    // Sanity: every seeded id is visible in the events page so the test
    // is actually exercising the rows we think it is.
    const ids = res.body.events.map((e: { id: number }) => e.id);
    for (const id of [pagerFail1, pagerFail2, slackFail, emailSent]) {
      expect(ids).toContain(id);
    }
  });

  it("buckets rows with missing/unrecognized deliveryChannel into byChannel.unknown", async () => {
    const before = await request(app)
      .get("/api/admin/system/queue-fallback-alert-events?limit=1")
      .set("Cookie", adminCookie);
    expect(before.status).toBe(200);
    const baselineUnknownFailed = before.body.stats.byChannel?.unknown?.failed ?? 0;

    // Recent in-window row with no recognizable deliveryChannel — must land
    // in the unknown bucket so the summary can still surface it instead of
    // silently swallowing the failure.
    await insertAlertRow({
      queueChannel: "email",
      kind: "fire",
      outcome: "failed",
      reason: "weird",
      metaOverride: {
        queueChannel: "email",
        deliveryChannel: "morse-code",
        kind: "fire",
        outcome: "failed",
      },
      createdAt: new Date(Date.now() - 60 * 1000),
    });

    const after = await request(app)
      .get("/api/admin/system/queue-fallback-alert-events?limit=1")
      .set("Cookie", adminCookie);
    expect(after.status).toBe(200);
    expect(after.body.stats.byChannel.unknown.failed).toBe(baselineUnknownFailed + 1);
  });

  describe("statsWindowMs query param", () => {
    it("defaults to a 1h rolling window when no statsWindowMs is supplied", async () => {
      const res = await request(app)
        .get("/api/admin/system/queue-fallback-alert-events?limit=1")
        .set("Cookie", adminCookie);
      expect(res.status).toBe(200);
      expect(res.body.stats.windowMs).toBe(60 * 60 * 1000);
    });

    it("honors statsWindowMs=86400000 (24h) and includes rows older than 1h but newer than 24h", async () => {
      // Anchor a row in the gap between 1h and 24h so we can prove the
      // wider window picks it up while the default 1h window does not.
      const gapId = await insertAlertRow({
        queueChannel: "email",
        deliveryChannel: "pagerduty",
        kind: "fire",
        outcome: "sent",
        createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
      });

      const oneHour = await request(app)
        .get("/api/admin/system/queue-fallback-alert-events?limit=200")
        .set("Cookie", adminCookie);
      expect(oneHour.status).toBe(200);
      expect(oneHour.body.stats.windowMs).toBe(60 * 60 * 1000);
      const oneHourSent = oneHour.body.stats.sent;

      const dayWindow = await request(app)
        .get("/api/admin/system/queue-fallback-alert-events?limit=200&statsWindowMs=86400000")
        .set("Cookie", adminCookie);
      expect(dayWindow.status).toBe(200);
      expect(dayWindow.body.stats.windowMs).toBe(24 * 60 * 60 * 1000);
      // The 6h-old "sent" row should bump the 24h bucket but not the 1h one.
      expect(dayWindow.body.stats.sent).toBeGreaterThanOrEqual(oneHourSent + 1);

      // The row itself does not have to appear in the events page (the page
      // is bounded by limit, not the window) but it should at least exist.
      expect(typeof gapId).toBe("number");
    });

    it("ignores statsWindowMs values outside the allow-list and falls back to 1h", async () => {
      const garbage = await request(app)
        .get("/api/admin/system/queue-fallback-alert-events?limit=1&statsWindowMs=999")
        .set("Cookie", adminCookie);
      expect(garbage.status).toBe(200);
      expect(garbage.body.stats.windowMs).toBe(60 * 60 * 1000);

      const nonNumeric = await request(app)
        .get("/api/admin/system/queue-fallback-alert-events?limit=1&statsWindowMs=forever")
        .set("Cookie", adminCookie);
      expect(nonNumeric.status).toBe(200);
      expect(nonNumeric.body.stats.windowMs).toBe(60 * 60 * 1000);

      // 7d would be a reasonable-looking number that we still don't allow.
      const tooBig = await request(app)
        .get(`/api/admin/system/queue-fallback-alert-events?limit=1&statsWindowMs=${7 * 24 * 60 * 60 * 1000}`)
        .set("Cookie", adminCookie);
      expect(tooBig.status).toBe(200);
      expect(tooBig.body.stats.windowMs).toBe(60 * 60 * 1000);
    });
  });

  it("rejects callers without system:view permission", async () => {
    const res = await request(app)
      .get("/api/admin/system/queue-fallback-alert-events")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });

  describe("outcome / deliveryChannel filters", () => {
    let sentPagerId: number;
    let failedSlackId: number;
    let throttledEmailId: number;
    let skippedPagerId: number;

    beforeAll(async () => {
      const now = Date.now();
      sentPagerId = await insertAlertRow({
        queueChannel: "email",
        deliveryChannel: "pagerduty",
        kind: "fire",
        outcome: "sent",
        createdAt: new Date(now - 60 * 1000),
      });
      failedSlackId = await insertAlertRow({
        queueChannel: "sms",
        deliveryChannel: "slack",
        kind: "fire",
        outcome: "failed",
        reason: "webhook_5xx",
        createdAt: new Date(now - 50 * 1000),
      });
      throttledEmailId = await insertAlertRow({
        queueChannel: "email",
        deliveryChannel: "email",
        kind: "fire",
        outcome: "throttled",
        reason: "throttled",
        createdAt: new Date(now - 40 * 1000),
      });
      skippedPagerId = await insertAlertRow({
        queueChannel: "email",
        deliveryChannel: "pagerduty",
        kind: "clear",
        outcome: "skipped",
        reason: "no_recipients",
        createdAt: new Date(now - 30 * 1000),
      });
    });

    it("filters by outcome=failed and echoes the applied filter", async () => {
      const res = await request(app)
        .get("/api/admin/system/queue-fallback-alert-events?limit=200&outcome=failed")
        .set("Cookie", adminCookie);
      expect(res.status).toBe(200);
      expect(res.body.filters).toEqual({ outcome: "failed", deliveryChannel: null });

      const ours = res.body.events.filter((e: { id: number }) =>
        [sentPagerId, failedSlackId, throttledEmailId, skippedPagerId].includes(e.id),
      );
      expect(ours.map((e: { id: number }) => e.id)).toEqual([failedSlackId]);
      expect(ours.every((e: { outcome: string }) => e.outcome === "failed")).toBe(true);
    });

    it("filters by deliveryChannel=pagerduty", async () => {
      const res = await request(app)
        .get("/api/admin/system/queue-fallback-alert-events?limit=200&deliveryChannel=pagerduty")
        .set("Cookie", adminCookie);
      expect(res.status).toBe(200);
      expect(res.body.filters).toEqual({ outcome: null, deliveryChannel: "pagerduty" });

      const ours = res.body.events.filter((e: { id: number }) =>
        [sentPagerId, failedSlackId, throttledEmailId, skippedPagerId].includes(e.id),
      );
      expect(ours.map((e: { id: number }) => e.id).sort()).toEqual([sentPagerId, skippedPagerId].sort());
      expect(ours.every((e: { deliveryChannel: string }) => e.deliveryChannel === "pagerduty")).toBe(true);
    });

    it("combines outcome and deliveryChannel filters with AND semantics", async () => {
      const res = await request(app)
        .get("/api/admin/system/queue-fallback-alert-events?limit=200&outcome=skipped&deliveryChannel=pagerduty")
        .set("Cookie", adminCookie);
      expect(res.status).toBe(200);
      expect(res.body.filters).toEqual({ outcome: "skipped", deliveryChannel: "pagerduty" });

      const ours = res.body.events.filter((e: { id: number }) =>
        [sentPagerId, failedSlackId, throttledEmailId, skippedPagerId].includes(e.id),
      );
      expect(ours.map((e: { id: number }) => e.id)).toEqual([skippedPagerId]);
    });

    it("ignores unknown outcome / deliveryChannel values (treats as no filter)", async () => {
      const res = await request(app)
        .get("/api/admin/system/queue-fallback-alert-events?limit=200&outcome=bogus&deliveryChannel=carrier-pigeon")
        .set("Cookie", adminCookie);
      expect(res.status).toBe(200);
      expect(res.body.filters).toEqual({ outcome: null, deliveryChannel: null });

      const ourIds = res.body.events
        .map((e: { id: number }) => e.id)
        .filter((id: number) => [sentPagerId, failedSlackId, throttledEmailId, skippedPagerId].includes(id));
      // All four seeded rows should still be present when filters are invalid.
      expect(ourIds.sort()).toEqual([sentPagerId, failedSlackId, throttledEmailId, skippedPagerId].sort());
    });
  });
});
