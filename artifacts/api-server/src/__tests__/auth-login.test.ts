import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { randomUUID } from "crypto";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { eq, inArray, and, isNull } from "drizzle-orm";

const { sendEmailNowMock, queueEmailMock, queueGHLSyncMock, emitWebhookEventMock } = vi.hoisted(() => ({
  sendEmailNowMock: vi.fn(async (..._args: any[]) => ({ success: true })),
  queueEmailMock: vi.fn(async (..._args: any[]) => ({ result: "queued" })),
  queueGHLSyncMock: vi.fn(async (..._args: any[]) => "job_test_id"),
  emitWebhookEventMock: vi.fn(async () => undefined),
}));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    sendEmailNow: sendEmailNowMock,
    queueEmail: queueEmailMock,
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

// No email-change history is seeded by these tests, so the recently-changed
// hint never fires and Redis is never touched. Stubbed for safety regardless.
vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestApp } from "./test-app";
import authRouter from "../routes/auth";

const TEST_PASSWORD = "OriginalPassw0rd!";
const WRONG_PASSWORD = "DefinitelyNotIt9!";
const TEST_TAG = `auth-login-test-${randomUUID().slice(0, 8)}`;

interface SeededUser {
  id: number;
  email: string;
  name: string;
}

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestApp>;

async function insertUser(suffix: string): Promise<SeededUser> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
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

interface ParsedCookie {
  name: string;
  value: string;
  path?: string;
  expires?: string;
  maxAge?: string;
  httpOnly: boolean;
  raw: string;
}

function parseSetCookies(res: request.Response): ParsedCookie[] {
  const raw = res.headers["set-cookie"];
  const headers = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return headers.map((header) => {
    const segments = header.split(";").map((s: string) => s.trim());
    const [nameValue, ...attrs] = segments;
    const eqIdx = nameValue.indexOf("=");
    const name = eqIdx === -1 ? nameValue : nameValue.slice(0, eqIdx);
    const value = eqIdx === -1 ? "" : nameValue.slice(eqIdx + 1);
    const parsed: ParsedCookie = { name, value, raw: header, httpOnly: false };
    for (const attr of attrs) {
      const [k, v = ""] = attr.split("=");
      const key = k.toLowerCase();
      if (key === "path") parsed.path = v;
      else if (key === "expires") parsed.expires = v;
      else if (key === "max-age") parsed.maxAge = v;
      else if (key === "httponly") parsed.httpOnly = true;
    }
    return parsed;
  });
}

beforeAll(() => {
  app = buildTestApp({ routers: [authRouter] });
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(sessionsTable).where(inArray(sessionsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  sendEmailNowMock.mockClear();
  queueEmailMock.mockClear();
  queueGHLSyncMock.mockClear();
  emitWebhookEventMock.mockClear();
});

describe("POST /api/auth/login — happy path", () => {
  it("returns 200, sets access/refresh/csrf cookies on the right paths, creates a non-revoked session, resets failedLoginCount and stamps lastLoginAt", async () => {
    const user = await insertUser("happy");

    // Pre-load some failures so we can prove they're cleared on success.
    await db
      .update(usersTable)
      .set({ failedLoginCount: 3, lastLoginAt: null })
      .where(eq(usersTable.id, user.id));

    const before = Date.now();
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });
    const after = Date.now();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: user.id,
      email: user.email,
      name: user.name,
      role: "member",
    });

    // Cookies: three of them, on the documented paths.
    const cookies = parseSetCookies(res);
    const access = cookies.find((c) => c.name === "access_token");
    const refresh = cookies.find((c) => c.name === "refresh_token");
    const csrf = cookies.find((c) => c.name === "csrf_token");

    expect(access, "access_token cookie").toBeDefined();
    expect(access!.value.length).toBeGreaterThan(20);
    expect(access!.path).toBe("/");
    expect(access!.httpOnly).toBe(true);

    expect(refresh, "refresh_token cookie").toBeDefined();
    expect(refresh!.value).toHaveLength(96); // 48 random bytes hex-encoded
    expect(refresh!.path).toBe("/api/auth");
    expect(refresh!.httpOnly).toBe(true);

    expect(csrf, "csrf_token cookie").toBeDefined();
    expect(csrf!.value).toHaveLength(64); // 32 random bytes hex-encoded
    expect(csrf!.path).toBe("/");
    // CSRF cookie is intentionally readable by JS so the SPA can echo it.
    expect(csrf!.httpOnly).toBe(false);

    // A new, non-revoked session row exists for this user, and its hash
    // matches the refresh-token cookie we just received.
    const sessions = await db
      .select()
      .from(sessionsTable)
      .where(and(eq(sessionsTable.userId, user.id), isNull(sessionsTable.revokedAt)));
    expect(sessions).toHaveLength(1);
    const expectedHash = crypto
      .createHash("sha256")
      .update(refresh!.value)
      .digest("hex");
    expect(sessions[0].refreshTokenHash).toBe(expectedHash);
    expect(sessions[0].expiresAt.getTime()).toBeGreaterThan(Date.now());

    // failedLoginCount cleared, lockedUntil null, lastLoginAt stamped to ~now.
    const updated = await getUser(user.id);
    expect(updated.failedLoginCount).toBe(0);
    expect(updated.lockedUntil).toBeNull();
    expect(updated.lastLoginAt).toBeInstanceOf(Date);
    expect(updated.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(updated.lastLoginAt!.getTime()).toBeLessThanOrEqual(after + 5);
  });

  it("normalizes the email lookup to lowercase", async () => {
    const user = await insertUser("normalize");

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email.toUpperCase(), password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(user.email);
  });

  it("queues a GHL sync on the first login of the day but not on a back-to-back login", async () => {
    const user = await insertUser("ghl-sync");

    // First login: lastLoginAt is null, so the >24h branch fires.
    const first = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(first.status).toBe(200);
    expect(queueGHLSyncMock).toHaveBeenCalledTimes(1);
    expect(queueGHLSyncMock.mock.calls[0][0]).toMatchObject({
      action: "update_contact",
      userId: user.id,
      email: user.email,
    });

    // Second immediate login: lastLoginAt is now <24h ago, so no extra sync.
    queueGHLSyncMock.mockClear();
    const second = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(second.status).toBe(200);
    expect(queueGHLSyncMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/login — new-device sign-in notice", () => {
  it("does NOT send a notice on the very first sign-in (no prior sessions)", async () => {
    const user = await insertUser("new-device-first");

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(queueEmailMock).not.toHaveBeenCalled();
  });

  it("does NOT send a notice when signing in again from the same device", async () => {
    const user = await insertUser("new-device-same");

    // First login establishes a session for this User-Agent.
    const first = await request(app)
      .post("/api/auth/login")
      .set("User-Agent", "KnownBrowser/1.0")
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(first.status).toBe(200);
    expect(queueEmailMock).not.toHaveBeenCalled();

    // Second login from the same User-Agent: still recognized, no notice.
    const second = await request(app)
      .post("/api/auth/login")
      .set("User-Agent", "KnownBrowser/1.0")
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(second.status).toBe(200);
    expect(queueEmailMock).not.toHaveBeenCalled();
  });

  it("queues a security notice when signing in from a new device, addressed to the member with a device label and IP", async () => {
    const user = await insertUser("new-device-unfamiliar");

    // Seed a prior session for a *different* User-Agent so this account has
    // a known-device history that the next login won't match.
    const first = await request(app)
      .post("/api/auth/login")
      .set("User-Agent", "OldBrowser/1.0")
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(first.status).toBe(200);
    expect(queueEmailMock).not.toHaveBeenCalled();

    // Login from a brand-new User-Agent → unfamiliar device → notice.
    const second = await request(app)
      .post("/api/auth/login")
      .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36")
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(second.status).toBe(200);

    expect(queueEmailMock).toHaveBeenCalledTimes(1);
    const call = queueEmailMock.mock.calls[0][0];
    expect(call).toMatchObject({
      templateSlug: "new_device_signin",
      to: user.email,
      userId: user.id,
    });
    expect(call.variables.member_name).toBe(user.name);
    expect(call.variables.device_description).toBe("Chrome on Windows");
    expect(typeof call.variables.ip_address).toBe("string");
    expect(call.variables.ip_address.length).toBeGreaterThan(0);
    expect(typeof call.variables.sign_in_time).toBe("string");
  });

  it("does not fail the login if the notice send throws", async () => {
    const user = await insertUser("new-device-throws");

    await request(app)
      .post("/api/auth/login")
      .set("User-Agent", "OldBrowser/2.0")
      .send({ email: user.email, password: TEST_PASSWORD });

    queueEmailMock.mockRejectedValueOnce(new Error("mailer down"));

    const res = await request(app)
      .post("/api/auth/login")
      .set("User-Agent", "BrandNewBrowser/9.9")
      .send({ email: user.email, password: TEST_PASSWORD });

    // Login still succeeds even though the notice send rejected.
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user.id);
    expect(queueEmailMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/auth/login — error paths (no user-enumeration leak)", () => {
  it("returns 400 when email is missing", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email and password are required/i);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("returns 400 when password is missing", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `${TEST_TAG}-anyone@example.test` });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email and password are required/i);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("returns 401 with a generic 'Invalid credentials' for an unknown email", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: `${TEST_TAG}-no-such-user@example.test`,
        password: TEST_PASSWORD,
      });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid credentials" });
    // Critical: must not leak whether the email or the password was wrong.
    expect(JSON.stringify(res.body)).not.toMatch(/email/i);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    expect(JSON.stringify(res.body)).not.toMatch(/not found|unknown|exists/i);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("returns 401 with the same generic 'Invalid credentials' for a real user with the wrong password", async () => {
    const user = await insertUser("wrong-pw-leak");

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: WRONG_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid credentials" });
    expect(JSON.stringify(res.body)).not.toMatch(/email/i);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    expect(res.headers["set-cookie"]).toBeUndefined();

    // No session created for a failed login.
    const sessions = await db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, user.id));
    expect(sessions).toHaveLength(0);
  });
});

describe("POST /api/auth/login — account lockout", () => {
  it("locks the account ~15 minutes after 5 wrong-password attempts and rejects the 6th attempt with 423 even if the password is correct", async () => {
    const user = await insertUser("lockout");

    // Five wrong-password attempts, each increments failedLoginCount.
    for (let i = 1; i <= 5; i++) {
      const before = Date.now();
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: user.email, password: WRONG_PASSWORD });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid credentials");

      const u = await getUser(user.id);
      expect(u.failedLoginCount).toBe(i);
      if (i < 5) {
        expect(u.lockedUntil).toBeNull();
      } else {
        // The 5th failure should set lockedUntil ~15 minutes in the future.
        expect(u.lockedUntil).toBeInstanceOf(Date);
        const lockMs = u.lockedUntil!.getTime();
        const expected = before + 15 * 60 * 1000;
        // Wide tolerance: the route uses Date.now() *after* bcrypt.compare,
        // and the test process might be slow under coverage. ±10s is plenty.
        expect(lockMs).toBeGreaterThanOrEqual(expected - 1_000);
        expect(lockMs).toBeLessThanOrEqual(expected + 10_000);
      }
    }

    // 6th attempt — now with the *correct* password — must still be blocked.
    const sixth = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(sixth.status).toBe(423);
    expect(sixth.body.error).toMatch(/account temporarily locked/i);
    expect(sixth.body.error).toMatch(/minute/i);
    // No cookies, no session row created while locked.
    expect(sixth.headers["set-cookie"]).toBeUndefined();
    const sessions = await db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, user.id));
    expect(sessions).toHaveLength(0);

    // failedLoginCount must NOT be bumped further while the account is locked
    // (the 423 short-circuits before the wrong-password branch).
    const after = await getUser(user.id);
    expect(after.failedLoginCount).toBe(5);
  });

  it("a successful login after a stale lock (lockedUntil in the past) clears lockedUntil and failedLoginCount", async () => {
    const user = await insertUser("stale-lock");

    // Simulate a lockout that has already expired.
    const stale = new Date(Date.now() - 60 * 1000);
    await db
      .update(usersTable)
      .set({ failedLoginCount: 5, lockedUntil: stale })
      .where(eq(usersTable.id, user.id));

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user.id);

    const after = await getUser(user.id);
    expect(after.lockedUntil).toBeNull();
    expect(after.failedLoginCount).toBe(0);
    expect(after.lastLoginAt).toBeInstanceOf(Date);

    // A real session row was created.
    const sessions = await db
      .select()
      .from(sessionsTable)
      .where(and(eq(sessionsTable.userId, user.id), isNull(sessionsTable.revokedAt)));
    expect(sessions).toHaveLength(1);
  });

  it("a wrong-password attempt after a stale lock resets the counter to 1 and does NOT immediately re-lock the account", async () => {
    const user = await insertUser("stale-lock-wrong-pw");

    // Account hit the 5-strike lock, sat past the 15-minute window.
    const stale = new Date(Date.now() - 60 * 1000);
    await db
      .update(usersTable)
      .set({ failedLoginCount: 5, lockedUntil: stale })
      .where(eq(usersTable.id, user.id));

    // One more wrong password after the lock window must NOT re-lock the
    // account. The 5-strike budget should have refreshed: this is attempt #1
    // of a new window, not attempt #6 of the previous one.
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: WRONG_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid credentials" });

    const after = await getUser(user.id);
    expect(after.failedLoginCount).toBe(1);
    expect(after.lockedUntil).toBeNull();
  });

  it("a wrong-password attempt during an active lock is rejected with 423 and does not bump failedLoginCount further", async () => {
    const user = await insertUser("active-lock-wrong-pw");

    const future = new Date(Date.now() + 10 * 60 * 1000);
    await db
      .update(usersTable)
      .set({ failedLoginCount: 5, lockedUntil: future })
      .where(eq(usersTable.id, user.id));

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: WRONG_PASSWORD });

    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/account temporarily locked/i);

    const after = await getUser(user.id);
    expect(after.failedLoginCount).toBe(5);
    expect(after.lockedUntil!.getTime()).toBe(future.getTime());
  });
});
