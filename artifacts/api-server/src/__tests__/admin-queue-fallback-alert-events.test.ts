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
