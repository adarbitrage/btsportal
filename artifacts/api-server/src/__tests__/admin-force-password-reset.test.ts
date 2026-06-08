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
const TEST_TAG = `admin-force-pw-${randomUUID().slice(0, 8)}`;

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

async function insertUser(role: string, suffix: string, mustChangePassword = false): Promise<SeededUser> {
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
      mustChangePassword,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email };
}

async function getUser(userId: number) {
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return row;
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

describe("POST /api/admin/members/:id/force-password-reset", () => {
  it("requires authentication (no cookie -> 401)", async () => {
    const res = await request(app).post(`/api/admin/members/${adminId}/force-password-reset`);
    expect(res.status).toBe(401);
  });

  it("rejects callers without members:assign_role with 403", async () => {
    const target = await insertUser("member", "rbac-target");
    const res = await request(app)
      .post(`/api/admin/members/${target.id}/force-password-reset`)
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);

    // Flag must be untouched.
    const after = await getUser(target.id);
    expect(after.mustChangePassword).toBe(false);
  });

  it("returns 400 for a non-numeric member id", async () => {
    const res = await request(app)
      .post("/api/admin/members/not-a-number/force-password-reset")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid member id/i);
  });

  it("returns 404 for an unknown member id", async () => {
    const res = await request(app)
      .post("/api/admin/members/9999999/force-password-reset")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("sets mustChangePassword and writes an audit-log entry", async () => {
    const target = await insertUser("support_agent", "happy-path");

    const res = await request(app)
      .post(`/api/admin/members/${target.id}/force-password-reset`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      id: target.id,
      mustChangePassword: true,
      alreadySet: false,
    });

    const after = await getUser(target.id);
    expect(after.mustChangePassword).toBe(true);

    const [entry] = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actionType, "force_password_reset"),
          eq(auditLogTable.entityType, "user"),
          eq(auditLogTable.entityId, String(target.id)),
        ),
      )
      .orderBy(desc(auditLogTable.createdAt))
      .limit(1);

    expect(entry, "audit log entry for force_password_reset").toBeDefined();
    expect(entry.actorId).toBe(adminId);
    const diff = entry.changeDiff as {
      before?: { mustChangePassword: boolean };
      after?: { mustChangePassword: boolean };
    } | null;
    expect(diff?.before?.mustChangePassword).toBe(false);
    expect(diff?.after?.mustChangePassword).toBe(true);
  });

  it("is idempotent when the flag is already set", async () => {
    const target = await insertUser("member", "already-set", true);

    const res = await request(app)
      .post(`/api/admin/members/${target.id}/force-password-reset`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      mustChangePassword: true,
      alreadySet: true,
    });

    const after = await getUser(target.id);
    expect(after.mustChangePassword).toBe(true);
  });
});
