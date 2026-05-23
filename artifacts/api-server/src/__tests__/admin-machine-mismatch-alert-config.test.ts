import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, systemSettingsTable, auditLogTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";
import {
  MACHINE_MISMATCH_ALERT_DEFAULTS,
  getMachineMismatchAlertSettingKeys,
  __invalidateMachineMismatchAlertConfigCacheForTests,
} from "../lib/machine-mismatch-alert-settings";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `mm-alert-cfg-${randomUUID().slice(0, 8)}`;

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
    .where(inArray(systemSettingsTable.key, getMachineMismatchAlertSettingKeys()));
  __invalidateMachineMismatchAlertConfigCacheForTests();
}

async function clearTestAuditRows() {
  await db
    .delete(auditLogTable)
    .where(eq(auditLogTable.entityType, "machine_mismatch_alert_config"));
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

describe("GET /admin/machine-mismatch-alert-config", () => {
  it("returns defaults with `default` source when nothing is saved", async () => {
    const res = await request(app)
      .get("/api/admin/machine-mismatch-alert-config")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual(MACHINE_MISMATCH_ALERT_DEFAULTS);
    expect(res.body.sources).toEqual({ threshold: "default", windowHours: "default" });
    expect(res.body.defaults).toEqual(MACHINE_MISMATCH_ALERT_DEFAULTS);
    expect(res.body.bounds.threshold.min).toBeGreaterThanOrEqual(1);
    expect(res.body.bounds.windowHours.max).toBe(168);
  });

  it("requires admin auth", async () => {
    const res = await request(app).get("/api/admin/machine-mismatch-alert-config");
    expect(res.status).toBe(401);
  });

  it("rejects non-admin users", async () => {
    const res = await request(app)
      .get("/api/admin/machine-mismatch-alert-config")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });
});

describe("PUT /admin/machine-mismatch-alert-config", () => {
  it("saves valid values, returns the new status, and marks each source as `db`", async () => {
    const res = await request(app)
      .put("/api/admin/machine-mismatch-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: 12, windowHours: 6 });
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual({ threshold: 12, windowHours: 6 });
    expect(res.body.sources).toEqual({ threshold: "db", windowHours: "db" });
    expect(res.body.changedFields).toEqual(
      expect.arrayContaining(["threshold", "windowHours"]),
    );

    const reread = await request(app)
      .get("/api/admin/machine-mismatch-alert-config")
      .set("Cookie", adminCookie);
    expect(reread.body.config).toEqual({ threshold: 12, windowHours: 6 });
  });

  it("accepts partial updates without disturbing other fields", async () => {
    await request(app)
      .put("/api/admin/machine-mismatch-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: 12, windowHours: 6 });
    __invalidateMachineMismatchAlertConfigCacheForTests();

    const res = await request(app)
      .put("/api/admin/machine-mismatch-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: 20 });
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual({ threshold: 20, windowHours: 6 });
    expect(res.body.changedFields).toEqual(["threshold"]);
  });

  it("rejects out-of-bounds windowHours", async () => {
    const res = await request(app)
      .put("/api/admin/machine-mismatch-alert-config")
      .set("Cookie", adminCookie)
      .send({ windowHours: 999 });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "windowHours" })]),
    );
  });

  it("rejects zero threshold", async () => {
    const res = await request(app)
      .put("/api/admin/machine-mismatch-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: 0 });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "threshold" })]),
    );
  });

  it("rejects non-numeric values", async () => {
    const res = await request(app)
      .put("/api/admin/machine-mismatch-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: "ten" });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "threshold" })]),
    );
  });

  it("rejects empty payload", async () => {
    const res = await request(app)
      .put("/api/admin/machine-mismatch-alert-config")
      .set("Cookie", adminCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it("rejects requests from non-admin users", async () => {
    const res = await request(app)
      .put("/api/admin/machine-mismatch-alert-config")
      .set("Cookie", memberCookie)
      .send({ threshold: 20 });
    expect(res.status).toBe(403);
  });

  it("writes an audit row for changed fields with before/after diff", async () => {
    await request(app)
      .put("/api/admin/machine-mismatch-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: 30, windowHours: 12 });

    const rows = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityType, "machine_mismatch_alert_config"));
    expect(rows.length).toBeGreaterThan(0);
    const latest = rows[rows.length - 1];
    expect(latest.actionType).toBe("update_setting");
    expect(latest.actorId).toBe(adminId);
    const diff = latest.changeDiff as Record<string, unknown> | null;
    expect(diff).toBeTruthy();
    expect((diff as any).changedFields).toEqual(
      expect.arrayContaining(["threshold", "windowHours"]),
    );
    expect((diff as any).diff.threshold).toEqual({
      from: MACHINE_MISMATCH_ALERT_DEFAULTS.threshold,
      to: 30,
    });
    expect((diff as any).diff.windowHours).toEqual({
      from: MACHINE_MISMATCH_ALERT_DEFAULTS.windowHours,
      to: 12,
    });
  });

  it("does not write an audit row when the values are unchanged", async () => {
    await request(app)
      .put("/api/admin/machine-mismatch-alert-config")
      .set("Cookie", adminCookie)
      .send({
        threshold: MACHINE_MISMATCH_ALERT_DEFAULTS.threshold,
        windowHours: MACHINE_MISMATCH_ALERT_DEFAULTS.windowHours,
      });
    const rows = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityType, "machine_mismatch_alert_config"));
    expect(rows.length).toBe(0);
  });

  it("treats null as 'reset to default': deletes the row and flips source back to 'default'", async () => {
    const seed = await request(app)
      .put("/api/admin/machine-mismatch-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: 42 });
    expect(seed.status).toBe(200);
    expect(seed.body.sources.threshold).toBe("db");
    expect(seed.body.config.threshold).toBe(42);

    const beforeRows = await db
      .select()
      .from(systemSettingsTable)
      .where(inArray(systemSettingsTable.key, getMachineMismatchAlertSettingKeys()));
    expect(beforeRows.find((r) => r.key.endsWith("threshold"))).toBeTruthy();

    const reset = await request(app)
      .put("/api/admin/machine-mismatch-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: null });
    expect(reset.status).toBe(200);
    expect(reset.body.sources.threshold).toBe("default");
    expect(reset.body.config.threshold).toBe(MACHINE_MISMATCH_ALERT_DEFAULTS.threshold);
    expect(reset.body.changedFields).toEqual(["threshold"]);

    const afterRows = await db
      .select()
      .from(systemSettingsTable)
      .where(inArray(systemSettingsTable.key, getMachineMismatchAlertSettingKeys()));
    expect(afterRows.find((r) => r.key.endsWith("threshold"))).toBeUndefined();
  });

  it("ignores a null reset for a field that is already at its default", async () => {
    const res = await request(app)
      .put("/api/admin/machine-mismatch-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: null, windowHours: null });
    expect(res.status).toBe(200);
    expect(res.body.changedFields).toEqual([]);
    expect(res.body.sources.threshold).toBe("default");

    const rows = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityType, "machine_mismatch_alert_config"));
    expect(rows.length).toBe(0);
  });
});

describe("Generic settings endpoints reject machine mismatch alert keys", () => {
  it("hides the alert config rows from GET /admin/settings", async () => {
    await request(app)
      .put("/api/admin/machine-mismatch-alert-config")
      .set("Cookie", adminCookie)
      .send({ threshold: 30 });

    const res = await request(app)
      .get("/api/admin/settings")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const keys = (res.body as Array<{ key: string }>).map((r) => r.key);
    expect(keys.some((k) => k.startsWith("machine_mismatch_alert."))).toBe(false);
  });

  it("rejects PUT /admin/settings/:key for alert config keys", async () => {
    const res = await request(app)
      .put("/api/admin/settings/machine_mismatch_alert.threshold")
      .set("Cookie", adminCookie)
      .send({ value: 999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/machine-mismatch-alert-config/);
  });
});
