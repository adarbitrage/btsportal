import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { randomUUID } from "crypto";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { eq, inArray, and, isNull, sql } from "drizzle-orm";

const { sendEmailNowMock, queueGHLSyncMock, emitWebhookEventMock } = vi.hoisted(() => ({
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

// These tests don't trigger any Redis-backed code paths, but stub for safety.
vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestApp } from "./test-app";
import authRouter from "../routes/auth";

const TEST_PASSWORD = "OriginalPassw0rd!";
const TEST_TAG = `auth-refresh-logout-test-${randomUUID().slice(0, 8)}`;

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

/**
 * Insert a session row directly. Returns the raw refresh token (the value
 * the browser would have stored as the `refresh_token` cookie) plus the
 * inserted session id, so tests can assert on its post-state.
 */
async function insertSession(
  userId: number,
  opts: { expiresAt?: Date; revokedAt?: Date | null } = {},
): Promise<{ id: number; refreshToken: string; refreshTokenHash: string }> {
  const refreshToken = crypto.randomBytes(48).toString("hex");
  const refreshTokenHash = crypto
    .createHash("sha256")
    .update(refreshToken)
    .digest("hex");
  const [row] = await db
    .insert(sessionsTable)
    .values({
      userId,
      refreshTokenHash,
      expiresAt:
        opts.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revokedAt: opts.revokedAt ?? null,
    })
    .returning({ id: sessionsTable.id });
  return { id: row.id, refreshToken, refreshTokenHash };
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
    const segments = header.split(";").map((s) => s.trim());
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

/**
 * Express's res.clearCookie always emits an empty value plus a past Expires
 * date and/or Max-Age=0. Assert the cookie was deleted on the expected path.
 */
function expectClearedCookie(
  cookies: ParsedCookie[],
  name: string,
  expectedPath: string,
) {
  const cookie = cookies.find((c) => c.name === name);
  expect(cookie, `expected Set-Cookie for ${name}`).toBeDefined();
  expect(cookie!.value, `${name} should be cleared (empty value)`).toBe("");
  expect(cookie!.path, `${name} should be cleared on path ${expectedPath}`).toBe(
    expectedPath,
  );
  const isPastExpiry = cookie!.expires?.includes("1970") ?? false;
  const isZeroMaxAge = cookie!.maxAge === "0";
  expect(
    isPastExpiry || isZeroMaxAge,
    `${name} should be expired (Expires=1970 or Max-Age=0), got: ${cookie!.raw}`,
  ).toBe(true);
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
  queueGHLSyncMock.mockClear();
  emitWebhookEventMock.mockClear();
});

describe("POST /api/auth/refresh — happy path", () => {
  it("rotates the refresh token: revokes the old session, inserts a new non-revoked one whose hash matches the new cookie, and re-sets all three auth cookies on the right paths", async () => {
    const user = await insertUser("refresh-happy");
    const original = await insertSession(user.id);

    const res = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", [`refresh_token=${original.refreshToken}`]);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: user.id,
      email: user.email,
      name: user.name,
      role: "member",
    });

    // Three cookies, on the documented paths.
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
    // The new refresh token must NOT equal the one we sent in.
    expect(refresh!.value).not.toBe(original.refreshToken);

    expect(csrf, "csrf_token cookie").toBeDefined();
    expect(csrf!.value).toHaveLength(64); // 32 random bytes hex-encoded
    expect(csrf!.path).toBe("/");
    // CSRF cookie is intentionally readable by JS so the SPA can echo it.
    expect(csrf!.httpOnly).toBe(false);

    // The original session row is now revoked.
    const [oldSession] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, original.id));
    expect(oldSession.revokedAt).toBeInstanceOf(Date);

    // Exactly one non-revoked session for this user, and its hash matches
    // the new refresh-token cookie we just received.
    const active = await db
      .select()
      .from(sessionsTable)
      .where(
        and(eq(sessionsTable.userId, user.id), isNull(sessionsTable.revokedAt)),
      );
    expect(active).toHaveLength(1);
    expect(active[0].id).not.toBe(original.id);
    const expectedHash = crypto
      .createHash("sha256")
      .update(refresh!.value)
      .digest("hex");
    expect(active[0].refreshTokenHash).toBe(expectedHash);
    expect(active[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("does not touch unrelated active sessions belonging to the same user", async () => {
    const user = await insertUser("refresh-other-sessions");
    const target = await insertSession(user.id);
    const other = await insertSession(user.id);

    const res = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", [`refresh_token=${target.refreshToken}`]);
    expect(res.status).toBe(200);

    const [otherAfter] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, other.id));
    expect(otherAfter.revokedAt).toBeNull();
  });
});

describe("POST /api/auth/refresh — error paths", () => {
  it("returns 401 with no refresh_token cookie at all", async () => {
    const res = await request(app).post("/api/auth/refresh");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "No refresh token" });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("returns 401 for an unknown refresh token (no matching session row)", async () => {
    const bogus = crypto.randomBytes(48).toString("hex");

    const res = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", [`refresh_token=${bogus}`]);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired refresh token" });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("returns 401 when the session has already been revoked", async () => {
    const user = await insertUser("refresh-revoked");
    const revokedAt = new Date(Date.now() - 60 * 1000);
    const session = await insertSession(user.id, { revokedAt });

    const res = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", [`refresh_token=${session.refreshToken}`]);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired refresh token" });
    expect(res.headers["set-cookie"]).toBeUndefined();

    // The revokedAt timestamp must not have been overwritten.
    const [after] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, session.id));
    expect(after.revokedAt).toBeInstanceOf(Date);
    expect(after.revokedAt!.getTime()).toBe(revokedAt.getTime());
  });

  it("returns 401 when the session's expiresAt is in the past", async () => {
    const user = await insertUser("refresh-expired");
    const expired = new Date(Date.now() - 60 * 1000);
    const session = await insertSession(user.id, { expiresAt: expired });

    const res = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", [`refresh_token=${session.refreshToken}`]);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired refresh token" });
    expect(res.headers["set-cookie"]).toBeUndefined();

    // The expired session is not auto-revoked by the failed lookup; it just
    // can't be used. (Cleanup is handled by the auth-token-cleanup job.)
    const [after] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, session.id));
    expect(after.revokedAt).toBeNull();
  });
});

describe("POST /api/auth/refresh — orphaned session (user hard-deleted)", () => {
  const SESSIONS_USER_FK = "sessions_user_id_users_id_fk";

  /**
   * Removes a user row while leaving one of their session rows intact. The
   * sessions table now has ON DELETE CASCADE on `user_id`, so a plain
   * `DELETE FROM users` would also wipe the session and there'd be no
   * orphan left to test against. To recreate the operationally-rare case
   * where a session ends up orphaned (e.g. a manual fix-up that bypassed
   * cascade, or a row that pre-dates the cascade migration), we drop the
   * FK, delete the user, and re-add the FK as NOT VALID inside the same
   * transaction.
   *
   * The re-added FK must match the production schema's ON DELETE CASCADE
   * — otherwise this helper would silently downgrade the constraint and
   * break the cascade contract for every test that runs after this one.
   *
   * NOT VALID skips validation of existing rows (the orphan we just made)
   * but still enforces the constraint for any future insert or update, so
   * other tests touching the sessions table continue to get full FK
   * protection. After the orphan is cleaned up, `restoreFkValidation`
   * marks the constraint VALID again so the schema state matches what
   * drizzle expects.
   *
   * Uses only standard DDL — no superuser-only settings — so it works
   * portably across CI/db environments.
   */
  async function deleteUserBypassingFk(userId: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql.raw(
          `ALTER TABLE sessions DROP CONSTRAINT IF EXISTS ${SESSIONS_USER_FK}`,
        ),
      );
      await tx.execute(sql`DELETE FROM users WHERE id = ${userId}`);
      await tx.execute(
        sql.raw(
          `ALTER TABLE sessions ADD CONSTRAINT ${SESSIONS_USER_FK} FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID`,
        ),
      );
    });
  }

  async function restoreFkValidation(): Promise<void> {
    await db.execute(
      sql.raw(
        `ALTER TABLE sessions VALIDATE CONSTRAINT ${SESSIONS_USER_FK}`,
      ),
    );
  }

  it("returns 401 'User not found' and revokes the orphaned session row inline so it can't keep showing up on every refresh", async () => {
    const user = await insertUser("refresh-orphaned");
    const session = await insertSession(user.id);

    // Hard-delete the user out from under the session, leaving the row
    // orphaned but otherwise valid (not revoked, not expired).
    await deleteUserBypassingFk(user.id);
    // The user is gone now, so don't try to clean it up in afterAll.
    const idx = seededUserIds.indexOf(user.id);
    if (idx !== -1) seededUserIds.splice(idx, 1);

    try {
      const res = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", [`refresh_token=${session.refreshToken}`]);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "User not found" });
      // No new cookies should be set on this failure path. In particular,
      // we must not rotate or clear cookies — the caller's other tabs may
      // still be operating against a different (valid) session.
      expect(res.headers["set-cookie"]).toBeUndefined();

      // The orphaned session row is now revoked inline so a retry of the
      // same refresh-token cookie falls through the "Invalid or expired"
      // branch instead of repeatedly hitting the User-not-found path, and
      // the row no longer sits in the sessions table waiting for the
      // auth-token-cleanup job to expire it. The token hash itself is
      // intentionally left untouched so an admin can still trace which
      // session row belonged to which (now-deleted) user if they need to.
      const [after] = await db
        .select()
        .from(sessionsTable)
        .where(eq(sessionsTable.id, session.id));
      expect(after).toBeDefined();
      expect(after.revokedAt).toBeInstanceOf(Date);
      expect(after.refreshTokenHash).toBe(session.refreshTokenHash);
    } finally {
      // Always clean up the orphan + restore the FK to fully VALID, even
      // if the test assertions above threw — otherwise the schema would
      // be left with a NOT VALID constraint and bleed into later tests.
      await db.delete(sessionsTable).where(eq(sessionsTable.id, session.id));
      await restoreFkValidation();
    }
  });
});

describe("POST /api/auth/logout", () => {
  it("happy path: marks the matching session row revokedAt and clears all three auth cookies on the same paths login uses", async () => {
    const user = await insertUser("logout-happy");
    const session = await insertSession(user.id);

    const res = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", [`refresh_token=${session.refreshToken}`]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    // Matching session is now revoked.
    const [after] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, session.id));
    expect(after.revokedAt).toBeInstanceOf(Date);

    // All three auth cookies are cleared, on the same paths login set them on.
    const cookies = parseSetCookies(res);
    expectClearedCookie(cookies, "access_token", "/");
    expectClearedCookie(cookies, "refresh_token", "/api/auth");
    expectClearedCookie(cookies, "csrf_token", "/");
  });

  it("does not revoke unrelated active sessions belonging to the same user", async () => {
    const user = await insertUser("logout-other-sessions");
    const target = await insertSession(user.id);
    const other = await insertSession(user.id);

    const res = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", [`refresh_token=${target.refreshToken}`]);
    expect(res.status).toBe(200);

    const [otherAfter] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, other.id));
    expect(otherAfter.revokedAt).toBeNull();

    const [targetAfter] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, target.id));
    expect(targetAfter.revokedAt).toBeInstanceOf(Date);
  });

  it("returns 200 and still clears all three cookies when called with no refresh-token cookie", async () => {
    const res = await request(app).post("/api/auth/logout");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    const cookies = parseSetCookies(res);
    expectClearedCookie(cookies, "access_token", "/");
    expectClearedCookie(cookies, "refresh_token", "/api/auth");
    expectClearedCookie(cookies, "csrf_token", "/");
  });

  it("returns 200 and clears cookies even when the refresh token is unknown (no DB rows touched)", async () => {
    const user = await insertUser("logout-unknown");
    const existing = await insertSession(user.id);

    const bogus = crypto.randomBytes(48).toString("hex");
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", [`refresh_token=${bogus}`]);

    expect(res.status).toBe(200);

    // The unrelated existing session must not be revoked.
    const [after] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, existing.id));
    expect(after.revokedAt).toBeNull();

    const cookies = parseSetCookies(res);
    expectClearedCookie(cookies, "access_token", "/");
    expectClearedCookie(cookies, "refresh_token", "/api/auth");
    expectClearedCookie(cookies, "csrf_token", "/");
  });
});
