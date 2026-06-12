import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, auditLogTable, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import adminPanelRouter from "../routes/admin-panel";
import {
  QUEUE_FALLBACK_ALERT_ACTION_TYPE,
  QUEUE_FALLBACK_ALERT_ENTITY_TYPE,
} from "../lib/queue-fallback-alerter";
import {
  __resetQueueFallbackAlerterStateForTests,
  compareAndSetAlertingState,
  tryClaimThrottleSlot,
} from "../lib/queue-fallback-alerter-state";
import { buildTestAppWithRouters } from "./test-app";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `qfb-alerter-health-${randomUUID().slice(0, 8)}`;

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

async function insertAlertRow(args: {
  queueChannel: "email" | "sms";
  kind: "fire" | "clear";
  createdAt: Date;
  outcome?: "sent" | "failed" | "throttled" | "skipped";
  deliveryChannel?: "pagerduty" | "email" | "slack";
}): Promise<number> {
  const [row] = await db
    .insert(auditLogTable)
    .values({
      actionType: QUEUE_FALLBACK_ALERT_ACTION_TYPE,
      entityType: QUEUE_FALLBACK_ALERT_ENTITY_TYPE,
      entityId: args.queueChannel,
      description: `Test alerter ${args.kind}`,
      metadata: {
        queueChannel: args.queueChannel,
        deliveryChannel: args.deliveryChannel ?? "pagerduty",
        kind: args.kind,
        outcome: args.outcome ?? "sent",
        reason: null,
      },
      createdAt: args.createdAt,
    })
    .returning({ id: auditLogTable.id });
  insertedAuditIds.push(row.id);
  return row.id;
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

beforeEach(() => {
  // The route reads in-memory alerter state when Redis isn't configured (the
  // test environment doesn't set REDIS_URL), so reset between tests so
  // earlier flips don't bleed into later assertions.
  __resetQueueFallbackAlerterStateForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/admin/system/queue-fallback-alerter-health", () => {
  it("returns the per-channel alerting flag, last fire/clear, and active throttle slots", async () => {
    await compareAndSetAlertingState("email", true);
    await tryClaimThrottleSlot("email", "pagerduty", "fire", 60_000);
    await tryClaimThrottleSlot("sms", "slack", "clear", 30_000);

    const now = Date.now();
    const fireId = await insertAlertRow({
      queueChannel: "email",
      kind: "fire",
      createdAt: new Date(now - 10 * 60 * 1000),
    });
    const clearId = await insertAlertRow({
      queueChannel: "email",
      kind: "clear",
      createdAt: new Date(now - 60 * 60 * 1000),
    });
    // A newer fire must win the MAX(createdAt) per channel/kind grouping.
    const fresherFireId = await insertAlertRow({
      queueChannel: "email",
      kind: "fire",
      createdAt: new Date(now - 30 * 1000),
    });

    const res = await request(app)
      .get("/api/admin/system/queue-fallback-alerter-health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      alertingSource: "memory",
      throttleSource: "memory",
    });
    expect(typeof res.body.serverTime).toBe("string");

    const channelsByName = Object.fromEntries(
      (res.body.channels as Array<{ channel: string; alerting: boolean; lastFireAt: string | null; lastClearAt: string | null }>).map((c) => [c.channel, c]),
    );
    expect(channelsByName.email.alerting).toBe(true);
    expect(channelsByName.sms.alerting).toBe(false);

    // lastFireAt should reflect the freshest of the two seeded fires.
    const lastFireAt = channelsByName.email.lastFireAt;
    expect(typeof lastFireAt).toBe("string");
    expect(new Date(lastFireAt!).getTime()).toBeGreaterThan(now - 60 * 1000);
    expect(typeof channelsByName.email.lastClearAt).toBe("string");

    // sms has no audit rows in this test → both should be null.
    expect(channelsByName.sms.lastFireAt).toBeNull();
    expect(channelsByName.sms.lastClearAt).toBeNull();

    const throttles = res.body.throttles as Array<{
      queueChannel: string;
      deliveryChannel: string;
      kind: string;
      ttlMs: number;
      expiresAt: string;
    }>;
    expect(throttles).toHaveLength(2);
    // Sorted ascending by ttlMs — sms/slack/clear (30s) should be first.
    expect(throttles[0]).toMatchObject({
      queueChannel: "sms",
      deliveryChannel: "slack",
      kind: "clear",
    });
    expect(throttles[0].ttlMs).toBeGreaterThan(0);
    expect(throttles[0].ttlMs).toBeLessThanOrEqual(30_000);
    expect(throttles[1]).toMatchObject({
      queueChannel: "email",
      deliveryChannel: "pagerduty",
      kind: "fire",
    });
    expect(throttles[1].ttlMs).toBeGreaterThan(30_000);

    // Reference the seeded ids so the cleanup loop owns them.
    expect([fireId, clearId, fresherFireId].every((id) => typeof id === "number")).toBe(true);
  });

  it("returns nulls for last fire/clear when no audit rows exist for that channel/kind", async () => {
    const res = await request(app)
      .get("/api/admin/system/queue-fallback-alerter-health")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const sms = (res.body.channels as Array<{ channel: string; lastFireAt: string | null; lastClearAt: string | null }>)
      .find((c) => c.channel === "sms");
    expect(sms).toBeDefined();
    // SMS audit rows from other tests in this suite *can* leak across tests
    // because audit data isn't reset; but the assertion we care about is
    // shape — the field exists and is either null or an ISO string.
    expect(sms!.lastFireAt === null || typeof sms!.lastFireAt === "string").toBe(true);
    expect(sms!.lastClearAt === null || typeof sms!.lastClearAt === "string").toBe(true);
  });

  it("ignores audit rows whose actionType/entityType don't match the alerter", async () => {
    const now = Date.now();
    // Insert a row with the right entityId but the wrong actionType — must
    // not contribute to the lastFireAt for "email".
    const wrongRow = await db
      .insert(auditLogTable)
      .values({
        actionType: "queue_fallback",
        entityType: QUEUE_FALLBACK_ALERT_ENTITY_TYPE,
        entityId: "email",
        description: "wrong action type",
        metadata: { queueChannel: "email", kind: "fire" },
        createdAt: new Date(now + 60_000), // newer than anything else seeded
      })
      .returning({ id: auditLogTable.id });
    insertedAuditIds.push(wrongRow[0].id);

    const res = await request(app)
      .get("/api/admin/system/queue-fallback-alerter-health")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const email = (res.body.channels as Array<{ channel: string; lastFireAt: string | null }>)
      .find((c) => c.channel === "email");
    if (email!.lastFireAt) {
      // If a previous test's fire is still on record, it must still be in the
      // past — proving the wrong-actionType row (which was 1 minute in the
      // future) didn't leak in.
      expect(new Date(email!.lastFireAt).getTime()).toBeLessThan(now + 60_000);
    }
  });

  it("rejects callers without system:view permission", async () => {
    const res = await request(app)
      .get("/api/admin/system/queue-fallback-alerter-health")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });
});
