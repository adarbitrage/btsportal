import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, auditLogTable } from "@workspace/db";
import { and, eq, gte, inArray, like } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";
import { AUTH_RATE_LIMIT_AUDIT_ACTION, AUTH_RATE_LIMIT_AUDIT_ENTITY } from "../routes/auth";
import {
  AUTH_RATE_LIMIT_ALERT_ACTION_TYPE,
  __resetAuthRateLimitAlerterForTests,
} from "../lib/auth-rate-limit-alerter";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

const TEST_TAG = `needs-attention-rl-${randomUUID().slice(0, 8)}`;
let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let adminUserId: number;

async function seedAdmin(): Promise<{ id: number; email: string; cookie: string }> {
  const email = `${TEST_TAG}-admin@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Test admin",
      passwordHash,
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  const token = jwt.sign({ userId: row.id, email }, JWT_SECRET, { expiresIn: "1h" });
  return { id: row.id, email, cookie: `access_token=${token}` };
}

async function insertRateLimitRow(opts: { ip: string | null; minutesAgo: number }) {
  await db.insert(auditLogTable).values({
    actorId: null,
    actorEmail: null,
    actionType: AUTH_RATE_LIMIT_AUDIT_ACTION,
    entityType: AUTH_RATE_LIMIT_AUDIT_ENTITY,
    entityId: "login",
    description: `[${TEST_TAG}] simulated rate-limit hit`,
    ipAddress: opts.ip,
    metadata: { source: TEST_TAG },
    createdAt: new Date(Date.now() - opts.minutesAgo * 60 * 1000),
  });
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);
  const admin = await seedAdmin();
  adminUserId = admin.id;
  adminCookie = admin.cookie;
});

// The endpoint counts every `auth_rate_limit_blocked` row in the trailing
// 15-minute window — it has no concept of "rows belonging to this test". To
// keep assertions hermetic we wipe ALL rows with this action type that fall
// inside the alert window before each test, plus any tagged rows from this
// file (which may have been inserted with a backdated createdAt outside the
// window). We never run this in parallel with other suites — the api-server
// vitest config sets `pool: "forks"` with `singleFork: true`.
const ALERT_WINDOW_MS = 15 * 60 * 1000;

async function isolateRecentRows() {
  await db
    .delete(auditLogTable)
    .where(
      and(
        eq(auditLogTable.actionType, AUTH_RATE_LIMIT_AUDIT_ACTION),
        gte(auditLogTable.createdAt, new Date(Date.now() - ALERT_WINDOW_MS - 60_000)),
      ),
    );
  // Backdated rows from this file (createdAt outside the window above).
  await db
    .delete(auditLogTable)
    .where(
      and(
        eq(auditLogTable.actionType, AUTH_RATE_LIMIT_AUDIT_ACTION),
        like(auditLogTable.description, "[needs-attention-rl-%"),
      ),
    );
  // Each `/needs-attention` call now also runs the auth-rate-limit alerter,
  // which writes one `auth_rate_limit_alert` row per delivery channel on a
  // state transition. Wipe those between tests so they don't leak into the
  // shared audit table or accumulate over re-runs of this suite.
  await db
    .delete(auditLogTable)
    .where(eq(auditLogTable.actionType, AUTH_RATE_LIMIT_ALERT_ACTION_TYPE));
  // Wipe any threshold-edit audit rows so the burst alert's `lastTuned`
  // provenance starts each test from a clean slate. The alert-config
  // suite has its own cleanup but this file shares the same audit table,
  // so we belt-and-brace here too.
  await db
    .delete(auditLogTable)
    .where(eq(auditLogTable.entityType, "auth_rate_limit_alert_config"));
}

afterAll(async () => {
  await isolateRecentRows();
  __resetAuthRateLimitAlerterForTests();
  await db.delete(usersTable).where(inArray(usersTable.id, [adminUserId]));
});

beforeEach(async () => {
  // Reset the in-memory alerter state too — without this the singleton would
  // remember "alerting" across tests and a later test could fire spurious
  // clear/fire transitions (and audit rows) when it shouldn't.
  __resetAuthRateLimitAlerterForTests();
  await isolateRecentRows();
});

describe("GET /admin/dashboard/needs-attention — auth rate-limit burst alert", () => {
  it("does not surface an alert when activity is below the threshold", async () => {
    for (let i = 0; i < 5; i++) {
      await insertRateLimitRow({ ip: "10.0.0.1", minutesAgo: 1 });
    }

    const res = await request(app)
      .get("/api/admin/dashboard/needs-attention")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const burst = (res.body as any[]).find((a) => a.type === "auth_rate_limit_burst");
    expect(burst).toBeUndefined();
  });

  it("surfaces a burst alert with the dominant IP when ≥10 hits come from one source", async () => {
    for (let i = 0; i < 12; i++) {
      await insertRateLimitRow({ ip: "203.0.113.7", minutesAgo: i % 10 });
    }

    const res = await request(app)
      .get("/api/admin/dashboard/needs-attention")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const burst = (res.body as any[]).find((a) => a.type === "auth_rate_limit_burst");
    expect(burst).toBeDefined();
    expect(burst.severity).toBe("high");
    expect(burst.description).toContain("12 auth rate-limit hits");
    expect(burst.description).toContain("203.0.113.7");
    expect(burst.link).toBe(`/admin/audit-log?actionType=${AUTH_RATE_LIMIT_AUDIT_ACTION}`);
  });

  it("omits the dominant-IP suffix when the burst is spread across many IPs", async () => {
    for (let i = 0; i < 12; i++) {
      await insertRateLimitRow({ ip: `198.51.100.${i + 1}`, minutesAgo: 2 });
    }

    const res = await request(app)
      .get("/api/admin/dashboard/needs-attention")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const burst = (res.body as any[]).find((a) => a.type === "auth_rate_limit_burst");
    expect(burst).toBeDefined();
    expect(burst.description).toContain("12 auth rate-limit hits");
    expect(burst.description).not.toContain("from 198.51.100.");
  });

  it("ignores rate-limit hits older than the 15-minute window", async () => {
    for (let i = 0; i < 20; i++) {
      await insertRateLimitRow({ ip: "203.0.113.99", minutesAgo: 30 });
    }

    const res = await request(app)
      .get("/api/admin/dashboard/needs-attention")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const burst = (res.body as any[]).find((a) => a.type === "auth_rate_limit_burst");
    expect(burst).toBeUndefined();
  });

  // Provenance for the dashboard "tuned to N hits / M min by <admin>"
  // sub-line. The alert payload always carries the live `thresholds` (so
  // the dashboard can render "tuned to N hits / M min" even before any
  // tuning has happened) and a nullable `lastTuned` describing the most
  // recent threshold edit, if any.
  it("includes live thresholds and a null lastTuned when no edits have happened", async () => {
    for (let i = 0; i < 12; i++) {
      await insertRateLimitRow({ ip: "203.0.113.5", minutesAgo: 1 });
    }

    const res = await request(app)
      .get("/api/admin/dashboard/needs-attention")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const burst = (res.body as any[]).find((a) => a.type === "auth_rate_limit_burst");
    expect(burst).toBeDefined();
    expect(burst.thresholds).toEqual({ threshold: 10, windowMinutes: 15 });
    // No edits => null. The dashboard renders this as "still on default
    // thresholds" instead of attributing the value to a phantom admin.
    expect(burst.lastTuned).toBeNull();
  });

  it("populates lastTuned with the most recent edit's actor, timestamp, and changedFields", async () => {
    // Seed a burst so the alert fires.
    for (let i = 0; i < 12; i++) {
      await insertRateLimitRow({ ip: "203.0.113.5", minutesAgo: 1 });
    }
    // Simulate a (much) older edit by some admin.
    await db.insert(auditLogTable).values({
      actorId: adminUserId,
      actorEmail: `${TEST_TAG}-admin@example.test`,
      actionType: "update_setting",
      entityType: "auth_rate_limit_alert_config",
      entityId: "auth_rate_limit_alert",
      description: "Updated auth rate-limit alert config: threshold",
      changeDiff: { changedFields: ["threshold"], diff: { threshold: { from: 10, to: 25 } } },
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    // …and a more recent edit that we expect to be the one surfaced.
    const recentAt = new Date(Date.now() - 5 * 60 * 1000);
    await db.insert(auditLogTable).values({
      actorId: adminUserId,
      actorEmail: `${TEST_TAG}-admin@example.test`,
      actionType: "update_setting",
      entityType: "auth_rate_limit_alert_config",
      entityId: "auth_rate_limit_alert",
      description: "Updated auth rate-limit alert config: windowMinutes, dominantIpRatio",
      changeDiff: {
        changedFields: ["windowMinutes", "dominantIpRatio"],
        diff: {
          windowMinutes: { from: 15, to: 5 },
          dominantIpRatio: { from: 0.6, to: 0.8 },
        },
      },
      createdAt: recentAt,
    });

    const res = await request(app)
      .get("/api/admin/dashboard/needs-attention")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const burst = (res.body as any[]).find((a) => a.type === "auth_rate_limit_burst");
    expect(burst).toBeDefined();
    expect(burst.thresholds.threshold).toBe(10);
    expect(burst.thresholds.windowMinutes).toBe(15);
    expect(burst.lastTuned).not.toBeNull();
    expect(burst.lastTuned.actorId).toBe(adminUserId);
    expect(burst.lastTuned.actorEmail).toBe(`${TEST_TAG}-admin@example.test`);
    expect(burst.lastTuned.actorName).toBe("Test admin");
    expect(burst.lastTuned.changedFields).toEqual(
      expect.arrayContaining(["windowMinutes", "dominantIpRatio"]),
    );
    expect(burst.lastTuned.changedFields).not.toContain("threshold");
    expect(new Date(burst.lastTuned.at).getTime()).toBe(recentAt.getTime());

    // Clean up the audit rows we just inserted so the next test doesn't
    // see stale provenance.
    await db
      .delete(auditLogTable)
      .where(eq(auditLogTable.entityType, "auth_rate_limit_alert_config"));
  });
});
