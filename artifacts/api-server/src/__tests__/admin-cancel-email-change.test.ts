import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, auditLogTable, emailChangeAttemptsTable } from "@workspace/db";
import { eq, inArray, and, desc } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: async () => false,
}));

const { queueEmailMock } = vi.hoisted(() => ({
  queueEmailMock: vi.fn<
    (params: unknown) => Promise<{ result: "queued" }>
  >(async () => ({ result: "queued" })),
}));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    queueEmail: queueEmailMock,
  },
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `admin-cancel-email-${randomUUID().slice(0, 8)}`;

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
      .delete(emailChangeAttemptsTable)
      .where(inArray(emailChangeAttemptsTable.userId, seededUserIds));
    await db
      .delete(auditLogTable)
      .where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

async function seedMemberWithPending(suffix: string, opts: {
  pendingEmail: string | null;
  emailChangeToken?: string | null;
  emailChangeExpires?: Date | null;
}): Promise<number> {
  const email = `${TEST_TAG}-target-${suffix}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Target ${suffix}`,
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
      pendingEmail: opts.pendingEmail,
      emailChangeToken: opts.emailChangeToken ?? null,
      emailChangeExpires: opts.emailChangeExpires ?? null,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

async function getUser(userId: number) {
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return row;
}

describe("POST /api/admin/members/:id/cancel-email-change", () => {
  beforeEach(() => {
    queueEmailMock.mockClear();
  });

  it("requires authentication (no cookie -> 401)", async () => {
    const res = await request(app).post(`/api/admin/members/${adminId}/cancel-email-change`);
    expect(res.status).toBe(401);
  });

  it("rejects non-admin members with 403", async () => {
    const targetId = await seedMemberWithPending("rbac-target", {
      pendingEmail: `${TEST_TAG}-rbac-new@example.test`,
      emailChangeToken: "deadbeef".repeat(8),
      emailChangeExpires: new Date(Date.now() + 60 * 60 * 1000),
    });
    const res = await request(app)
      .post(`/api/admin/members/${targetId}/cancel-email-change`)
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);

    const after = await getUser(targetId);
    expect(after.pendingEmail).toBe(`${TEST_TAG}-rbac-new@example.test`);
    expect(after.emailChangeToken).toBe("deadbeef".repeat(8));
    expect(after.emailChangeExpires).toBeInstanceOf(Date);
    // Authorization failure must never leak a notification to the member.
    expect(queueEmailMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-numeric member id", async () => {
    const res = await request(app)
      .post("/api/admin/members/not-a-number/cancel-email-change")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid member id/i);
  });

  it("returns 404 for an unknown member id", async () => {
    const res = await request(app)
      .post("/api/admin/members/9999999/cancel-email-change")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 404 when the member has no pending email change", async () => {
    const targetId = await seedMemberWithPending("no-pending", {
      pendingEmail: null,
    });
    const res = await request(app)
      .post(`/api/admin/members/${targetId}/cancel-email-change`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no pending email change/i);

    // No audit-log entry should be written for a no-op cancel.
    const auditEntries = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actionType, "cancel_email_change"),
          eq(auditLogTable.entityType, "user"),
          eq(auditLogTable.entityId, String(targetId)),
        ),
      );
    expect(auditEntries).toHaveLength(0);
    // And no notification to the member either: there was nothing to cancel.
    expect(queueEmailMock).not.toHaveBeenCalled();
  });

  it("clears pendingEmail/token/expires and writes an audit-log entry with before/after diff", async () => {
    const future = new Date(Date.now() + 12 * 60 * 60 * 1000);
    const targetId = await seedMemberWithPending("happy-path", {
      pendingEmail: `${TEST_TAG}-happy-new@example.test`,
      emailChangeToken: "cafebabe".repeat(8),
      emailChangeExpires: future,
    });

    const res = await request(app)
      .post(`/api/admin/members/${targetId}/cancel-email-change`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      id: targetId,
      pendingEmail: null,
    });

    const after = await getUser(targetId);
    expect(after.pendingEmail).toBeNull();
    expect(after.emailChangeToken).toBeNull();
    expect(after.emailChangeExpires).toBeNull();

    const [entry] = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actionType, "cancel_email_change"),
          eq(auditLogTable.entityType, "user"),
          eq(auditLogTable.entityId, String(targetId)),
        ),
      )
      .orderBy(desc(auditLogTable.createdAt))
      .limit(1);

    expect(entry, "audit log entry for cancel_email_change").toBeDefined();
    expect(entry.actorId).toBe(adminId);
    expect(entry.description).toContain(`${TEST_TAG}-happy-new@example.test`);
    const diff = entry.changeDiff as {
      before?: { pendingEmail: string | null; emailChangeExpires: string | null };
      after?: { pendingEmail: string | null; emailChangeExpires: string | null };
    } | null;
    expect(diff?.before?.pendingEmail).toBe(`${TEST_TAG}-happy-new@example.test`);
    expect(diff?.before?.emailChangeExpires).toBeTruthy();
    expect(diff?.after).toEqual({ pendingEmail: null, emailChangeExpires: null });
  });

  it("notifies the member at their current address with the discarded pending email", async () => {
    const targetId = await seedMemberWithPending("notify-happy", {
      pendingEmail: `${TEST_TAG}-notify-new@example.test`,
      emailChangeToken: "feedface".repeat(8),
      emailChangeExpires: new Date(Date.now() + 6 * 60 * 60 * 1000),
    });
    const target = await getUser(targetId);

    const res = await request(app)
      .post(`/api/admin/members/${targetId}/cancel-email-change`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    expect(queueEmailMock).toHaveBeenCalledTimes(1);
    const args = queueEmailMock.mock.calls[0][0] as {
      templateSlug: string;
      to: string;
      userId: number;
      variables: Record<string, string>;
    };
    expect(args.templateSlug).toBe("email_change_cancelled_by_admin");
    // The email goes to the now-restored CURRENT address, not the pending one.
    expect(args.to).toBe(target.email);
    expect(args.userId).toBe(targetId);
    expect(args.variables.member_name).toBe(target.name);
    expect(args.variables.member_email).toBe(target.email);
    expect(args.variables.cancelled_pending_email).toBe(
      `${TEST_TAG}-notify-new@example.test`,
    );
  });

  it("still returns 200 to the admin if the notification enqueue fails", async () => {
    queueEmailMock.mockRejectedValueOnce(new Error("redis exploded"));

    const targetId = await seedMemberWithPending("notify-failure", {
      pendingEmail: `${TEST_TAG}-notify-fail@example.test`,
      emailChangeToken: "abad1dea".repeat(8),
      emailChangeExpires: new Date(Date.now() + 6 * 60 * 60 * 1000),
    });

    const res = await request(app)
      .post(`/api/admin/members/${targetId}/cancel-email-change`)
      .set("Cookie", adminCookie);
    // The cancellation must succeed even when the courtesy notification can't
    // be enqueued — admins should never see a 500 because SendGrid/Redis is
    // having a bad day.
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const after = await getUser(targetId);
    expect(after.pendingEmail).toBeNull();
    expect(after.emailChangeToken).toBeNull();
    expect(after.emailChangeExpires).toBeNull();
  });

  it("marks the matching email_change_attempts row as cancelled-by-admin", async () => {
    const future = new Date(Date.now() + 12 * 60 * 60 * 1000);
    const targetEmail = `${TEST_TAG}-attempt-mark-new@example.test`;
    const targetId = await seedMemberWithPending("attempt-mark", {
      pendingEmail: targetEmail,
      emailChangeToken: "feedface".repeat(8),
      emailChangeExpires: future,
    });

    // Insert the matching attempt row that the cancel handler should mark.
    const [matchingAttempt] = await db
      .insert(emailChangeAttemptsTable)
      .values({
        userId: targetId,
        newEmail: targetEmail,
        expiresAt: future,
      })
      .returning({ id: emailChangeAttemptsTable.id });

    // An older, unrelated attempt — must NOT be touched.
    const [olderAttempt] = await db
      .insert(emailChangeAttemptsTable)
      .values({
        userId: targetId,
        newEmail: `${TEST_TAG}-attempt-mark-other@example.test`,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      })
      .returning({ id: emailChangeAttemptsTable.id });

    const res = await request(app)
      .post(`/api/admin/members/${targetId}/cancel-email-change`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    const [matchedAfter] = await db
      .select()
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.id, matchingAttempt.id));
    expect(matchedAfter.cancelledAt).toBeInstanceOf(Date);
    expect(matchedAfter.cancelledByAdminId).toBe(adminId);

    const [otherAfter] = await db
      .select()
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.id, olderAttempt.id));
    expect(otherAfter.cancelledAt).toBeNull();
    expect(otherAfter.cancelledByAdminId).toBeNull();
  });
});
