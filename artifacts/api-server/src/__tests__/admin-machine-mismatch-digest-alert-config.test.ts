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
  DIGEST_ALERTER_TUNING_DEFAULTS,
  getDigestAlerterTuningSettingKeys,
  __invalidateDigestAlerterTuningCacheForTests,
} from "../lib/oncall-settings";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `mm-digest-cfg-${randomUUID().slice(0, 8)}`;

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

async function clearTuningRows() {
  await db
    .delete(systemSettingsTable)
    .where(inArray(systemSettingsTable.key, getDigestAlerterTuningSettingKeys()));
  __invalidateDigestAlerterTuningCacheForTests();
}

async function clearTestAuditRows() {
  await db
    .delete(auditLogTable)
    .where(eq(auditLogTable.entityType, "machine_mismatch_digest_alert_config"));
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
  await clearTuningRows();
  await clearTestAuditRows();
  if (seededUserIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(async () => {
  await clearTuningRows();
  await clearTestAuditRows();
});

describe("GET /admin/machine-mismatch-digest-alert-config", () => {
  it("returns defaults with `default` source when nothing is saved", async () => {
    const res = await request(app)
      .get("/api/admin/machine-mismatch-digest-alert-config")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual(DIGEST_ALERTER_TUNING_DEFAULTS);
    expect(res.body.sources).toEqual({
      thresholdMultiplier: "default",
      notificationThrottleMs: "default",
    });
    expect(res.body.defaults).toEqual(DIGEST_ALERTER_TUNING_DEFAULTS);
    expect(res.body.bounds.thresholdMultiplier.min).toBeGreaterThanOrEqual(1);
    expect(res.body.bounds.notificationThrottleMs.min).toBe(0);
  });

  it("requires admin auth", async () => {
    const res = await request(app).get("/api/admin/machine-mismatch-digest-alert-config");
    expect(res.status).toBe(401);
  });

  it("rejects non-admin users", async () => {
    const res = await request(app)
      .get("/api/admin/machine-mismatch-digest-alert-config")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });
});

describe("PUT /admin/machine-mismatch-digest-alert-config", () => {
  it("saves valid values, returns the new status, and marks each source as `db`", async () => {
    const res = await request(app)
      .put("/api/admin/machine-mismatch-digest-alert-config")
      .set("Cookie", adminCookie)
      .send({ thresholdMultiplier: 3, notificationThrottleMs: 1800000 });
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual({
      thresholdMultiplier: 3,
      notificationThrottleMs: 1800000,
    });
    expect(res.body.sources).toEqual({
      thresholdMultiplier: "db",
      notificationThrottleMs: "db",
    });
    expect(res.body.changedFields).toEqual(
      expect.arrayContaining(["thresholdMultiplier", "notificationThrottleMs"]),
    );

    const reread = await request(app)
      .get("/api/admin/machine-mismatch-digest-alert-config")
      .set("Cookie", adminCookie);
    expect(reread.body.config).toEqual({
      thresholdMultiplier: 3,
      notificationThrottleMs: 1800000,
    });
  });

  it("accepts a fractional threshold multiplier", async () => {
    const res = await request(app)
      .put("/api/admin/machine-mismatch-digest-alert-config")
      .set("Cookie", adminCookie)
      .send({ thresholdMultiplier: 1.5 });
    expect(res.status).toBe(200);
    expect(res.body.config.thresholdMultiplier).toBe(1.5);
  });

  it("accepts partial updates without disturbing other fields", async () => {
    await request(app)
      .put("/api/admin/machine-mismatch-digest-alert-config")
      .set("Cookie", adminCookie)
      .send({ thresholdMultiplier: 3, notificationThrottleMs: 1800000 });
    __invalidateDigestAlerterTuningCacheForTests();

    const res = await request(app)
      .put("/api/admin/machine-mismatch-digest-alert-config")
      .set("Cookie", adminCookie)
      .send({ thresholdMultiplier: 5 });
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual({
      thresholdMultiplier: 5,
      notificationThrottleMs: 1800000,
    });
    expect(res.body.changedFields).toEqual(["thresholdMultiplier"]);
  });

  it("rejects out-of-bounds throttle", async () => {
    const res = await request(app)
      .put("/api/admin/machine-mismatch-digest-alert-config")
      .set("Cookie", adminCookie)
      .send({ notificationThrottleMs: 999999999999 });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "notificationThrottleMs" }),
      ]),
    );
  });

  it("rejects a zero threshold multiplier", async () => {
    const res = await request(app)
      .put("/api/admin/machine-mismatch-digest-alert-config")
      .set("Cookie", adminCookie)
      .send({ thresholdMultiplier: 0 });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "thresholdMultiplier" }),
      ]),
    );
  });

  it("truncates a fractional throttle to whole milliseconds", async () => {
    const res = await request(app)
      .put("/api/admin/machine-mismatch-digest-alert-config")
      .set("Cookie", adminCookie)
      .send({ notificationThrottleMs: 1000.5 });
    expect(res.status).toBe(200);
    expect(res.body.config.notificationThrottleMs).toBe(1000);
  });

  it("rejects non-numeric values", async () => {
    const res = await request(app)
      .put("/api/admin/machine-mismatch-digest-alert-config")
      .set("Cookie", adminCookie)
      .send({ thresholdMultiplier: "two" });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "thresholdMultiplier" }),
      ]),
    );
  });

  it("rejects empty payload", async () => {
    const res = await request(app)
      .put("/api/admin/machine-mismatch-digest-alert-config")
      .set("Cookie", adminCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it("rejects requests from non-admin users", async () => {
    const res = await request(app)
      .put("/api/admin/machine-mismatch-digest-alert-config")
      .set("Cookie", memberCookie)
      .send({ thresholdMultiplier: 5 });
    expect(res.status).toBe(403);
  });

  it("writes an audit row for changed fields with before/after diff", async () => {
    await request(app)
      .put("/api/admin/machine-mismatch-digest-alert-config")
      .set("Cookie", adminCookie)
      .send({ thresholdMultiplier: 4, notificationThrottleMs: 1800000 });

    const rows = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityType, "machine_mismatch_digest_alert_config"));
    expect(rows.length).toBeGreaterThan(0);
    const latest = rows[rows.length - 1];
    expect(latest.actionType).toBe("update_setting");
    expect(latest.actorId).toBe(adminId);
    const diff = latest.changeDiff as Record<string, unknown> | null;
    expect(diff).toBeTruthy();
    expect((diff as any).changedFields).toEqual(
      expect.arrayContaining(["thresholdMultiplier", "notificationThrottleMs"]),
    );
    expect((diff as any).diff.thresholdMultiplier).toEqual({
      from: DIGEST_ALERTER_TUNING_DEFAULTS.thresholdMultiplier,
      to: 4,
    });
    expect((diff as any).diff.notificationThrottleMs).toEqual({
      from: DIGEST_ALERTER_TUNING_DEFAULTS.notificationThrottleMs,
      to: 1800000,
    });
  });

  it("does not write an audit row when the values are unchanged", async () => {
    await request(app)
      .put("/api/admin/machine-mismatch-digest-alert-config")
      .set("Cookie", adminCookie)
      .send({
        thresholdMultiplier: DIGEST_ALERTER_TUNING_DEFAULTS.thresholdMultiplier,
        notificationThrottleMs: DIGEST_ALERTER_TUNING_DEFAULTS.notificationThrottleMs,
      });
    const rows = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityType, "machine_mismatch_digest_alert_config"));
    expect(rows.length).toBe(0);
  });

  it("treats null as 'reset to default': deletes the row and flips source back to 'default'", async () => {
    const seed = await request(app)
      .put("/api/admin/machine-mismatch-digest-alert-config")
      .set("Cookie", adminCookie)
      .send({ thresholdMultiplier: 7 });
    expect(seed.status).toBe(200);
    expect(seed.body.sources.thresholdMultiplier).toBe("db");
    expect(seed.body.config.thresholdMultiplier).toBe(7);

    const beforeRows = await db
      .select()
      .from(systemSettingsTable)
      .where(inArray(systemSettingsTable.key, getDigestAlerterTuningSettingKeys()));
    expect(
      beforeRows.find((r) => r.key.endsWith("threshold_multiplier")),
    ).toBeTruthy();

    const reset = await request(app)
      .put("/api/admin/machine-mismatch-digest-alert-config")
      .set("Cookie", adminCookie)
      .send({ thresholdMultiplier: null });
    expect(reset.status).toBe(200);
    expect(reset.body.sources.thresholdMultiplier).toBe("default");
    expect(reset.body.config.thresholdMultiplier).toBe(
      DIGEST_ALERTER_TUNING_DEFAULTS.thresholdMultiplier,
    );
    expect(reset.body.changedFields).toEqual(["thresholdMultiplier"]);

    const afterRows = await db
      .select()
      .from(systemSettingsTable)
      .where(inArray(systemSettingsTable.key, getDigestAlerterTuningSettingKeys()));
    expect(
      afterRows.find((r) => r.key.endsWith("threshold_multiplier")),
    ).toBeUndefined();
  });

  it("ignores a null reset for a field that is already at its default", async () => {
    const res = await request(app)
      .put("/api/admin/machine-mismatch-digest-alert-config")
      .set("Cookie", adminCookie)
      .send({ thresholdMultiplier: null, notificationThrottleMs: null });
    expect(res.status).toBe(200);
    expect(res.body.changedFields).toEqual([]);
    expect(res.body.sources.thresholdMultiplier).toBe("default");

    const rows = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityType, "machine_mismatch_digest_alert_config"));
    expect(rows.length).toBe(0);
  });
});

describe("Generic settings endpoints reject digest alerter tuning keys", () => {
  it("hides the tuning rows from GET /admin/settings", async () => {
    await request(app)
      .put("/api/admin/machine-mismatch-digest-alert-config")
      .set("Cookie", adminCookie)
      .send({ thresholdMultiplier: 4 });

    const res = await request(app)
      .get("/api/admin/settings")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const keys = (res.body as Array<{ key: string }>).map((r) => r.key);
    expect(
      keys.some((k) => k.startsWith("oncall.machine_mismatch_digest_")),
    ).toBe(false);
  });
});
