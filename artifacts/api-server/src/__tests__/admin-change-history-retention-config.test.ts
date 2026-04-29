import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  systemSettingsTable,
  auditLogTable,
  emailChangeHistoryTable,
  phoneChangeHistoryTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";
import {
  CHANGE_HISTORY_RETENTION_DEFAULTS,
  getChangeHistoryRetentionSettingKeys,
  __invalidateChangeHistoryRetentionConfigCacheForTests,
} from "../lib/change-history-retention-settings";
import { runEmailChangeHistoryCleanup } from "../lib/email-change-history-cleanup";
import { runPhoneChangeHistoryCleanup } from "../lib/phone-change-history-cleanup";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `chr-cfg-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededOldEmails: string[] = [];
const seededOldPhones: string[] = [];
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

async function clearRetentionRows() {
  await db
    .delete(systemSettingsTable)
    .where(inArray(systemSettingsTable.key, getChangeHistoryRetentionSettingKeys()));
  __invalidateChangeHistoryRetentionConfigCacheForTests();
}

async function clearTestAuditRows() {
  await db
    .delete(auditLogTable)
    .where(eq(auditLogTable.entityType, "change_history_retention_config"));
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
  await clearRetentionRows();
  await clearTestAuditRows();
  if (seededOldEmails.length > 0) {
    await db
      .delete(emailChangeHistoryTable)
      .where(inArray(emailChangeHistoryTable.oldEmail, seededOldEmails));
  }
  if (seededOldPhones.length > 0) {
    await db
      .delete(phoneChangeHistoryTable)
      .where(inArray(phoneChangeHistoryTable.oldPhone, seededOldPhones));
  }
  if (seededUserIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(async () => {
  await clearRetentionRows();
  await clearTestAuditRows();
});

describe("GET /admin/change-history-retention-config", () => {
  it("returns defaults with `default` source when nothing is saved", async () => {
    const res = await request(app)
      .get("/api/admin/change-history-retention-config")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual(CHANGE_HISTORY_RETENTION_DEFAULTS);
    expect(res.body.sources).toEqual({
      emailRetentionDays: "default",
      phoneRetentionDays: "default",
    });
    expect(res.body.defaults).toEqual(CHANGE_HISTORY_RETENTION_DEFAULTS);
    expect(res.body.bounds.emailRetentionDays.min).toBeGreaterThanOrEqual(1);
    expect(res.body.bounds.emailRetentionDays.max).toBeGreaterThanOrEqual(365);
    expect(res.body.bounds.phoneRetentionDays.min).toBeGreaterThanOrEqual(1);
    expect(res.body.bounds.phoneRetentionDays.max).toBeGreaterThanOrEqual(365);
  });

  it("requires admin auth", async () => {
    const res = await request(app).get("/api/admin/change-history-retention-config");
    expect(res.status).toBe(401);
  });

  it("rejects non-admin users", async () => {
    const res = await request(app)
      .get("/api/admin/change-history-retention-config")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });
});

describe("PUT /admin/change-history-retention-config", () => {
  it("saves valid values, returns the new status, and marks each source as `db`", async () => {
    const res = await request(app)
      .put("/api/admin/change-history-retention-config")
      .set("Cookie", adminCookie)
      .send({ emailRetentionDays: 30, phoneRetentionDays: 14 });
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual({ emailRetentionDays: 30, phoneRetentionDays: 14 });
    expect(res.body.sources).toEqual({
      emailRetentionDays: "db",
      phoneRetentionDays: "db",
    });
    expect(res.body.changedFields).toEqual(
      expect.arrayContaining(["emailRetentionDays", "phoneRetentionDays"]),
    );

    const reread = await request(app)
      .get("/api/admin/change-history-retention-config")
      .set("Cookie", adminCookie);
    expect(reread.body.config).toEqual({ emailRetentionDays: 30, phoneRetentionDays: 14 });
  });

  it("accepts partial updates without disturbing other fields", async () => {
    await request(app)
      .put("/api/admin/change-history-retention-config")
      .set("Cookie", adminCookie)
      .send({ emailRetentionDays: 30, phoneRetentionDays: 14 });
    __invalidateChangeHistoryRetentionConfigCacheForTests();

    const res = await request(app)
      .put("/api/admin/change-history-retention-config")
      .set("Cookie", adminCookie)
      .send({ phoneRetentionDays: 7 });
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual({ emailRetentionDays: 30, phoneRetentionDays: 7 });
    expect(res.body.changedFields).toEqual(["phoneRetentionDays"]);
  });

  it("rejects out-of-bounds retention windows", async () => {
    const res = await request(app)
      .put("/api/admin/change-history-retention-config")
      .set("Cookie", adminCookie)
      .send({ emailRetentionDays: 0 });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "emailRetentionDays" }),
      ]),
    );
  });

  it("rejects ridiculously large windows", async () => {
    const res = await request(app)
      .put("/api/admin/change-history-retention-config")
      .set("Cookie", adminCookie)
      .send({ phoneRetentionDays: 10000 });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "phoneRetentionDays" }),
      ]),
    );
  });

  it("rejects non-numeric values", async () => {
    const res = await request(app)
      .put("/api/admin/change-history-retention-config")
      .set("Cookie", adminCookie)
      .send({ emailRetentionDays: "thirty" });
    expect(res.status).toBe(400);
  });

  it("rejects empty payload", async () => {
    const res = await request(app)
      .put("/api/admin/change-history-retention-config")
      .set("Cookie", adminCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it("rejects requests from non-admin users", async () => {
    const res = await request(app)
      .put("/api/admin/change-history-retention-config")
      .set("Cookie", memberCookie)
      .send({ emailRetentionDays: 30 });
    expect(res.status).toBe(403);
  });

  it("writes an audit row for changed fields with before/after diff", async () => {
    await request(app)
      .put("/api/admin/change-history-retention-config")
      .set("Cookie", adminCookie)
      .send({ emailRetentionDays: 30, phoneRetentionDays: 14 });

    const rows = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityType, "change_history_retention_config"));
    expect(rows.length).toBeGreaterThan(0);
    const latest = rows[rows.length - 1];
    expect(latest.actionType).toBe("update_setting");
    expect(latest.actorId).toBe(adminId);
    const diff = latest.changeDiff as Record<string, unknown> | null;
    expect(diff).toBeTruthy();
    expect((diff as any).changedFields).toEqual(
      expect.arrayContaining(["emailRetentionDays", "phoneRetentionDays"]),
    );
    expect((diff as any).diff.emailRetentionDays).toEqual({
      from: CHANGE_HISTORY_RETENTION_DEFAULTS.emailRetentionDays,
      to: 30,
    });
    expect((diff as any).diff.phoneRetentionDays).toEqual({
      from: CHANGE_HISTORY_RETENTION_DEFAULTS.phoneRetentionDays,
      to: 14,
    });
  });

  it("does not write an audit row when the values are unchanged", async () => {
    await request(app)
      .put("/api/admin/change-history-retention-config")
      .set("Cookie", adminCookie)
      .send({
        emailRetentionDays: CHANGE_HISTORY_RETENTION_DEFAULTS.emailRetentionDays,
        phoneRetentionDays: CHANGE_HISTORY_RETENTION_DEFAULTS.phoneRetentionDays,
      });
    const rows = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityType, "change_history_retention_config"));
    expect(rows.length).toBe(0);
  });

  it("treats null as 'reset to default': deletes the row and flips source back to 'default'", async () => {
    const seed = await request(app)
      .put("/api/admin/change-history-retention-config")
      .set("Cookie", adminCookie)
      .send({ emailRetentionDays: 30 });
    expect(seed.status).toBe(200);
    expect(seed.body.sources.emailRetentionDays).toBe("db");
    expect(seed.body.config.emailRetentionDays).toBe(30);

    const reset = await request(app)
      .put("/api/admin/change-history-retention-config")
      .set("Cookie", adminCookie)
      .send({ emailRetentionDays: null });
    expect(reset.status).toBe(200);
    expect(reset.body.sources.emailRetentionDays).toBe("default");
    expect(reset.body.config.emailRetentionDays).toBe(
      CHANGE_HISTORY_RETENTION_DEFAULTS.emailRetentionDays,
    );
    expect(reset.body.changedFields).toEqual(["emailRetentionDays"]);

    // The row must actually be gone (not just overwritten with the default
    // value) — that's what makes the "Customized" badge disappear.
    const afterRows = await db
      .select()
      .from(systemSettingsTable)
      .where(inArray(systemSettingsTable.key, getChangeHistoryRetentionSettingKeys()));
    expect(afterRows.find((r) => r.key.endsWith("email_days"))).toBeUndefined();
  });
});

describe("Generic settings endpoints reject change-history retention keys", () => {
  it("hides the retention rows from GET /admin/settings", async () => {
    await request(app)
      .put("/api/admin/change-history-retention-config")
      .set("Cookie", adminCookie)
      .send({ emailRetentionDays: 30 });

    const res = await request(app)
      .get("/api/admin/settings")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const keys = (res.body as Array<{ key: string }>).map((r) => r.key);
    expect(keys.some((k) => k.startsWith("change_history_retention."))).toBe(false);
  });

  it("rejects PUT /admin/settings/:key for retention keys", async () => {
    const res = await request(app)
      .put("/api/admin/settings/change_history_retention.email_days")
      .set("Cookie", adminCookie)
      .send({ value: 999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/change-history-retention-config/);
  });
});

describe("Cleanup jobs honor the saved retention windows", () => {
  // Helper to seed an email-change history row at a specific age.
  async function seedEmailHistory(userId: number, daysAgo: number, suffix: string): Promise<string> {
    const oldEmail = `${TEST_TAG}-${suffix}-old@example.test`;
    const newEmail = `${TEST_TAG}-${suffix}-new@example.test`;
    seededOldEmails.push(oldEmail);
    await db.insert(emailChangeHistoryTable).values({
      userId,
      oldEmail,
      newEmail,
      changedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
    });
    return oldEmail;
  }

  async function seedPhoneHistory(userId: number, daysAgo: number, suffix: string): Promise<string> {
    const oldPhone = `${TEST_TAG}-${suffix}-old`;
    const newPhone = `${TEST_TAG}-${suffix}-new`;
    seededOldPhones.push(oldPhone);
    await db.insert(phoneChangeHistoryTable).values({
      userId,
      oldPhone,
      newPhone,
      changedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
    });
    return oldPhone;
  }

  it("email cleanup uses a tighter retention window when one is saved", async () => {
    const user = await insertUser("member", `email-cleanup-${randomUUID().slice(0, 6)}`);
    const ancient = await seedEmailHistory(user.id, 60, "ancient"); // 60d old
    const fresh = await seedEmailHistory(user.id, 5, "fresh");       // 5d old

    // Default 90-day window — both rows survive a cleanup run.
    await runEmailChangeHistoryCleanup();
    const beforeRows = await db
      .select({ oldEmail: emailChangeHistoryTable.oldEmail })
      .from(emailChangeHistoryTable)
      .where(inArray(emailChangeHistoryTable.oldEmail, [ancient, fresh]));
    expect(beforeRows.map((r) => r.oldEmail).sort()).toEqual([ancient, fresh].sort());

    // Tighten to 30 days — the 60d row should now be deleted, the 5d row stays.
    await request(app)
      .put("/api/admin/change-history-retention-config")
      .set("Cookie", adminCookie)
      .send({ emailRetentionDays: 30 });
    __invalidateChangeHistoryRetentionConfigCacheForTests();

    await runEmailChangeHistoryCleanup();
    const afterRows = await db
      .select({ oldEmail: emailChangeHistoryTable.oldEmail })
      .from(emailChangeHistoryTable)
      .where(inArray(emailChangeHistoryTable.oldEmail, [ancient, fresh]));
    expect(afterRows.map((r) => r.oldEmail)).toEqual([fresh]);
  });

  it("phone cleanup uses a tighter retention window when one is saved", async () => {
    const user = await insertUser("member", `phone-cleanup-${randomUUID().slice(0, 6)}`);
    const ancient = await seedPhoneHistory(user.id, 60, "ancient");
    const fresh = await seedPhoneHistory(user.id, 5, "fresh");

    // Default 90-day window — both rows survive a cleanup run.
    await runPhoneChangeHistoryCleanup();
    const beforeRows = await db
      .select({ oldPhone: phoneChangeHistoryTable.oldPhone })
      .from(phoneChangeHistoryTable)
      .where(inArray(phoneChangeHistoryTable.oldPhone, [ancient, fresh]));
    expect(beforeRows.map((r) => r.oldPhone).sort()).toEqual([ancient, fresh].sort());

    // Tighten to 30 days — the 60d row should now be deleted.
    await request(app)
      .put("/api/admin/change-history-retention-config")
      .set("Cookie", adminCookie)
      .send({ phoneRetentionDays: 30 });
    __invalidateChangeHistoryRetentionConfigCacheForTests();

    await runPhoneChangeHistoryCleanup();
    const afterRows = await db
      .select({ oldPhone: phoneChangeHistoryTable.oldPhone })
      .from(phoneChangeHistoryTable)
      .where(inArray(phoneChangeHistoryTable.oldPhone, [ancient, fresh]));
    expect(afterRows.map((r) => r.oldPhone)).toEqual([fresh]);
  });

  it("phone cleanup falls back to the 90-day default when no setting is saved", async () => {
    const user = await insertUser("member", `phone-default-${randomUUID().slice(0, 6)}`);
    const ancient = await seedPhoneHistory(user.id, 120, "default-ancient"); // > 90d
    const fresh = await seedPhoneHistory(user.id, 5, "default-fresh");

    __invalidateChangeHistoryRetentionConfigCacheForTests();
    await runPhoneChangeHistoryCleanup();

    const remaining = await db
      .select({ oldPhone: phoneChangeHistoryTable.oldPhone })
      .from(phoneChangeHistoryTable)
      .where(inArray(phoneChangeHistoryTable.oldPhone, [ancient, fresh]));
    expect(remaining.map((r) => r.oldPhone)).toEqual([fresh]);
  });
});
