import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, systemSettingsTable, auditLogTable } from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";
import {
  AUTH_RATE_LIMIT_ALERT_DEFAULTS,
  getAuthRateLimitAlertSettingKeys,
  __invalidateAuthRateLimitAlertConfigCacheForTests,
} from "../lib/auth-rate-limit-alert-settings";
import { AUTH_RATE_LIMIT_AUDIT_ACTION, AUTH_RATE_LIMIT_AUDIT_ENTITY } from "../routes/auth";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `arl-alert-cfg-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let memberCookie: string;
let adminId: number;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(role: string, suffix: string): Promise<{ id: number; email: string }> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test ${suffix}`,
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email };
}

async function clearAlertConfigRows() {
  await db
    .delete(systemSettingsTable)
    .where(inArray(systemSettingsTable.key, getAuthRateLimitAlertSettingKeys()));
  __invalidateAuthRateLimitAlertConfigCacheForTests();
}

async function clearTestAuditRows() {
  // Clear any test-related rate-limit rows so the dashboard test starts clean.
  await db
    .delete(auditLogTable)
    .where(like(auditLogTable.description, `[${TEST_TAG}]%`));
  // Also clear any audit rows the alert-config endpoint wrote in earlier
  // tests — they don't carry our tag because they're written by the route,
  // and they accumulate across tests in the same file otherwise.
  await db
    .delete(auditLogTable)
    .where(eq(auditLogTable.entityType, "auth_rate_limit_alert_config"));
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);
  const admin = await insertUser("super_admin", "admin");
  const member = await insertUser("member", "non-admin");
  adminId = admin.id;
  adminCookie = signCookie(admin.id, admin.email);
  memberCookie = signCookie(member.id, member.email);
});

afterAll(async () => {
  await clearAlertConfigRows();
  await clearTestAuditRows();
  if (seededUserIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(async () => {
  await clearAlertConfigRows();
  await clearTestAuditRows();
});

describe("GET /admin/auth-rate-limit-alert-config", () => {
  it("returns defaults with `default` source when nothing is saved", async () => {
    const res = await request(app)
      .get("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual(AUTH_RATE_LIMIT_ALERT_DEFAULTS);
    expect(res.body.sources).toEqual({
      threshold: "default",
      windowMinutes: "default",
      dominantIpRatio: "default",
    });
    expect(res.body.defaults).toEqual(AUTH_RATE_LIMIT_ALERT_DEFAULTS);
    expect(res.body.bounds.threshold.min).toBeGreaterThanOrEqual(1);
    expect(res.body.bounds.windowMinutes.max).toBe(60);
    expect(res.body.bounds.dominantIpRatio.max).toBe(1);
  });

  it("requires admin auth", async () => {
    const res = await request(app).get("/api/admin/auth-rate-limit-alert-config");
    expect(res.status).toBe(401);
  });

  it("rejects non-admin users", async () => {
    const res = await request(app)
      .get("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });
});

describe("PUT /admin/auth-rate-limit-alert-config", () => {
  it("saves valid values, returns the new status, and marks each source as `db`", async () => {
    const res = await request(app)
      .put("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: 25, windowMinutes: 5, dominantIpRatio: 0.8 });
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual({ threshold: 25, windowMinutes: 5, dominantIpRatio: 0.8 });
    expect(res.body.sources).toEqual({
      threshold: "db",
      windowMinutes: "db",
      dominantIpRatio: "db",
    });
    expect(res.body.changedFields).toEqual(
      expect.arrayContaining(["threshold", "windowMinutes", "dominantIpRatio"]),
    );

    const reread = await request(app)
      .get("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie);
    expect(reread.body.config).toEqual({ threshold: 25, windowMinutes: 5, dominantIpRatio: 0.8 });
  });

  it("accepts partial updates without disturbing other fields", async () => {
    await request(app)
      .put("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: 25, windowMinutes: 5, dominantIpRatio: 0.8 });
    __invalidateAuthRateLimitAlertConfigCacheForTests();

    const res = await request(app)
      .put("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: 50 });
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual({ threshold: 50, windowMinutes: 5, dominantIpRatio: 0.8 });
    expect(res.body.changedFields).toEqual(["threshold"]);
  });

  it("rejects out-of-bounds window minutes", async () => {
    const res = await request(app)
      .put("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie)
      .send({ windowMinutes: 120 });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "windowMinutes" }),
      ]),
    );
  });

  it("rejects negative threshold", async () => {
    const res = await request(app)
      .put("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: -1 });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "threshold" }),
      ]),
    );
  });

  it("rejects dominantIpRatio above 1", async () => {
    const res = await request(app)
      .put("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie)
      .send({ dominantIpRatio: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "dominantIpRatio" }),
      ]),
    );
  });

  it("rejects non-numeric values", async () => {
    const res = await request(app)
      .put("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: "ten" });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "threshold" }),
      ]),
    );
  });

  it("rejects empty payload", async () => {
    const res = await request(app)
      .put("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it("rejects requests from non-admin users", async () => {
    const res = await request(app)
      .put("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", memberCookie)
      .send({ threshold: 20 });
    expect(res.status).toBe(403);
  });

  it("writes an audit row for changed fields with before/after diff", async () => {
    await request(app)
      .put("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: 30, windowMinutes: 5 });

    const rows = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityType, "auth_rate_limit_alert_config"));
    expect(rows.length).toBeGreaterThan(0);
    const latest = rows[rows.length - 1];
    expect(latest.actionType).toBe("update_setting");
    expect(latest.actorId).toBe(adminId);
    const diff = latest.changeDiff as Record<string, unknown> | null;
    expect(diff).toBeTruthy();
    expect((diff as any).changedFields).toEqual(
      expect.arrayContaining(["threshold", "windowMinutes"]),
    );
    expect((diff as any).diff.threshold).toEqual({
      from: AUTH_RATE_LIMIT_ALERT_DEFAULTS.threshold,
      to: 30,
    });
    expect((diff as any).diff.windowMinutes).toEqual({
      from: AUTH_RATE_LIMIT_ALERT_DEFAULTS.windowMinutes,
      to: 5,
    });
  });

  it("does not write an audit row when the values are unchanged", async () => {
    await request(app)
      .put("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie)
      .send({
        threshold: AUTH_RATE_LIMIT_ALERT_DEFAULTS.threshold,
        windowMinutes: AUTH_RATE_LIMIT_ALERT_DEFAULTS.windowMinutes,
        dominantIpRatio: AUTH_RATE_LIMIT_ALERT_DEFAULTS.dominantIpRatio,
      });
    const rows = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityType, "auth_rate_limit_alert_config"));
    expect(rows.length).toBe(0);
  });

  it("treats null as 'reset to default': deletes the row and flips source back to 'default'", async () => {
    // First: customize the threshold so source becomes "db".
    const seed = await request(app)
      .put("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: 42 });
    expect(seed.status).toBe(200);
    expect(seed.body.sources.threshold).toBe("db");
    expect(seed.body.config.threshold).toBe(42);

    // Verify a row actually exists in system_settings.
    const beforeRows = await db
      .select()
      .from(systemSettingsTable)
      .where(inArray(systemSettingsTable.key, getAuthRateLimitAlertSettingKeys()));
    expect(beforeRows.find((r) => r.key.endsWith("threshold"))).toBeTruthy();

    // Now: reset by sending null. Source should flip back to "default" and
    // the value should equal the default again.
    const reset = await request(app)
      .put("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: null });
    expect(reset.status).toBe(200);
    expect(reset.body.sources.threshold).toBe("default");
    expect(reset.body.config.threshold).toBe(AUTH_RATE_LIMIT_ALERT_DEFAULTS.threshold);
    expect(reset.body.changedFields).toEqual(["threshold"]);

    // The row must actually be gone (not just overwritten with the default
    // value) — that's what makes the "Customized" badge disappear.
    const afterRows = await db
      .select()
      .from(systemSettingsTable)
      .where(inArray(systemSettingsTable.key, getAuthRateLimitAlertSettingKeys()));
    expect(afterRows.find((r) => r.key.endsWith("threshold"))).toBeUndefined();
  });

  it("ignores a null reset for a field that is already at its default", async () => {
    const res = await request(app)
      .put("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: null, windowMinutes: null, dominantIpRatio: null });
    expect(res.status).toBe(200);
    expect(res.body.changedFields).toEqual([]);
    expect(res.body.sources.threshold).toBe("default");

    // No audit row should be written when nothing changed.
    const rows = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityType, "auth_rate_limit_alert_config"));
    expect(rows.length).toBe(0);
  });

  it("supports a mixed payload: set one field, reset another", async () => {
    // Seed: customize both threshold and windowMinutes.
    await request(app)
      .put("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: 30, windowMinutes: 5 });

    // Reset windowMinutes via null while bumping threshold to 25.
    const res = await request(app)
      .put("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: 25, windowMinutes: null });
    expect(res.status).toBe(200);
    expect(res.body.config.threshold).toBe(25);
    expect(res.body.config.windowMinutes).toBe(AUTH_RATE_LIMIT_ALERT_DEFAULTS.windowMinutes);
    expect(res.body.sources.threshold).toBe("db");
    expect(res.body.sources.windowMinutes).toBe("default");
    expect(res.body.changedFields).toEqual(
      expect.arrayContaining(["threshold", "windowMinutes"]),
    );
  });
});

describe("Generic settings endpoints reject auth rate-limit alert keys", () => {
  it("hides the alert config rows from GET /admin/settings", async () => {
    await request(app)
      .put("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: 30 });

    const res = await request(app)
      .get("/api/admin/settings")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const keys = (res.body as Array<{ key: string }>).map((r) => r.key);
    expect(keys.some((k) => k.startsWith("auth_rate_limit_alert."))).toBe(false);
  });

  it("rejects PUT /admin/settings/:key for alert config keys", async () => {
    const res = await request(app)
      .put("/api/admin/settings/auth_rate_limit_alert.threshold")
      .set("Cookie", adminCookie)
      .send({ value: 999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/auth-rate-limit-alert-config/);
  });
});

describe("GET /admin/dashboard/needs-attention reads the configured thresholds", () => {
  // Helper that mints a backdated rate-limit audit row with this suite's tag.
  async function insertHit(opts: { ip: string | null; minutesAgo: number }) {
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

  beforeEach(async () => {
    // The other rate-limit-burst test suite shares this dashboard endpoint so
    // we have to wipe ALL recent rows, not just our tagged ones, to keep the
    // total count assertion hermetic. Vitest is configured with singleFork so
    // suites do not run in parallel.
    await db
      .delete(auditLogTable)
      .where(eq(auditLogTable.actionType, AUTH_RATE_LIMIT_AUDIT_ACTION));
  });

  it("uses a tightened threshold so a smaller burst now fires", async () => {
    // Save a much lower threshold and a 5-minute window.
    await request(app)
      .put("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: 3, windowMinutes: 5 });
    __invalidateAuthRateLimitAlertConfigCacheForTests();

    // 4 hits — below the default of 10 but above the new threshold of 3.
    for (let i = 0; i < 4; i++) {
      await insertHit({ ip: "203.0.113.42", minutesAgo: 1 });
    }

    const res = await request(app)
      .get("/api/admin/dashboard/needs-attention")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const burst = (res.body as Array<{ type: string; description: string }>).find(
      (a) => a.type === "auth_rate_limit_burst",
    );
    expect(burst).toBeDefined();
    expect(burst!.description).toContain("4 auth rate-limit hits");
    expect(burst!.description).toContain("in the last 5 minutes");
  });

  it("uses a relaxed threshold so a previously-alerting burst no longer fires", async () => {
    await request(app)
      .put("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: 50 });
    __invalidateAuthRateLimitAlertConfigCacheForTests();

    // 12 hits would have tripped the default threshold of 10 — under the new
    // threshold of 50 the dashboard stays quiet.
    for (let i = 0; i < 12; i++) {
      await insertHit({ ip: "203.0.113.43", minutesAgo: 1 });
    }

    const res = await request(app)
      .get("/api/admin/dashboard/needs-attention")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const burst = (res.body as Array<{ type: string }>).find(
      (a) => a.type === "auth_rate_limit_burst",
    );
    expect(burst).toBeUndefined();
  });

  it("uses a tightened dominantIpRatio so a single IP is no longer called out by name", async () => {
    // Default dominant ratio is 0.6; raise it to 0.95 so 12-of-15 (80%)
    // is no longer enough to call the IP out by name.
    await request(app)
      .put("/api/admin/auth-rate-limit-alert-config")
      .set("Cookie", adminCookie)
      .send({ dominantIpRatio: 0.95 });
    __invalidateAuthRateLimitAlertConfigCacheForTests();

    for (let i = 0; i < 12; i++) {
      await insertHit({ ip: "203.0.113.44", minutesAgo: 1 });
    }
    for (let i = 0; i < 3; i++) {
      await insertHit({ ip: `198.51.100.${i + 1}`, minutesAgo: 1 });
    }

    const res = await request(app)
      .get("/api/admin/dashboard/needs-attention")
      .set("Cookie", adminCookie);
    const burst = (res.body as Array<{ type: string; description: string }>).find(
      (a) => a.type === "auth_rate_limit_burst",
    );
    expect(burst).toBeDefined();
    expect(burst!.description).toContain("15 auth rate-limit hits");
    expect(burst!.description).not.toContain("203.0.113.44");
  });
});
