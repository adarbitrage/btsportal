import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, auditLogTable, sessionsTable } from "@workspace/db";
import { eq, inArray, and, desc, isNull } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `admin-revoke-sessions-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let memberCookie: string;
let adminId: number;

interface SeededUser {
  id: number;
  email: string;
}

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(role: string, suffix: string): Promise<SeededUser> {
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

async function seedSession(userId: number, opts: { expired?: boolean } = {}): Promise<number> {
  const expiresAt = opts.expired
    ? new Date(Date.now() - 60_000)
    : new Date(Date.now() + 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(sessionsTable)
    .values({
      userId,
      refreshTokenHash: `${TEST_TAG}-${randomUUID()}`,
      expiresAt,
      ipAddress: "203.0.113.7",
      userAgent: "Mozilla/5.0 (TestAgent)",
    })
    .returning({ id: sessionsTable.id });
  return row.id;
}

async function isRevoked(sessionId: number): Promise<boolean> {
  const [row] = await db
    .select({ revokedAt: sessionsTable.revokedAt })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId));
  return row?.revokedAt != null;
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
  if (seededUserIds.length > 0) {
    await db.delete(sessionsTable).where(inArray(sessionsTable.userId, seededUserIds));
    await db.delete(auditLogTable).where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("POST /api/admin/members/:id/sessions/:sessionId/revoke", () => {
  it("requires authentication (no cookie -> 401)", async () => {
    const res = await request(app).post(`/api/admin/members/${adminId}/sessions/1/revoke`);
    expect(res.status).toBe(401);
  });

  it("rejects callers without members:assign_role with 403", async () => {
    const target = await insertUser("member", "rbac-target");
    const sessionId = await seedSession(target.id);
    const res = await request(app)
      .post(`/api/admin/members/${target.id}/sessions/${sessionId}/revoke`)
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
    expect(await isRevoked(sessionId)).toBe(false);
  });

  it("returns 400 for a non-numeric session id", async () => {
    const res = await request(app)
      .post(`/api/admin/members/${adminId}/sessions/not-a-number/revoke`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid session id/i);
  });

  it("returns 404 for an unknown member id", async () => {
    const res = await request(app)
      .post("/api/admin/members/9999999/sessions/1/revoke")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/member not found/i);
  });

  it("returns 404 when the session belongs to a different member", async () => {
    const owner = await insertUser("member", "owner");
    const other = await insertUser("member", "other");
    const ownerSession = await seedSession(owner.id);
    // Attempt to revoke owner's session through the other member's id.
    const res = await request(app)
      .post(`/api/admin/members/${other.id}/sessions/${ownerSession}/revoke`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/session not found/i);
    // Owner's session must be untouched.
    expect(await isRevoked(ownerSession)).toBe(false);
  });

  it("revokes a single active session and writes an audit-log entry", async () => {
    const target = await insertUser("member", "single-revoke");
    const sessionA = await seedSession(target.id);
    const sessionB = await seedSession(target.id);

    const res = await request(app)
      .post(`/api/admin/members/${target.id}/sessions/${sessionA}/revoke`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, id: target.id, sessionId: sessionA, revoked: true });

    // Only the targeted session is revoked.
    expect(await isRevoked(sessionA)).toBe(true);
    expect(await isRevoked(sessionB)).toBe(false);

    const [entry] = await db
      .select()
      .from(auditLogTable)
      .where(and(
        eq(auditLogTable.actionType, "revoke_session"),
        eq(auditLogTable.entityType, "user"),
        eq(auditLogTable.entityId, String(target.id)),
      ))
      .orderBy(desc(auditLogTable.createdAt))
      .limit(1);
    expect(entry, "audit log entry for revoke_session").toBeDefined();
    expect(entry.actorId).toBe(adminId);
    const meta = entry.changeDiff as { sessionId?: number } | null;
    expect(meta?.sessionId).toBe(sessionA);
  });

  it("returns revoked:false and writes no audit row for an already-revoked session", async () => {
    const target = await insertUser("member", "already-revoked");
    const sessionId = await seedSession(target.id);
    await db
      .update(sessionsTable)
      .set({ revokedAt: new Date(Date.now() - 60_000) })
      .where(eq(sessionsTable.id, sessionId));

    const res = await request(app)
      .post(`/api/admin/members/${target.id}/sessions/${sessionId}/revoke`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(false);

    const entries = await db
      .select({ id: auditLogTable.id })
      .from(auditLogTable)
      .where(and(
        eq(auditLogTable.actionType, "revoke_session"),
        eq(auditLogTable.entityType, "user"),
        eq(auditLogTable.entityId, String(target.id)),
      ));
    expect(entries).toHaveLength(0);
  });
});

describe("POST /api/admin/members/:id/sessions/revoke-all", () => {
  it("rejects callers without members:assign_role with 403", async () => {
    const target = await insertUser("member", "all-rbac-target");
    const sessionId = await seedSession(target.id);
    const res = await request(app)
      .post(`/api/admin/members/${target.id}/sessions/revoke-all`)
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
    expect(await isRevoked(sessionId)).toBe(false);
  });

  it("returns 404 for an unknown member id", async () => {
    const res = await request(app)
      .post("/api/admin/members/9999999/sessions/revoke-all")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
  });

  it("revokes all active sessions, skips revoked/expired, and records the count", async () => {
    const target = await insertUser("member", "all-revoke");
    const activeA = await seedSession(target.id);
    const activeB = await seedSession(target.id);
    const expired = await seedSession(target.id, { expired: true });
    const alreadyRevoked = await seedSession(target.id);
    await db
      .update(sessionsTable)
      .set({ revokedAt: new Date(Date.now() - 60_000) })
      .where(eq(sessionsTable.id, alreadyRevoked));

    const res = await request(app)
      .post(`/api/admin/members/${target.id}/sessions/revoke-all`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    // Both still-active rows are counted; the expired row is still "active"
    // (revoked_at IS NULL) so it is revoked too, but the already-revoked row
    // is not re-counted.
    expect(res.body.revokedSessionCount).toBe(3);

    const stillActive = await db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.userId, target.id), isNull(sessionsTable.revokedAt)));
    expect(stillActive).toHaveLength(0);
    expect(await isRevoked(activeA)).toBe(true);
    expect(await isRevoked(activeB)).toBe(true);
    expect(await isRevoked(expired)).toBe(true);

    const [entry] = await db
      .select()
      .from(auditLogTable)
      .where(and(
        eq(auditLogTable.actionType, "revoke_all_sessions"),
        eq(auditLogTable.entityType, "user"),
        eq(auditLogTable.entityId, String(target.id)),
      ))
      .orderBy(desc(auditLogTable.createdAt))
      .limit(1);
    expect(entry, "audit log entry for revoke_all_sessions").toBeDefined();
    const meta = entry.changeDiff as { revokedSessionCount?: number } | null;
    expect(meta?.revokedSessionCount).toBe(3);
    expect(entry.description).toMatch(/revoked all 3 active sign-in sessions/i);
  });

  it("returns count 0 and writes no audit row when there are no active sessions", async () => {
    const target = await insertUser("member", "all-none");

    const res = await request(app)
      .post(`/api/admin/members/${target.id}/sessions/revoke-all`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.revokedSessionCount).toBe(0);

    const entries = await db
      .select({ id: auditLogTable.id })
      .from(auditLogTable)
      .where(and(
        eq(auditLogTable.actionType, "revoke_all_sessions"),
        eq(auditLogTable.entityType, "user"),
        eq(auditLogTable.entityId, String(target.id)),
      ));
    expect(entries).toHaveLength(0);
  });
});

describe("GET /api/admin/members/:id/full — activeSessions", () => {
  it("includes only active sessions (revoked + expired excluded)", async () => {
    const target = await insertUser("member", "full-sessions");
    const active = await seedSession(target.id);
    const expired = await seedSession(target.id, { expired: true });
    const revoked = await seedSession(target.id);
    await db
      .update(sessionsTable)
      .set({ revokedAt: new Date(Date.now() - 60_000) })
      .where(eq(sessionsTable.id, revoked));

    const res = await request(app)
      .get(`/api/admin/members/${target.id}/full`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.activeSessions)).toBe(true);
    const ids = res.body.activeSessions.map((s: { id: number }) => s.id);
    expect(ids).toContain(active);
    expect(ids).not.toContain(expired);
    expect(ids).not.toContain(revoked);
    const row = res.body.activeSessions.find((s: { id: number }) => s.id === active);
    expect(row).toMatchObject({ ipAddress: "203.0.113.7", userAgent: "Mozilla/5.0 (TestAgent)" });
    expect(row.createdAt).toBeTruthy();
    expect(row.lastSeenAt).toBeTruthy();
  });
});
