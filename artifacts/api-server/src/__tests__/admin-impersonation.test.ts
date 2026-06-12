import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, auditLogTable, sessionsTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { hasPermission } from "@workspace/auth";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `admin-impersonation-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;

function signCookie(userId: number, email: string, extra?: Record<string, unknown>): string {
  const token = jwt.sign({ userId, email, ...extra }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(role: string, suffix: string): Promise<{ id: number; email: string }> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
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

/** Extract a named cookie value from a set-cookie header array. */
function extractSetCookieValue(setCookies: string[], name: string): string | undefined {
  return setCookies
    .find((c) => c.startsWith(`${name}=`))
    ?.split(";")[0]
    ?.slice(name.length + 1);
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(sessionsTable).where(inArray(sessionsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("Permission matrix — members:impersonate", () => {
  it("admin role has members:impersonate permission", () => {
    expect(hasPermission("admin", "members:impersonate")).toBe(true);
  });

  it("super_admin role has members:impersonate permission", () => {
    expect(hasPermission("super_admin", "members:impersonate")).toBe(true);
  });

  it("support_agent role does NOT have members:impersonate permission", () => {
    expect(hasPermission("support_agent", "members:impersonate")).toBe(false);
  });

  it("content_manager role does NOT have members:impersonate permission", () => {
    expect(hasPermission("content_manager", "members:impersonate")).toBe(false);
  });

  it("compliance_reviewer role does NOT have members:impersonate permission", () => {
    expect(hasPermission("compliance_reviewer", "members:impersonate")).toBe(false);
  });

  it("admin role still cannot assign roles (members:assign_role)", () => {
    expect(hasPermission("admin", "members:assign_role")).toBe(false);
  });

  it("admin role still cannot manage settings (settings:manage)", () => {
    expect(hasPermission("admin", "settings:manage")).toBe(false);
  });

  it("admin role still cannot manage API keys (api_keys:manage)", () => {
    expect(hasPermission("admin", "api_keys:manage")).toBe(false);
  });
});

describe("POST /admin/impersonate/:id — permission gate", () => {
  it("admin can start impersonation; response sets access_token and imp_restore_token cookies; audit log written", async () => {
    const admin = await insertUser("admin", "admin-imp-ok");
    const member = await insertUser("member", "member-target-ok");

    const res = await request(app)
      .post(`/api/admin/impersonate/${member.id}`)
      .set("Cookie", signCookie(admin.id, admin.email));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("member");
    expect(res.body.member.id).toBe(member.id);

    const setCookies: string[] = (res.headers["set-cookie"] ?? []) as unknown as string[];
    expect(setCookies.some((c: string) => c.startsWith("access_token="))).toBe(true);
    expect(setCookies.some((c: string) => c.startsWith("imp_restore_token="))).toBe(true);

    const auditRows = await db
      .select({ actionType: auditLogTable.actionType, entityId: auditLogTable.entityId })
      .from(auditLogTable)
      .where(and(eq(auditLogTable.actorId, admin.id), eq(auditLogTable.actionType, "impersonate_start")))
      .orderBy(desc(auditLogTable.id))
      .limit(1);

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].entityId).toBe(String(member.id));
  });

  it("start creates a DB session row for the admin (restore session)", async () => {
    const admin = await insertUser("admin", "admin-session-row");
    const member = await insertUser("member", "member-session-row");

    const res = await request(app)
      .post(`/api/admin/impersonate/${member.id}`)
      .set("Cookie", signCookie(admin.id, admin.email));

    expect(res.status).toBe(200);

    const sessions = await db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, admin.id));

    expect(sessions.length).toBeGreaterThanOrEqual(1);
  });

  it("support_agent cannot impersonate (403)", async () => {
    const agent = await insertUser("support_agent", "agent-imp-denied");
    const member = await insertUser("member", "member-target-denied");

    const res = await request(app)
      .post(`/api/admin/impersonate/${member.id}`)
      .set("Cookie", signCookie(agent.id, agent.email));

    expect(res.status).toBe(403);
  });

  it("cannot impersonate another admin account (403)", async () => {
    const admin = await insertUser("admin", "admin-imp-guard");
    const otherAdmin = await insertUser("admin", "admin-target-guard");

    const res = await request(app)
      .post(`/api/admin/impersonate/${otherAdmin.id}`)
      .set("Cookie", signCookie(admin.id, admin.email));

    expect(res.status).toBe(403);
  });

  it("stop route restores admin session and writes impersonate_stop audit event", async () => {
    const admin = await insertUser("admin", "admin-stop");
    const member = await insertUser("member", "member-stop");

    // Start impersonation — the endpoint mints a fresh DB restore session.
    const startRes = await request(app)
      .post(`/api/admin/impersonate/${member.id}`)
      .set("Cookie", signCookie(admin.id, admin.email));

    expect(startRes.status).toBe(200);

    const setCookies: string[] = (startRes.headers["set-cookie"] ?? []) as unknown as string[];
    const impAccessToken = setCookies
      .find((c: string) => c.startsWith("access_token="))
      ?.split(";")[0] ?? signCookie(member.id, member.email, { isImpersonation: true, impersonatedBy: admin.id });
    const impRestoreToken = extractSetCookieValue(setCookies, "imp_restore_token");

    expect(impRestoreToken).toBeTruthy();

    // Stop impersonation using the restore token set by the start endpoint.
    const stopRes = await request(app)
      .post("/api/admin/impersonate/stop")
      .set("Cookie", [
        impAccessToken,
        `imp_restore_token=${impRestoreToken}`,
      ]);

    expect(stopRes.status).toBe(200);
    expect(stopRes.body).toHaveProperty("success", true);

    const stopAudit = await db
      .select({ actionType: auditLogTable.actionType, actorId: auditLogTable.actorId })
      .from(auditLogTable)
      .where(and(eq(auditLogTable.actorId, admin.id), eq(auditLogTable.actionType, "impersonate_stop")))
      .orderBy(desc(auditLogTable.id))
      .limit(1);

    expect(stopAudit).toHaveLength(1);
  });

  it("stop returns 403 when called without an active impersonation access token (non-impersonation caller)", async () => {
    const admin = await insertUser("admin", "admin-stop-noimpctx");
    const member = await insertUser("member", "member-stop-noimpctx");

    // Start impersonation to create a valid restore token in DB.
    const startRes = await request(app)
      .post(`/api/admin/impersonate/${member.id}`)
      .set("Cookie", signCookie(admin.id, admin.email));

    expect(startRes.status).toBe(200);

    const setCookies: string[] = (startRes.headers["set-cookie"] ?? []) as unknown as string[];
    const impRestoreToken = extractSetCookieValue(setCookies, "imp_restore_token");

    // Call stop using a NORMAL (non-impersonation) admin access token — should 403.
    const stopRes = await request(app)
      .post("/api/admin/impersonate/stop")
      .set("Cookie", [
        signCookie(admin.id, admin.email), // normal JWT, not impersonation
        `imp_restore_token=${impRestoreToken}`,
      ]);

    expect(stopRes.status).toBe(403);
  });

  it("stop returns 403 when restore token belongs to a different admin (context mismatch)", async () => {
    const admin1 = await insertUser("admin", "admin-mismatch-1");
    const admin2 = await insertUser("admin", "admin-mismatch-2");
    const member = await insertUser("member", "member-mismatch");

    // Start impersonation as admin1 → admin1's restore token.
    const startRes = await request(app)
      .post(`/api/admin/impersonate/${member.id}`)
      .set("Cookie", signCookie(admin1.id, admin1.email));

    expect(startRes.status).toBe(200);
    const setCookies: string[] = (startRes.headers["set-cookie"] ?? []) as unknown as string[];
    const admin1RestoreToken = extractSetCookieValue(setCookies, "imp_restore_token");

    // Attempt stop using admin2's impersonation context but admin1's restore cookie.
    const impersonationTokenForAdmin2 = jwt.sign(
      { userId: member.id, email: member.email, impersonatedBy: admin2.id, isImpersonation: true },
      JWT_SECRET,
      { expiresIn: "30m" },
    );

    const stopRes = await request(app)
      .post("/api/admin/impersonate/stop")
      .set("Cookie", [
        `access_token=${impersonationTokenForAdmin2}`,
        `imp_restore_token=${admin1RestoreToken}`,
      ]);

    expect(stopRes.status).toBe(403);
  });

  it("restore token is single-use — replaying it after a successful stop fails", async () => {
    const admin = await insertUser("admin", "admin-single-use");
    const member = await insertUser("member", "member-single-use");

    const startRes = await request(app)
      .post(`/api/admin/impersonate/${member.id}`)
      .set("Cookie", signCookie(admin.id, admin.email));

    expect(startRes.status).toBe(200);
    const setCookies: string[] = (startRes.headers["set-cookie"] ?? []) as unknown as string[];
    const impAccessToken = setCookies.find((c: string) => c.startsWith("access_token="))?.split(";")[0]!;
    const impRestoreToken = extractSetCookieValue(setCookies, "imp_restore_token")!;

    // First stop — should succeed.
    const stop1 = await request(app)
      .post("/api/admin/impersonate/stop")
      .set("Cookie", [impAccessToken, `imp_restore_token=${impRestoreToken}`]);
    expect(stop1.status).toBe(200);

    // Replay attempt — restore session was consumed; should now fail.
    const stop2 = await request(app)
      .post("/api/admin/impersonate/stop")
      .set("Cookie", [impAccessToken, `imp_restore_token=${impRestoreToken}`]);
    // The restore session row is revoked → 400 (invalid/expired).
    expect(stop2.status).toBe(400);
  });

  it("start clears the admin's refresh_token so the impersonation cannot be silently refreshed away", async () => {
    const admin = await insertUser("admin", "admin-clear-rt");
    const member = await insertUser("member", "member-clear-rt");

    const res = await request(app)
      .post(`/api/admin/impersonate/${member.id}`)
      .set("Cookie", signCookie(admin.id, admin.email));

    expect(res.status).toBe(200);

    const setCookies: string[] = (res.headers["set-cookie"] ?? []) as unknown as string[];
    // The response must clear the /api/auth-scoped refresh_token so the
    // browser cannot use it to silently refresh back to an admin session
    // while impersonation is active.
    const refreshTokenClearance = setCookies.find(
      (c: string) => c.startsWith("refresh_token=") && c.includes("Expires="),
    );
    expect(refreshTokenClearance).toBeTruthy();
    // The cleared cookie value should be empty (browser clears it).
    const value = extractSetCookieValue(setCookies, "refresh_token");
    expect(value).toBe("");
  });

  it("stop returns 400 when no imp_restore_token cookie is present", async () => {
    const member = await insertUser("member", "member-stop-notoken");

    const res = await request(app)
      .post("/api/admin/impersonate/stop")
      .set("Cookie", signCookie(member.id, member.email, { isImpersonation: true }));

    expect(res.status).toBe(400);
  });
});
