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
  AI_MODERATION_THRESHOLD_DEFAULTS,
  getAiModerationThresholdSettingKeys,
  __invalidateAiModerationThresholdConfigCacheForTests,
} from "../lib/moderation/ai-threshold-settings";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `ai-mod-thr-${randomUUID().slice(0, 8)}`;

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

async function clearConfigRows() {
  await db
    .delete(systemSettingsTable)
    .where(inArray(systemSettingsTable.key, getAiModerationThresholdSettingKeys()));
  __invalidateAiModerationThresholdConfigCacheForTests();
}

async function clearAuditRows() {
  await db
    .delete(auditLogTable)
    .where(eq(auditLogTable.entityType, "ai_moderation_threshold_config"));
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
  await clearConfigRows();
  await clearAuditRows();
  if (seededUserIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(async () => {
  await clearConfigRows();
  await clearAuditRows();
});

describe("GET /admin/ai-moderation-threshold-config", () => {
  it("returns the default with `default` source when nothing is saved", async () => {
    const res = await request(app)
      .get("/api/admin/ai-moderation-threshold-config")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual(AI_MODERATION_THRESHOLD_DEFAULTS);
    expect(res.body.sources).toEqual({ flagThreshold: "default" });
    expect(res.body.defaults).toEqual(AI_MODERATION_THRESHOLD_DEFAULTS);
    expect(res.body.bounds.flagThreshold).toEqual({ min: 0, max: 1 });
  });

  it("requires admin auth", async () => {
    const res = await request(app).get("/api/admin/ai-moderation-threshold-config");
    expect(res.status).toBe(401);
  });

  it("rejects non-admin users", async () => {
    const res = await request(app)
      .get("/api/admin/ai-moderation-threshold-config")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });
});

describe("PUT /admin/ai-moderation-threshold-config", () => {
  it("saves a valid threshold, returns the new status, and marks source as `db`", async () => {
    const res = await request(app)
      .put("/api/admin/ai-moderation-threshold-config")
      .set("Cookie", adminCookie)
      .send({ flagThreshold: 0.75 });
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual({ flagThreshold: 0.75 });
    expect(res.body.sources).toEqual({ flagThreshold: "db" });
    expect(res.body.changedFields).toEqual(["flagThreshold"]);

    const reread = await request(app)
      .get("/api/admin/ai-moderation-threshold-config")
      .set("Cookie", adminCookie);
    expect(reread.body.config).toEqual({ flagThreshold: 0.75 });
  });

  it("rejects out-of-bounds (> 1) values", async () => {
    const res = await request(app)
      .put("/api/admin/ai-moderation-threshold-config")
      .set("Cookie", adminCookie)
      .send({ flagThreshold: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "flagThreshold" })]),
    );
  });

  it("rejects negative values", async () => {
    const res = await request(app)
      .put("/api/admin/ai-moderation-threshold-config")
      .set("Cookie", adminCookie)
      .send({ flagThreshold: -0.1 });
    expect(res.status).toBe(400);
  });

  it("rejects non-numeric values", async () => {
    const res = await request(app)
      .put("/api/admin/ai-moderation-threshold-config")
      .set("Cookie", adminCookie)
      .send({ flagThreshold: "half" });
    expect(res.status).toBe(400);
  });

  it("rejects empty payload", async () => {
    const res = await request(app)
      .put("/api/admin/ai-moderation-threshold-config")
      .set("Cookie", adminCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it("rejects requests from non-admin users", async () => {
    const res = await request(app)
      .put("/api/admin/ai-moderation-threshold-config")
      .set("Cookie", memberCookie)
      .send({ flagThreshold: 0.6 });
    expect(res.status).toBe(403);
  });

  it("writes an audit row with before/after diff", async () => {
    await request(app)
      .put("/api/admin/ai-moderation-threshold-config")
      .set("Cookie", adminCookie)
      .send({ flagThreshold: 0.7 });

    const rows = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityType, "ai_moderation_threshold_config"));
    expect(rows.length).toBe(1);
    const latest = rows[0];
    expect(latest.actionType).toBe("update_setting");
    expect(latest.actorId).toBe(adminId);
    const diff = latest.changeDiff as Record<string, unknown> | null;
    expect((diff as any).changedFields).toEqual(["flagThreshold"]);
    expect((diff as any).diff.flagThreshold).toEqual({
      from: AI_MODERATION_THRESHOLD_DEFAULTS.flagThreshold,
      to: 0.7,
    });
  });

  it("does not write an audit row when the value is unchanged", async () => {
    await request(app)
      .put("/api/admin/ai-moderation-threshold-config")
      .set("Cookie", adminCookie)
      .send({ flagThreshold: AI_MODERATION_THRESHOLD_DEFAULTS.flagThreshold });
    const rows = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityType, "ai_moderation_threshold_config"));
    expect(rows.length).toBe(0);
  });

  it("treats null as 'reset to default': deletes the row and flips source back to 'default'", async () => {
    const seed = await request(app)
      .put("/api/admin/ai-moderation-threshold-config")
      .set("Cookie", adminCookie)
      .send({ flagThreshold: 0.8 });
    expect(seed.body.sources.flagThreshold).toBe("db");

    const reset = await request(app)
      .put("/api/admin/ai-moderation-threshold-config")
      .set("Cookie", adminCookie)
      .send({ flagThreshold: null });
    expect(reset.status).toBe(200);
    expect(reset.body.sources.flagThreshold).toBe("default");
    expect(reset.body.config.flagThreshold).toBe(AI_MODERATION_THRESHOLD_DEFAULTS.flagThreshold);
    expect(reset.body.changedFields).toEqual(["flagThreshold"]);

    const afterRows = await db
      .select()
      .from(systemSettingsTable)
      .where(inArray(systemSettingsTable.key, getAiModerationThresholdSettingKeys()));
    expect(afterRows.length).toBe(0);
  });
});

describe("Generic settings endpoints reject AI moderation threshold keys", () => {
  it("hides the threshold rows from GET /admin/settings", async () => {
    await request(app)
      .put("/api/admin/ai-moderation-threshold-config")
      .set("Cookie", adminCookie)
      .send({ flagThreshold: 0.7 });

    const res = await request(app)
      .get("/api/admin/settings")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const keys = (res.body as Array<{ key: string }>).map((r) => r.key);
    expect(keys.some((k) => k.startsWith("ai_moderation."))).toBe(false);
  });

  it("rejects PUT /admin/settings/:key for AI moderation threshold keys", async () => {
    const res = await request(app)
      .put("/api/admin/settings/ai_moderation.flag_threshold")
      .set("Cookie", adminCookie)
      .send({ value: 0.9 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ai-moderation-threshold-config/);
  });
});

describe("Engine reads the configured threshold at evaluate-time", () => {
  it("uses a saved tighter threshold so a previously-clean score now flags", async () => {
    vi.resetModules();
    vi.doMock("../lib/moderation/wordlist", () => ({
      scanContent: async () => [],
    }));
    vi.doMock("../lib/moderation/classifier", () => ({
      classifyContent: async () => ({ toxicity: 0.4, spam: 0, harassment: 0, hate_speech: 0 }),
    }));

    // Defaults (0.5): 0.4 toxicity should NOT flag.
    await clearConfigRows();
    {
      const { evaluate } = await import("../lib/moderation/engine");
      const result = await evaluate({ body: "x", targetType: "post", authorId: 1 });
      expect(result.flagged).toBe(false);
    }

    // Save 0.3 — same 0.4 score should now exceed and flag.
    await request(app)
      .put("/api/admin/ai-moderation-threshold-config")
      .set("Cookie", adminCookie)
      .send({ flagThreshold: 0.3 });
    __invalidateAiModerationThresholdConfigCacheForTests();
    // The engine + ai-threshold-settings imported above came from the
    // module graph created by the first `vi.resetModules()` call, which is
    // a *different* instance than the one the top-of-file static imports
    // (and the admin-panel router) hold. Invalidate the engine's instance
    // directly via dynamic import so the next evaluate() re-reads from DB.
    const settingsModule = await import("../lib/moderation/ai-threshold-settings");
    settingsModule.__invalidateAiModerationThresholdConfigCacheForTests();
    {
      const { evaluate } = await import("../lib/moderation/engine");
      const result = await evaluate({ body: "x", targetType: "post", authorId: 1 });
      expect(result.flagged).toBe(true);
      expect(result.triggeredBy).toBe("ai_classifier");
    }

    vi.doUnmock("../lib/moderation/wordlist");
    vi.doUnmock("../lib/moderation/classifier");
    vi.resetModules();
  });
});
