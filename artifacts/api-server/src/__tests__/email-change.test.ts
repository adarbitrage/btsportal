import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { randomUUID } from "crypto";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { eq, inArray, and, isNull } from "drizzle-orm";

const {
  sendEmailNowMock,
  queueGHLSyncMock,
  emitWebhookEventMock,
} = vi.hoisted(() => ({
  sendEmailNowMock: vi.fn(async () => ({ success: true })),
  queueGHLSyncMock: vi.fn(async () => "job_test_id"),
  emitWebhookEventMock: vi.fn(async () => undefined),
}));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    sendEmailNow: sendEmailNowMock,
  },
}));

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: queueGHLSyncMock,
  startWorker: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock("../lib/webhook-events", () => ({
  emitWebhookEvent: emitWebhookEventMock,
  WEBHOOK_EVENT_TYPES: [],
}));

import { buildTestApp } from "./test-app";
import membersRouter from "../routes/members";
import authRouter from "../routes/auth";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_PASSWORD = "OriginalPassw0rd!";
const TEST_TAG = `email-change-test-${randomUUID().slice(0, 8)}`;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

interface SeededUser {
  id: number;
  email: string;
  name: string;
}

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestApp>;

async function insertUser(suffix: string, opts: {
  password?: string;
  email?: string;
} = {}): Promise<SeededUser> {
  const email = opts.email ?? `${TEST_TAG}-${suffix}@example.test`;
  const name = `Test ${suffix}`;
  const passwordHash = await bcrypt.hash(opts.password ?? TEST_PASSWORD, 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name,
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email, name };
}

async function getUser(userId: number) {
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return row;
}

async function clearPendingChange(userId: number): Promise<void> {
  await db
    .update(usersTable)
    .set({ pendingEmail: null, emailChangeToken: null, emailChangeExpires: null })
    .where(eq(usersTable.id, userId));
}

async function insertSession(userId: number): Promise<number> {
  const refreshToken = crypto.randomBytes(48).toString("hex");
  const refreshTokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
  const [row] = await db
    .insert(sessionsTable)
    .values({
      userId,
      refreshTokenHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    .returning({ id: sessionsTable.id });
  return row.id;
}

beforeAll(() => {
  app = buildTestApp({ routers: [membersRouter, authRouter] });
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(sessionsTable).where(inArray(sessionsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  sendEmailNowMock.mockClear();
  queueGHLSyncMock.mockClear();
  emitWebhookEventMock.mockClear();
});

describe("POST /api/members/me/email (request email change)", () => {
  it("happy path: writes pendingEmail/token/expires, sends both emails, returns pendingEmail in response", async () => {
    const user = await insertUser("happy");
    const newEmail = `${TEST_TAG}-happy-new@example.test`;

    const res = await request(app)
      .post("/api/members/me/email")
      .set("Cookie", signCookie(user.id, user.email))
      .send({ currentPassword: TEST_PASSWORD, newEmail });

    expect(res.status).toBe(200);
    expect(res.body.pendingEmail).toBe(newEmail);
    expect(res.body.message).toMatch(/verification link/i);

    const updated = await getUser(user.id);
    expect(updated.pendingEmail).toBe(newEmail);
    expect(updated.emailChangeToken).toBeTruthy();
    expect(updated.emailChangeToken).toHaveLength(64); // sha256 hex
    expect(updated.emailChangeExpires).toBeInstanceOf(Date);
    expect(updated.emailChangeExpires!.getTime()).toBeGreaterThan(Date.now());
    // Email itself unchanged until verification.
    expect(updated.email).toBe(user.email);

    // Both transactional emails must have been triggered.
    expect(sendEmailNowMock).toHaveBeenCalledTimes(2);
    const calls = sendEmailNowMock.mock.calls.map((c) => c[0]);
    const verifyCall = calls.find((c) => c.templateSlug === "email_change_verify");
    const noticeCall = calls.find((c) => c.templateSlug === "email_change_notice");
    expect(verifyCall).toBeDefined();
    expect(verifyCall!.to).toBe(newEmail);
    expect(verifyCall!.userId).toBe(user.id);
    expect(verifyCall!.variables?.verify_token).toBeTruthy();
    expect(verifyCall!.variables?.verify_token).not.toBe(updated.emailChangeToken);
    expect(verifyCall!.variables?.new_email).toBe(newEmail);
    expect(verifyCall!.variables?.old_email).toBe(user.email);

    expect(noticeCall).toBeDefined();
    expect(noticeCall!.to).toBe(user.email);
    expect(noticeCall!.userId).toBe(user.id);
    expect(noticeCall!.variables?.new_email).toBe(newEmail);
  });

  it("normalizes the new email to lowercase before storing", async () => {
    const user = await insertUser("normalize");
    const mixedCase = `${TEST_TAG}-Normalize-New@Example.TEST`;

    const res = await request(app)
      .post("/api/members/me/email")
      .set("Cookie", signCookie(user.id, user.email))
      .send({ currentPassword: TEST_PASSWORD, newEmail: mixedCase });

    expect(res.status).toBe(200);
    expect(res.body.pendingEmail).toBe(mixedCase.toLowerCase());

    const updated = await getUser(user.id);
    expect(updated.pendingEmail).toBe(mixedCase.toLowerCase());
  });

  it("rejects with 400 when the current password is wrong and writes nothing", async () => {
    const user = await insertUser("wrong-pass");

    const res = await request(app)
      .post("/api/members/me/email")
      .set("Cookie", signCookie(user.id, user.email))
      .send({
        currentPassword: "definitely-not-the-real-password",
        newEmail: `${TEST_TAG}-wrong-pass-new@example.test`,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/current password is incorrect/i);

    const updated = await getUser(user.id);
    expect(updated.pendingEmail).toBeNull();
    expect(updated.emailChangeToken).toBeNull();
    expect(updated.emailChangeExpires).toBeNull();
    expect(sendEmailNowMock).not.toHaveBeenCalled();
  });

  it("rejects with 400 when the new email is the same as the current email", async () => {
    const user = await insertUser("same");

    const res = await request(app)
      .post("/api/members/me/email")
      .set("Cookie", signCookie(user.id, user.email))
      .send({ currentPassword: TEST_PASSWORD, newEmail: user.email.toUpperCase() });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/different from your current/i);
    expect(sendEmailNowMock).not.toHaveBeenCalled();
  });

  it("rejects with 400 when another user already owns the requested email", async () => {
    const user = await insertUser("conflict-requester");
    const other = await insertUser("conflict-owner");

    const res = await request(app)
      .post("/api/members/me/email")
      .set("Cookie", signCookie(user.id, user.email))
      .send({ currentPassword: TEST_PASSWORD, newEmail: other.email });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already in use/i);

    const updated = await getUser(user.id);
    expect(updated.pendingEmail).toBeNull();
    expect(sendEmailNowMock).not.toHaveBeenCalled();
  });

  it("rejects with 400 when the request body is malformed (invalid email)", async () => {
    const user = await insertUser("bad-body");

    const res = await request(app)
      .post("/api/members/me/email")
      .set("Cookie", signCookie(user.id, user.email))
      .send({ currentPassword: TEST_PASSWORD, newEmail: "not-an-email" });

    expect(res.status).toBe(400);
    expect(sendEmailNowMock).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no auth cookie", async () => {
    const res = await request(app)
      .post("/api/members/me/email")
      .send({ currentPassword: TEST_PASSWORD, newEmail: "x@example.test" });
    expect(res.status).toBe(401);
    expect(sendEmailNowMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/members/me/email/cancel (cancel pending change)", () => {
  it("clears pendingEmail, token, and expires for the current user", async () => {
    const user = await insertUser("cancel");
    // Seed a pending change directly so we know exactly what we're clearing.
    await db
      .update(usersTable)
      .set({
        pendingEmail: `${TEST_TAG}-cancel-new@example.test`,
        emailChangeToken: "deadbeef".repeat(8),
        emailChangeExpires: new Date(Date.now() + 60 * 60 * 1000),
      })
      .where(eq(usersTable.id, user.id));

    const res = await request(app)
      .post("/api/members/me/email/cancel")
      .set("Cookie", signCookie(user.id, user.email));

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/cancelled/i);

    const updated = await getUser(user.id);
    expect(updated.pendingEmail).toBeNull();
    expect(updated.emailChangeToken).toBeNull();
    expect(updated.emailChangeExpires).toBeNull();
    // Cancel must NOT change the actual email.
    expect(updated.email).toBe(user.email);
  });

  it("is idempotent when there is no pending change", async () => {
    const user = await insertUser("cancel-noop");

    const res = await request(app)
      .post("/api/members/me/email/cancel")
      .set("Cookie", signCookie(user.id, user.email));

    expect(res.status).toBe(200);

    const updated = await getUser(user.id);
    expect(updated.pendingEmail).toBeNull();
    expect(updated.emailChangeToken).toBeNull();
  });

  it("only clears the pending change for the calling user, not others", async () => {
    const userA = await insertUser("cancel-isolated-a");
    const userB = await insertUser("cancel-isolated-b");

    const expires = new Date(Date.now() + 60 * 60 * 1000);
    await db
      .update(usersTable)
      .set({
        pendingEmail: `${TEST_TAG}-isolated-b-new@example.test`,
        emailChangeToken: "cafebabe".repeat(8),
        emailChangeExpires: expires,
      })
      .where(eq(usersTable.id, userB.id));

    const res = await request(app)
      .post("/api/members/me/email/cancel")
      .set("Cookie", signCookie(userA.id, userA.email));

    expect(res.status).toBe(200);

    const updatedB = await getUser(userB.id);
    expect(updatedB.pendingEmail).toBe(`${TEST_TAG}-isolated-b-new@example.test`);
    expect(updatedB.emailChangeToken).toBe("cafebabe".repeat(8));
  });

  it("returns 401 when there is no auth cookie", async () => {
    const res = await request(app).post("/api/members/me/email/cancel");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/verify-email-change", () => {
  async function seedPendingChange(
    userId: number,
    newEmail: string,
    expiresAt: Date = new Date(Date.now() + 60 * 60 * 1000),
  ): Promise<string> {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await db
      .update(usersTable)
      .set({
        pendingEmail: newEmail,
        emailChangeToken: tokenHash,
        emailChangeExpires: expiresAt,
      })
      .where(eq(usersTable.id, userId));
    return rawToken;
  }

  it("happy path: swaps email, clears pending fields, revokes sessions, queues GHL update, emits webhook", async () => {
    const user = await insertUser("verify-happy");
    const newEmail = `${TEST_TAG}-verify-happy-new@example.test`;
    const token = await seedPendingChange(user.id, newEmail);

    // Two active sessions + one already-revoked session (must not be touched).
    const activeSessionA = await insertSession(user.id);
    const activeSessionB = await insertSession(user.id);
    const preRevokedId = await insertSession(user.id);
    const preRevokedAt = new Date(Date.now() - 60 * 1000);
    await db
      .update(sessionsTable)
      .set({ revokedAt: preRevokedAt })
      .where(eq(sessionsTable.id, preRevokedId));

    const res = await request(app)
      .post("/api/auth/verify-email-change")
      .send({ token });

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(newEmail);
    expect(res.body.message).toMatch(/email updated successfully/i);

    const updated = await getUser(user.id);
    expect(updated.email).toBe(newEmail);
    expect(updated.emailVerified).toBe(true);
    expect(updated.pendingEmail).toBeNull();
    expect(updated.emailChangeToken).toBeNull();
    expect(updated.emailChangeExpires).toBeNull();

    // Both active sessions revoked, pre-revoked session left alone.
    const sessions = await db
      .select()
      .from(sessionsTable)
      .where(inArray(sessionsTable.id, [activeSessionA, activeSessionB, preRevokedId]));
    const byId = new Map(sessions.map((s) => [s.id, s]));
    expect(byId.get(activeSessionA)!.revokedAt).not.toBeNull();
    expect(byId.get(activeSessionB)!.revokedAt).not.toBeNull();
    // Pre-revoked timestamp must not have been overwritten.
    expect(byId.get(preRevokedId)!.revokedAt!.getTime()).toBe(preRevokedAt.getTime());

    // No active sessions remain for this user.
    const stillActive = await db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.userId, user.id), isNull(sessionsTable.revokedAt)));
    expect(stillActive).toHaveLength(0);

    // GHL contact-update queued with the new email.
    expect(queueGHLSyncMock).toHaveBeenCalledTimes(1);
    expect(queueGHLSyncMock).toHaveBeenCalledWith({
      action: "update_contact",
      userId: user.id,
      email: newEmail,
    });

    // Webhook event emitted.
    expect(emitWebhookEventMock).toHaveBeenCalledTimes(1);
    expect(emitWebhookEventMock).toHaveBeenCalledWith("member.email_changed", {
      user_id: user.id,
      old_email: user.email,
      new_email: newEmail,
    });
  });

  it("returns 400 when the token is missing from the body", async () => {
    const res = await request(app).post("/api/auth/verify-email-change").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token is required/i);
    expect(queueGHLSyncMock).not.toHaveBeenCalled();
    expect(emitWebhookEventMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a token that does not match any user (mismatched / never issued)", async () => {
    const user = await insertUser("verify-mismatch");
    await seedPendingChange(user.id, `${TEST_TAG}-verify-mismatch-new@example.test`);

    const bogusToken = crypto.randomBytes(32).toString("hex");
    const res = await request(app)
      .post("/api/auth/verify-email-change")
      .send({ token: bogusToken });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired/i);

    // Pending change must remain untouched.
    const after = await getUser(user.id);
    expect(after.pendingEmail).toBe(`${TEST_TAG}-verify-mismatch-new@example.test`);
    expect(after.email).toBe(user.email);
  });

  it("returns 400 when the token has already been used (single-use guarantee)", async () => {
    const user = await insertUser("verify-used");
    const newEmail = `${TEST_TAG}-verify-used-new@example.test`;
    const token = await seedPendingChange(user.id, newEmail);

    // First use succeeds.
    const first = await request(app)
      .post("/api/auth/verify-email-change")
      .send({ token });
    expect(first.status).toBe(200);

    // Reuse must fail because the token row is cleared.
    const second = await request(app)
      .post("/api/auth/verify-email-change")
      .send({ token });
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/invalid or expired/i);

    // GHL & webhook should only have fired once.
    expect(queueGHLSyncMock).toHaveBeenCalledTimes(1);
    expect(emitWebhookEventMock).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when the token is expired and leaves the pending change in place", async () => {
    const user = await insertUser("verify-expired");
    const newEmail = `${TEST_TAG}-verify-expired-new@example.test`;
    const token = await seedPendingChange(
      user.id,
      newEmail,
      new Date(Date.now() - 60 * 1000),
    );

    const res = await request(app)
      .post("/api/auth/verify-email-change")
      .send({ token });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired/i);

    const after = await getUser(user.id);
    expect(after.email).toBe(user.email);
    // Expired token rows are NOT cleared by the verify route — they should
    // remain so the cancel endpoint or a subsequent request can deal with them.
    expect(after.pendingEmail).toBe(newEmail);
  });

  it("returns 400 and clears the pending change when another user has grabbed the email since the link was issued", async () => {
    const user = await insertUser("verify-race");
    const desiredEmail = `${TEST_TAG}-verify-race-new@example.test`;
    const token = await seedPendingChange(user.id, desiredEmail);

    // Another account snags the email between request and verification.
    await insertUser("verify-race-thief", { email: desiredEmail });

    const res = await request(app)
      .post("/api/auth/verify-email-change")
      .send({ token });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no longer available/i);

    const after = await getUser(user.id);
    expect(after.email).toBe(user.email); // unchanged
    // Race-conflict path explicitly clears the pending fields so the user can re-request.
    expect(after.pendingEmail).toBeNull();
    expect(after.emailChangeToken).toBeNull();
    expect(after.emailChangeExpires).toBeNull();

    expect(queueGHLSyncMock).not.toHaveBeenCalled();
    expect(emitWebhookEventMock).not.toHaveBeenCalled();
  });

  it("does not require authentication (public endpoint)", async () => {
    const user = await insertUser("verify-public");
    const newEmail = `${TEST_TAG}-verify-public-new@example.test`;
    const token = await seedPendingChange(user.id, newEmail);

    // No auth cookie at all.
    const res = await request(app)
      .post("/api/auth/verify-email-change")
      .send({ token });

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(newEmail);
  });
});
