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
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";
import {
  PORTAL_URL_SETTING_KEY,
  __invalidatePortalUrlCacheForTests,
} from "../lib/portal-url-settings";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `portal-url-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let memberCookie: string;
let adminId: number;

const ORIGINAL_PORTAL_URL = process.env.PORTAL_URL;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

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

async function clearPortalUrlRow() {
  await db
    .delete(systemSettingsTable)
    .where(eq(systemSettingsTable.key, PORTAL_URL_SETTING_KEY));
  __invalidatePortalUrlCacheForTests();
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
  await clearPortalUrlRow();
  await db
    .delete(auditLogTable)
    .where(eq(auditLogTable.entityType, "portal_url"));
  if (seededUserIds.length > 0) {
    await db
      .delete(auditLogTable)
      .where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  if (ORIGINAL_PORTAL_URL === undefined) {
    delete process.env.PORTAL_URL;
  } else {
    process.env.PORTAL_URL = ORIGINAL_PORTAL_URL;
  }
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});

beforeEach(async () => {
  await clearPortalUrlRow();
  await db
    .delete(auditLogTable)
    .where(eq(auditLogTable.entityType, "portal_url"));
  delete process.env.PORTAL_URL;
  process.env.NODE_ENV = "test";
});

describe("GET /admin/portal-url", () => {
  it("requires admin auth (no cookie -> 401)", async () => {
    const res = await request(app).get("/api/admin/portal-url");
    expect(res.status).toBe(401);
  });

  it("rejects non-admin members with 403", async () => {
    const res = await request(app)
      .get("/api/admin/portal-url")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });

  it("returns null with source=null when nothing is configured in production", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(app)
      .get("/api/admin/portal-url")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ portalUrl: null, source: null });
  });

  it("returns the dev default when nothing is configured outside production", async () => {
    process.env.NODE_ENV = "development";
    const res = await request(app)
      .get("/api/admin/portal-url")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("dev_default");
    expect(typeof res.body.portalUrl).toBe("string");
  });

  it("returns the env-sourced value when only the env var is set", async () => {
    process.env.PORTAL_URL = "https://from-env.example";
    const res = await request(app)
      .get("/api/admin/portal-url")
      .set("Cookie", adminCookie);
    expect(res.body).toEqual({
      portalUrl: "https://from-env.example",
      source: "env",
    });
  });

  it("returns the DB value with source=db once a row exists", async () => {
    await request(app)
      .put("/api/admin/portal-url")
      .set("Cookie", adminCookie)
      .send({ portalUrl: "https://portal.acme.example" });
    const res = await request(app)
      .get("/api/admin/portal-url")
      .set("Cookie", adminCookie);
    expect(res.body).toEqual({
      portalUrl: "https://portal.acme.example",
      source: "db",
    });
  });
});

describe("PUT /admin/portal-url", () => {
  it("saves a valid URL and writes an audit row with before/after", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(app)
      .put("/api/admin/portal-url")
      .set("Cookie", adminCookie)
      .send({ portalUrl: "https://portal.acme.example" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      portalUrl: "https://portal.acme.example",
      source: "db",
    });

    const [row] = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, PORTAL_URL_SETTING_KEY));
    expect(row.value).toBe("https://portal.acme.example");
    expect(row.category).toBe("branding");

    const [entry] = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityType, "portal_url"));
    expect(entry).toBeDefined();
    expect(entry.actionType).toBe("update_setting");
    expect(entry.actorId).toBe(adminId);
    const diff = entry.changeDiff as {
      before?: { portalUrl: string | null; source: string | null };
      after?: { portalUrl: string | null; source: string | null };
    } | null;
    expect(diff?.before).toEqual({ portalUrl: null, source: null });
    expect(diff?.after).toEqual({
      portalUrl: "https://portal.acme.example",
      source: "db",
    });
  });

  it("trims trailing slashes before persisting", async () => {
    const res = await request(app)
      .put("/api/admin/portal-url")
      .set("Cookie", adminCookie)
      .send({ portalUrl: "https://portal.acme.example///" });
    expect(res.status).toBe(200);
    expect(res.body.portalUrl).toBe("https://portal.acme.example");
  });

  it("rejects non-http(s) URLs", async () => {
    const res = await request(app)
      .put("/api/admin/portal-url")
      .set("Cookie", adminCookie)
      .send({ portalUrl: "javascript:alert(1)" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/http or https/i);

    const [row] = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, PORTAL_URL_SETTING_KEY));
    expect(row).toBeUndefined();
  });

  it("rejects relative paths", async () => {
    const res = await request(app)
      .put("/api/admin/portal-url")
      .set("Cookie", adminCookie)
      .send({ portalUrl: "/account" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/absolute/i);
  });

  it("rejects missing portalUrl key", async () => {
    const res = await request(app)
      .put("/api/admin/portal-url")
      .set("Cookie", adminCookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/portalUrl is required/i);
  });

  it("rejects non-string non-null portalUrl", async () => {
    const res = await request(app)
      .put("/api/admin/portal-url")
      .set("Cookie", adminCookie)
      .send({ portalUrl: 42 });
    expect(res.status).toBe(400);
  });

  it("treats null / empty string as 'reset': deletes the row and falls back", async () => {
    process.env.PORTAL_URL = "https://from-env.example";
    await request(app)
      .put("/api/admin/portal-url")
      .set("Cookie", adminCookie)
      .send({ portalUrl: "https://portal.acme.example" });

    const reset = await request(app)
      .put("/api/admin/portal-url")
      .set("Cookie", adminCookie)
      .send({ portalUrl: null });
    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({
      portalUrl: "https://from-env.example",
      source: "env",
    });

    const [row] = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, PORTAL_URL_SETTING_KEY));
    expect(row).toBeUndefined();
  });

  it("does not write an audit row for a no-op clear", async () => {
    const res = await request(app)
      .put("/api/admin/portal-url")
      .set("Cookie", adminCookie)
      .send({ portalUrl: "" });
    expect(res.status).toBe(200);
    const auditRows = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityType, "portal_url"));
    expect(auditRows).toHaveLength(0);
  });

  it("rejects requests from non-admin members", async () => {
    const res = await request(app)
      .put("/api/admin/portal-url")
      .set("Cookie", memberCookie)
      .send({ portalUrl: "https://portal.acme.example" });
    expect(res.status).toBe(403);
  });
});

describe("Generic settings endpoint blocks the portal URL key", () => {
  it("hides the portal URL row from GET /admin/settings", async () => {
    await request(app)
      .put("/api/admin/portal-url")
      .set("Cookie", adminCookie)
      .send({ portalUrl: "https://portal.acme.example" });
    const res = await request(app)
      .get("/api/admin/settings")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const keys = (res.body as Array<{ key: string }>).map((r) => r.key);
    expect(keys).not.toContain(PORTAL_URL_SETTING_KEY);
  });

  it("rejects PUT /admin/settings/branding.portal_url with a redirect to the dedicated endpoint", async () => {
    const res = await request(app)
      .put(`/api/admin/settings/${PORTAL_URL_SETTING_KEY}`)
      .set("Cookie", adminCookie)
      .send({ value: "https://other.example" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/\/admin\/portal-url/);
  });
});
