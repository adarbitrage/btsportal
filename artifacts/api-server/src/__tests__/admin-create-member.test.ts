import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, auditLogTable } from "@workspace/db";
import { eq, inArray, and, desc, ilike } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

const { sendEmailNowMock } = vi.hoisted(() => ({
  sendEmailNowMock: vi.fn<(params: unknown) => Promise<{ result: "sent" }>>(
    async () => ({ result: "sent" }),
  ),
}));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    sendEmailNow: sendEmailNowMock,
    queueEmail: vi.fn(async () => ({ result: "queued" })),
  },
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `admin-create-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let memberCookie: string;
let adminId: number;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(role: string, suffix: string) {
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

beforeEach(() => {
  sendEmailNowMock.mockClear();
});

afterAll(async () => {
  // Also clean up users created by the happy-path test (their emails follow
  // a known shape and are filed under the per-suite TEST_TAG prefix).
  const createdByTests = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(ilike(usersTable.email, `${TEST_TAG}-%`));
  const allIds = Array.from(new Set([...seededUserIds, ...createdByTests.map((r) => r.id)]));
  if (allIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.actorId, allIds));
    await db.delete(auditLogTable).where(
      and(eq(auditLogTable.entityType, "user"), inArray(auditLogTable.entityId, allIds.map(String))),
    );
    await db.delete(usersTable).where(inArray(usersTable.id, allIds));
  }
});

describe("POST /api/admin/members", () => {
  it("requires authentication (no cookie -> 401)", async () => {
    const res = await request(app)
      .post("/api/admin/members")
      .send({ email: `${TEST_TAG}-unauth@example.test`, name: "Anon" });
    expect(res.status).toBe(401);
    expect(sendEmailNowMock).not.toHaveBeenCalled();
  });

  it("rejects non-admin members with 403", async () => {
    const res = await request(app)
      .post("/api/admin/members")
      .set("Cookie", memberCookie)
      .send({ email: `${TEST_TAG}-rbac@example.test`, name: "Blocked" });
    expect(res.status).toBe(403);

    // No user should have been created.
    const [row] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, `${TEST_TAG}-rbac@example.test`));
    expect(row).toBeUndefined();
    expect(sendEmailNowMock).not.toHaveBeenCalled();
  });

  it("returns 400 when email is missing", async () => {
    const res = await request(app)
      .post("/api/admin/members")
      .set("Cookie", adminCookie)
      .send({ name: "Anonymous" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email and name/i);
  });

  it("returns 400 when name is missing", async () => {
    const res = await request(app)
      .post("/api/admin/members")
      .set("Cookie", adminCookie)
      .send({ email: `${TEST_TAG}-no-name@example.test` });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email and name/i);
  });

  it("returns 400 for an invalid email format", async () => {
    const res = await request(app)
      .post("/api/admin/members")
      .set("Cookie", adminCookie)
      .send({ email: "not-an-email", name: "Bad Email" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid email/i);
    expect(sendEmailNowMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the email is already registered (admin sees the conflict)", async () => {
    const existing = await insertUser("member", "dupe-target");

    const res = await request(app)
      .post("/api/admin/members")
      .set("Cookie", adminCookie)
      .send({ email: existing.email.toUpperCase(), name: "Dupe Attempt" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
    expect(res.body.id).toBe(existing.id);
    expect(sendEmailNowMock).not.toHaveBeenCalled();
  });

  it("happy path: creates the member verified, fires password_reset email, audits the action", async () => {
    const newEmail = `${TEST_TAG}-happy@example.test`;
    const res = await request(app)
      .post("/api/admin/members")
      .set("Cookie", adminCookie)
      .send({ email: newEmail.toUpperCase(), name: "  Neil Cherrington  " });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, email: newEmail, name: "Neil Cherrington" });
    expect(typeof res.body.id).toBe("number");

    // Stored row: email lowercased, name trimmed, emailVerified=true, reset
    // token + expiry set, password hashed (i.e. not the raw random token).
    const [stored] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, res.body.id));
    expect(stored).toBeDefined();
    expect(stored.email).toBe(newEmail);
    expect(stored.name).toBe("Neil Cherrington");
    expect(stored.emailVerified).toBe(true);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(stored.resetToken).toBeTruthy();
    // The DB stores a SHA-256 hash of the token, not the raw token. Verify
    // length 64 hex so an accidental raw-token write would be caught.
    expect(stored.resetToken!.length).toBe(64);
    expect(stored.resetTokenExpires).toBeInstanceOf(Date);
    expect((stored.resetTokenExpires as Date).getTime()).toBeGreaterThan(Date.now());

    // Exactly one password_reset email fired to the new member.
    expect(sendEmailNowMock).toHaveBeenCalledTimes(1);
    const emailParams = sendEmailNowMock.mock.calls[0][0] as {
      templateSlug: string;
      to: string;
      variables: Record<string, unknown>;
      userId: number;
    };
    expect(emailParams.templateSlug).toBe("password_reset");
    expect(emailParams.to).toBe(newEmail);
    expect(emailParams.userId).toBe(res.body.id);
    expect(emailParams.variables.member_name).toBe("Neil Cherrington");
    expect(typeof emailParams.variables.reset_token).toBe("string");
    // Raw token must be 64 hex chars (32 random bytes).
    expect((emailParams.variables.reset_token as string)).toMatch(/^[0-9a-f]{64}$/);

    // Audit log row tied to the admin actor.
    const [entry] = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actionType, "create_member"),
          eq(auditLogTable.entityType, "user"),
          eq(auditLogTable.entityId, String(res.body.id)),
        ),
      )
      .orderBy(desc(auditLogTable.createdAt))
      .limit(1);
    expect(entry, "audit log entry for create_member").toBeDefined();
    expect(entry.actorId).toBe(adminId);
    expect(entry.description).toMatch(/^Created member /);
    const metadata = entry.metadata as { memberEmail?: string } | null;
    expect(metadata?.memberEmail).toBe(newEmail);
  });

  it("lowercases the stored email so case-variant duplicates collide on next create", async () => {
    const newEmail = `${TEST_TAG}-case@example.test`;
    const first = await request(app)
      .post("/api/admin/members")
      .set("Cookie", adminCookie)
      .send({ email: newEmail.toUpperCase(), name: "Case Sensitive" });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/admin/members")
      .set("Cookie", adminCookie)
      .send({ email: newEmail, name: "Case Sensitive" });
    expect(second.status).toBe(409);
    expect(second.body.id).toBe(first.body.id);
  });
});

describe("POST /api/admin/members/:id/resend-invite", () => {
  it("requires authentication (no cookie -> 401)", async () => {
    const res = await request(app).post(`/api/admin/members/${adminId}/resend-invite`);
    expect(res.status).toBe(401);
    expect(sendEmailNowMock).not.toHaveBeenCalled();
  });

  it("rejects non-admin members with 403", async () => {
    const res = await request(app)
      .post(`/api/admin/members/${adminId}/resend-invite`)
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
    expect(sendEmailNowMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-numeric member id", async () => {
    const res = await request(app)
      .post("/api/admin/members/not-a-number/resend-invite")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown member id", async () => {
    const res = await request(app)
      .post("/api/admin/members/9999999/resend-invite")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
  });

  it("mints a fresh reset token, sends password_reset email, audits the action", async () => {
    const target = await insertUser("member", "resend-target");

    const res = await request(app)
      .post(`/api/admin/members/${target.id}/resend-invite`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, id: target.id });

    // A fresh reset token + expiry was written.
    const [stored] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, target.id));
    expect(stored.resetToken).toBeTruthy();
    expect(stored.resetToken!.length).toBe(64);
    expect(stored.resetTokenExpires).toBeInstanceOf(Date);
    expect((stored.resetTokenExpires as Date).getTime()).toBeGreaterThan(Date.now());

    // Exactly one password_reset email fired to that member.
    expect(sendEmailNowMock).toHaveBeenCalledTimes(1);
    const emailParams = sendEmailNowMock.mock.calls[0][0] as {
      templateSlug: string;
      to: string;
      userId: number;
      variables: Record<string, unknown>;
    };
    expect(emailParams.templateSlug).toBe("password_reset");
    expect(emailParams.to).toBe(target.email);
    expect(emailParams.userId).toBe(target.id);
    expect((emailParams.variables.reset_token as string)).toMatch(/^[0-9a-f]{64}$/);

    // Audit log row.
    const [entry] = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actionType, "resend_invite"),
          eq(auditLogTable.entityType, "user"),
          eq(auditLogTable.entityId, String(target.id)),
        ),
      )
      .orderBy(desc(auditLogTable.createdAt))
      .limit(1);
    expect(entry, "audit log entry for resend_invite").toBeDefined();
    expect(entry.actorId).toBe(adminId);
    const metadata = entry.metadata as { memberEmail?: string } | null;
    expect(metadata?.memberEmail).toBe(target.email);
  });

  it("rotates the reset token on each call (previous token is invalidated)", async () => {
    const target = await insertUser("member", "rotation-target");

    const r1 = await request(app)
      .post(`/api/admin/members/${target.id}/resend-invite`)
      .set("Cookie", adminCookie);
    expect(r1.status).toBe(200);
    const [afterFirst] = await db
      .select({ resetToken: usersTable.resetToken })
      .from(usersTable)
      .where(eq(usersTable.id, target.id));
    const firstToken = afterFirst.resetToken;

    const r2 = await request(app)
      .post(`/api/admin/members/${target.id}/resend-invite`)
      .set("Cookie", adminCookie);
    expect(r2.status).toBe(200);
    const [afterSecond] = await db
      .select({ resetToken: usersTable.resetToken })
      .from(usersTable)
      .where(eq(usersTable.id, target.id));

    expect(afterSecond.resetToken).toBeTruthy();
    expect(afterSecond.resetToken).not.toBe(firstToken);
  });
});
