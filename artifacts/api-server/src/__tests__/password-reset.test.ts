import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  sessionsTable,
  passwordResetAttemptsTable,
} from "@workspace/db";
import { eq, inArray, and, isNull, gte } from "drizzle-orm";

const { sendEmailNowMock } = vi.hoisted(() => ({
  sendEmailNowMock: vi.fn(async () => ({ success: true })),
}));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    sendEmailNow: sendEmailNowMock,
  },
}));

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: vi.fn(async () => "job_test_id"),
  startWorker: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock("../lib/webhook-events", () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
  WEBHOOK_EVENT_TYPES: [],
}));

import { buildTestApp } from "./test-app";
import authRouter from "../routes/auth";

const TEST_PASSWORD = "OriginalPassw0rd!";
const NEW_PASSWORD = "BrandNewPassw0rd!";
const TEST_TAG = `password-reset-test-${randomUUID().slice(0, 8)}`;

interface SeededUser {
  id: number;
  email: string;
  name: string;
}

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestApp>;
// Captured at beforeAll so beforeEach/afterAll can scope password_reset_attempts
// cleanup to rows this run inserted. Without this cleanup the per-IP daily cap
// (30 / 24h, keyed off 127.0.0.1 because this file doesn't trustProxy) fills
// up after enough sequential test runs and then the happy-path tests can't
// reserve a slot — surfacing as a 2s vi.waitFor timeout on the reset token.
let testRunStartedAt: Date;

async function insertUser(suffix: string, opts: { email?: string } = {}): Promise<SeededUser> {
  const email = opts.email ?? `${TEST_TAG}-${suffix}@example.test`;
  const name = `Test ${suffix}`;
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);
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

/**
 * Seed a reset token for a user. Returns the raw (unhashed) token that the
 * caller would receive by email.
 */
async function seedResetToken(
  userId: number,
  expiresAt: Date = new Date(Date.now() + 60 * 60 * 1000),
): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  await db
    .update(usersTable)
    .set({ resetToken: tokenHash, resetTokenExpires: expiresAt })
    .where(eq(usersTable.id, userId));
  return rawToken;
}

/**
 * Parse Set-Cookie headers off a supertest response into an easy-to-assert
 * shape. Each entry is { name, value, path, expires, maxAge }.
 */
interface ParsedCookie {
  name: string;
  value: string;
  path?: string;
  expires?: string;
  maxAge?: string;
  raw: string;
}

function parseSetCookies(res: request.Response): ParsedCookie[] {
  const raw = res.headers["set-cookie"];
  const headers = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return headers.map((header) => {
    const segments = header.split(";").map((s) => s.trim());
    const [nameValue, ...attrs] = segments;
    const eqIdx = nameValue.indexOf("=");
    const name = eqIdx === -1 ? nameValue : nameValue.slice(0, eqIdx);
    const value = eqIdx === -1 ? "" : nameValue.slice(eqIdx + 1);
    const parsed: ParsedCookie = { name, value, raw: header };
    for (const attr of attrs) {
      const [k, v = ""] = attr.split("=");
      const key = k.toLowerCase();
      if (key === "path") parsed.path = v;
      else if (key === "expires") parsed.expires = v;
      else if (key === "max-age") parsed.maxAge = v;
    }
    return parsed;
  });
}

/**
 * A cookie is "cleared" by Express's res.clearCookie when it has an empty
 * value AND either Expires=Thu, 01 Jan 1970... or Max-Age=0.
 */
function expectClearedCookie(cookies: ParsedCookie[], name: string, expectedPath: string) {
  const cookie = cookies.find((c) => c.name === name);
  expect(cookie, `expected Set-Cookie for ${name}`).toBeDefined();
  expect(cookie!.value, `${name} should be cleared (empty value)`).toBe("");
  expect(cookie!.path, `${name} should be cleared on path ${expectedPath}`).toBe(expectedPath);
  // Express marks deletion via past Expires date and/or Max-Age=0.
  const isPastExpiry = cookie!.expires?.includes("1970") ?? false;
  const isZeroMaxAge = cookie!.maxAge === "0";
  expect(
    isPastExpiry || isZeroMaxAge,
    `${name} should be expired (Expires=1970 or Max-Age=0), got: ${cookie!.raw}`,
  ).toBe(true);
}

beforeAll(() => {
  app = buildTestApp({ routers: [authRouter] });
  testRunStartedAt = new Date(Date.now() - 1000);
});

afterAll(async () => {
  // Drop any password_reset_attempts rows this file's run inserted (per-IP rows
  // for 127.0.0.1 plus per-email rows for the seeded test users) so repeated
  // runs don't accumulate against the per-identifier daily caps and starve
  // the happy-path tests of reset-slot capacity.
  await db
    .delete(passwordResetAttemptsTable)
    .where(gte(passwordResetAttemptsTable.createdAt, testRunStartedAt));
  if (seededUserIds.length > 0) {
    await db.delete(sessionsTable).where(inArray(sessionsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(async () => {
  sendEmailNowMock.mockClear();
  // Wipe rows this run inserted so each test starts with a fresh per-email
  // and per-IP window — otherwise tests within a single run also accumulate
  // toward the cap (the happy path test alone burns one IP slot).
  await db
    .delete(passwordResetAttemptsTable)
    .where(gte(passwordResetAttemptsTable.createdAt, testRunStartedAt));
});

describe("POST /api/auth/forgot-password", () => {
  /**
   * forgot-password is fire-and-forget: the route sends the response before
   * the DB write and email send finish. Tests must wait for the async work to
   * settle before asserting on side effects.
   */
  async function waitForResetToken(userId: number) {
    return await vi.waitFor(
      async () => {
        const u = await getUser(userId);
        if (!u.resetToken) throw new Error("reset token not yet written");
        return u;
      },
      { timeout: 2000, interval: 25 },
    );
  }

  it("happy path: stores hashed reset token, sends password_reset email, returns generic message", async () => {
    const user = await insertUser("forgot-happy");

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: user.email });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if that email exists/i);

    const updated = await waitForResetToken(user.id);
    // resetToken is stored as sha256(rawToken) — never the raw token itself.
    expect(updated.resetToken).toHaveLength(64);
    expect(updated.resetTokenExpires).toBeInstanceOf(Date);
    expect(updated.resetTokenExpires!.getTime()).toBeGreaterThan(Date.now());

    await vi.waitFor(() => expect(sendEmailNowMock).toHaveBeenCalledTimes(1), {
      timeout: 2000,
      interval: 25,
    });
    const call = sendEmailNowMock.mock.calls[0][0];
    expect(call.templateSlug).toBe("password_reset");
    expect(call.to).toBe(user.email);
    expect(call.userId).toBe(user.id);
    // The email must contain the RAW token (not the hash that's stored in DB).
    expect(call.variables?.reset_token).toBeTruthy();
    expect(call.variables?.reset_token).not.toBe(updated.resetToken);
    const rawHash = crypto
      .createHash("sha256")
      .update(call.variables.reset_token)
      .digest("hex");
    expect(rawHash).toBe(updated.resetToken);
  });

  it("normalizes the email lookup to lowercase", async () => {
    const user = await insertUser("forgot-normalize");

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: user.email.toUpperCase() });

    expect(res.status).toBe(200);
    await waitForResetToken(user.id);
    await vi.waitFor(() => expect(sendEmailNowMock).toHaveBeenCalledTimes(1), {
      timeout: 2000,
      interval: 25,
    });
  });

  it("returns the same generic message and does not send mail when the email is unknown", async () => {
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: `${TEST_TAG}-no-such-user@example.test` });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if that email exists/i);

    // Give the route's background promise a chance to run, then assert nothing
    // happened. (forgot-password's user-lookup happens asynchronously after
    // the response, so we can't assert immediately.)
    await new Promise((r) => setTimeout(r, 100));
    expect(sendEmailNowMock).not.toHaveBeenCalled();
  });

  it("returns the same generic message and does not send mail when the body has no email at all", async () => {
    const res = await request(app).post("/api/auth/forgot-password").send({});

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if that email exists/i);

    await new Promise((r) => setTimeout(r, 100));
    expect(sendEmailNowMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/reset-password", () => {
  it("happy path: updates the password hash, clears the reset token, revokes sessions, and clears auth cookies", async () => {
    const user = await insertUser("reset-happy");
    const token = await seedResetToken(user.id);

    // Two active sessions plus one already-revoked session (must not be reanimated).
    const sessionA = await insertSession(user.id);
    const sessionB = await insertSession(user.id);
    const preRevokedId = await insertSession(user.id);
    const preRevokedAt = new Date(Date.now() - 60 * 1000);
    await db
      .update(sessionsTable)
      .set({ revokedAt: preRevokedAt })
      .where(eq(sessionsTable.id, preRevokedId));

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/password updated successfully/i);

    // Password actually changed and reset token cleared.
    const updated = await getUser(user.id);
    expect(updated.resetToken).toBeNull();
    expect(updated.resetTokenExpires).toBeNull();
    expect(await bcrypt.compare(NEW_PASSWORD, updated.passwordHash)).toBe(true);
    expect(await bcrypt.compare(TEST_PASSWORD, updated.passwordHash)).toBe(false);

    // All previously-active sessions for this user must be revoked.
    const stillActive = await db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.userId, user.id), isNull(sessionsTable.revokedAt)));
    expect(stillActive).toHaveLength(0);

    const sessions = await db
      .select()
      .from(sessionsTable)
      .where(inArray(sessionsTable.id, [sessionA, sessionB, preRevokedId]));
    const byId = new Map(sessions.map((s) => [s.id, s]));
    expect(byId.get(sessionA)!.revokedAt).not.toBeNull();
    expect(byId.get(sessionB)!.revokedAt).not.toBeNull();
    // The pre-revoked session is also touched by the bulk update, but it must
    // still be revoked (the exact timestamp may change — what matters is that
    // it's not active again).
    expect(byId.get(preRevokedId)!.revokedAt).not.toBeNull();

    // Set-Cookie headers must clear all three auth cookies on the right paths.
    const cookies = parseSetCookies(res);
    expectClearedCookie(cookies, "access_token", "/");
    expectClearedCookie(cookies, "refresh_token", "/api/auth");
    expectClearedCookie(cookies, "csrf_token", "/");
  });

  it("returns 400 when the token is missing", async () => {
    const user = await insertUser("reset-no-token");
    const beforeHash = (await getUser(user.id)).passwordHash;

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token and new password are required/i);
    // Password unchanged.
    expect((await getUser(user.id)).passwordHash).toBe(beforeHash);
    // No cookies should be cleared on a validation failure.
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("returns 400 when the password is missing", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "anything" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token and new password are required/i);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("returns 400 for a token that does not match any user (invalid / never issued)", async () => {
    const user = await insertUser("reset-invalid-token");
    await seedResetToken(user.id);
    const sessionId = await insertSession(user.id);
    const beforeHash = (await getUser(user.id)).passwordHash;

    const bogusToken = crypto.randomBytes(32).toString("hex");
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: bogusToken, password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired reset token/i);

    // Nothing changed: password, sessions, reset token all preserved.
    const after = await getUser(user.id);
    expect(after.passwordHash).toBe(beforeHash);
    expect(after.resetToken).not.toBeNull();
    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId));
    expect(session.revokedAt).toBeNull();
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("returns 400 when the token is expired and leaves the user untouched", async () => {
    const user = await insertUser("reset-expired");
    const token = await seedResetToken(user.id, new Date(Date.now() - 60 * 1000));
    const sessionId = await insertSession(user.id);
    const beforeHash = (await getUser(user.id)).passwordHash;

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired reset token/i);

    const after = await getUser(user.id);
    expect(after.passwordHash).toBe(beforeHash);
    // Expired token rows are not auto-cleared by reset-password; they stay
    // until forgot-password is requested again.
    expect(after.resetToken).not.toBeNull();

    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId));
    expect(session.revokedAt).toBeNull();
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("returns 400 when the new password is too short and does not consume the token", async () => {
    const user = await insertUser("reset-weak-short");
    const token = await seedResetToken(user.id);
    const beforeHash = (await getUser(user.id)).passwordHash;

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "Ab1!" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 8 characters/i);

    // Token still usable; password unchanged.
    const after = await getUser(user.id);
    expect(after.passwordHash).toBe(beforeHash);
    expect(after.resetToken).not.toBeNull();
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("returns 400 when the new password has no digits and does not consume the token", async () => {
    const user = await insertUser("reset-weak-no-digit");
    const token = await seedResetToken(user.id);

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "OnlyLettersHere!" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 8 characters/i);

    const after = await getUser(user.id);
    expect(after.resetToken).not.toBeNull();
  });

  it("returns 400 when the new password has no letters and does not consume the token", async () => {
    const user = await insertUser("reset-weak-no-letter");
    const token = await seedResetToken(user.id);

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "12345678!" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 8 characters/i);

    const after = await getUser(user.id);
    expect(after.resetToken).not.toBeNull();
  });

  it("makes the reset token single-use: a second reset with the same token fails", async () => {
    const user = await insertUser("reset-single-use");
    const token = await seedResetToken(user.id);

    const first = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: NEW_PASSWORD });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "AnotherPass1234!" });
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/invalid or expired reset token/i);
  });
});
