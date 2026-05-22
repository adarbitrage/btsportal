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
const TEST_TAG = `admin-force-verify-${randomUUID().slice(0, 8)}`;

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

async function insertUser(role: string, suffix: string, opts: { emailVerified?: boolean } = {}): Promise<SeededUser> {
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
      emailVerified: opts.emailVerified ?? false,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email };
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);
  const admin = await insertUser("super_admin", "admin", { emailVerified: true });
  const member = await insertUser("member", "non-admin", { emailVerified: true });
  adminId = admin.id;
  adminCookie = signCookie(admin.id, admin.email);
  memberCookie = signCookie(member.id, member.email);
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.actorId, seededUserIds));
    await db
      .delete(auditLogTable)
      .where(
        and(
          eq(auditLogTable.entityType, "user"),
          inArray(auditLogTable.entityId, seededUserIds.map(String)),
        ),
      );
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

async function getUser(userId: number) {
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return row;
}

describe("POST /api/admin/members/:id/force-verify", () => {
  it("requires authentication (no cookie -> 401)", async () => {
    const res = await request(app).post(`/api/admin/members/${adminId}/force-verify`);
    expect(res.status).toBe(401);
  });

  it("rejects non-admin members with 403", async () => {
    const target = await insertUser("member", "rbac-target", { emailVerified: false });
    const res = await request(app)
      .post(`/api/admin/members/${target.id}/force-verify`)
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);

    // Member's verified flag must be untouched.
    const after = await getUser(target.id);
    expect(after.emailVerified).toBe(false);
  });

  it("returns 400 for a non-numeric member id", async () => {
    const res = await request(app)
      .post("/api/admin/members/not-a-number/force-verify")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid member id/i);
  });

  it("returns 404 for an unknown member id", async () => {
    const res = await request(app)
      .post("/api/admin/members/9999999/force-verify")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("flips emailVerified=true and writes an audit-log entry with before/after", async () => {
    const target = await insertUser("member", "happy-path", { emailVerified: false });

    const res = await request(app)
      .post(`/api/admin/members/${target.id}/force-verify`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      id: target.id,
      emailVerified: true,
      alreadyVerified: false,
    });

    const after = await getUser(target.id);
    expect(after.emailVerified).toBe(true);

    const [entry] = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actionType, "force_verify_email"),
          eq(auditLogTable.entityType, "user"),
          eq(auditLogTable.entityId, String(target.id)),
        ),
      )
      .orderBy(desc(auditLogTable.createdAt))
      .limit(1);

    expect(entry, "audit log entry for force_verify_email").toBeDefined();
    expect(entry.actorId).toBe(adminId);
    const diff = entry.changeDiff as {
      before?: { emailVerified: boolean };
      after?: { emailVerified: boolean };
      memberEmail?: string;
    } | null;
    expect(diff?.before?.emailVerified).toBe(false);
    expect(diff?.after?.emailVerified).toBe(true);
    expect(diff?.memberEmail).toBe(target.email);
  });

  it("is idempotent on an already-verified account (reports alreadyVerified=true)", async () => {
    const target = await insertUser("member", "already-verified", { emailVerified: true });

    const res = await request(app)
      .post(`/api/admin/members/${target.id}/force-verify`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      id: target.id,
      emailVerified: true,
      alreadyVerified: true,
    });

    const after = await getUser(target.id);
    expect(after.emailVerified).toBe(true);

    // Audit row is still written so the admin's intent is recorded.
    const [entry] = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actionType, "force_verify_email"),
          eq(auditLogTable.entityType, "user"),
          eq(auditLogTable.entityId, String(target.id)),
        ),
      )
      .orderBy(desc(auditLogTable.createdAt))
      .limit(1);
    expect(entry, "audit log entry on idempotent call").toBeDefined();
    const diff = entry.changeDiff as { before?: { emailVerified: boolean } } | null;
    expect(diff?.before?.emailVerified).toBe(true);
  });
});
