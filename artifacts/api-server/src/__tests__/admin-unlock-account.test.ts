import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, auditLogTable } from "@workspace/db";
import { eq, inArray, and, desc } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `admin-unlock-${randomUUID().slice(0, 8)}`;

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
    await db
      .delete(auditLogTable)
      .where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

async function seedLockedMember(suffix: string, opts: {
  failedLoginCount: number;
  lockedUntil: Date | null;
}): Promise<number> {
  const email = `${TEST_TAG}-locked-${suffix}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Locked ${suffix}`,
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
      failedLoginCount: opts.failedLoginCount,
      lockedUntil: opts.lockedUntil,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

async function getUser(userId: number) {
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return row;
}

describe("POST /api/admin/members/:id/unlock", () => {
  it("requires authentication (no cookie -> 401)", async () => {
    const res = await request(app).post(`/api/admin/members/${adminId}/unlock`);
    expect(res.status).toBe(401);
  });

  it("rejects non-admin members with 403", async () => {
    const targetId = await seedLockedMember("rbac-target", {
      failedLoginCount: 5,
      lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
    });
    const res = await request(app)
      .post(`/api/admin/members/${targetId}/unlock`)
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);

    // Member's lock state must be untouched.
    const after = await getUser(targetId);
    expect(after.failedLoginCount).toBe(5);
    expect(after.lockedUntil).toBeInstanceOf(Date);
  });

  it("returns 400 for a non-numeric member id", async () => {
    const res = await request(app)
      .post("/api/admin/members/not-a-number/unlock")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid member id/i);
  });

  it("returns 404 for an unknown member id", async () => {
    const res = await request(app)
      .post("/api/admin/members/9999999/unlock")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("clears lockedUntil and failedLoginCount and writes an audit-log entry", async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000);
    const targetId = await seedLockedMember("happy-path", {
      failedLoginCount: 5,
      lockedUntil: future,
    });

    const res = await request(app)
      .post(`/api/admin/members/${targetId}/unlock`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      id: targetId,
      lockedUntil: null,
      failedLoginCount: 0,
    });

    const after = await getUser(targetId);
    expect(after.failedLoginCount).toBe(0);
    expect(after.lockedUntil).toBeNull();

    // Audit-log entry must capture the action, the actor, and the before/after.
    const [entry] = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actionType, "unlock_account"),
          eq(auditLogTable.entityType, "user"),
          eq(auditLogTable.entityId, String(targetId)),
        ),
      )
      .orderBy(desc(auditLogTable.createdAt))
      .limit(1);

    expect(entry, "audit log entry for unlock_account").toBeDefined();
    expect(entry.actorId).toBe(adminId);
    const diff = entry.changeDiff as {
      before?: { lockedUntil: string | null; failedLoginCount: number };
      after?: { lockedUntil: string | null; failedLoginCount: number };
    } | null;
    expect(diff?.before?.failedLoginCount).toBe(5);
    expect(diff?.before?.lockedUntil).toBeTruthy();
    expect(diff?.after).toEqual({ lockedUntil: null, failedLoginCount: 0 });
  });

  it("is idempotent on an already-unlocked account", async () => {
    const targetId = await seedLockedMember("already-clear", {
      failedLoginCount: 0,
      lockedUntil: null,
    });

    const res = await request(app)
      .post(`/api/admin/members/${targetId}/unlock`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      lockedUntil: null,
      failedLoginCount: 0,
    });

    const after = await getUser(targetId);
    expect(after.failedLoginCount).toBe(0);
    expect(after.lockedUntil).toBeNull();
  });

  it("clears a stale (already-expired) lock as well so the counter starts clean", async () => {
    const stale = new Date(Date.now() - 60 * 1000);
    const targetId = await seedLockedMember("stale-lock", {
      failedLoginCount: 5,
      lockedUntil: stale,
    });

    const res = await request(app)
      .post(`/api/admin/members/${targetId}/unlock`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    const after = await getUser(targetId);
    expect(after.failedLoginCount).toBe(0);
    expect(after.lockedUntil).toBeNull();
  });
});
