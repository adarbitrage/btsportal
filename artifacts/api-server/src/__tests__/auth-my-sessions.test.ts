import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { randomUUID } from "crypto";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// These tests don't trigger email/GHL/webhook/Redis paths, but the auth
// router imports them at module load, so stub for safety.
vi.mock("../lib/communication-service", () => ({
  CommunicationService: { sendEmailNow: vi.fn(async () => ({ success: true })) },
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
vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestApp } from "./test-app";
import authRouter from "../routes/auth";
import { generateAccessToken } from "../middleware/auth";

const TEST_PASSWORD = "OriginalPassw0rd!";
const TEST_TAG = `auth-my-sessions-test-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestApp>;

interface SeededUser {
  id: number;
  email: string;
  name: string;
}

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

async function insertSession(
  userId: number,
  opts: {
    expiresAt?: Date;
    revokedAt?: Date | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    createdAt?: Date;
    lastSeenAt?: Date;
  } = {},
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
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revokedAt: opts.revokedAt ?? null,
      ipAddress: opts.ipAddress ?? null,
      userAgent: opts.userAgent ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      ...(opts.lastSeenAt ? { lastSeenAt: opts.lastSeenAt } : {}),
    })
    .returning({ id: sessionsTable.id });
  return { id: row.id, refreshToken, refreshTokenHash };
}

// Builds the cookie header a signed-in browser would send: the access_token
// JWT that `authenticate` verifies into req.userId, plus optionally the
// refresh_token that the /auth/sessions endpoints use to flag "this device".
function authCookies(user: SeededUser, refreshToken?: string): string[] {
  const access = generateAccessToken(user.id, user.email);
  const cookies = [`access_token=${access}`];
  if (refreshToken) cookies.push(`refresh_token=${refreshToken}`);
  return cookies;
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

describe("GET /api/auth/sessions", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/auth/sessions");
    expect(res.status).toBe(401);
  });

  it("lists only the caller's active sessions, newest-activity first, flagging the current one", async () => {
    const user = await insertUser("list");
    const other = await insertUser("list-other");

    const older = await insertSession(user.id, {
      lastSeenAt: new Date(Date.now() - 60 * 60 * 1000),
      ipAddress: "10.0.0.1",
      userAgent: "OldBrowser/1.0",
    });
    const current = await insertSession(user.id, {
      lastSeenAt: new Date(),
      ipAddress: "10.0.0.2",
      userAgent: "CurrentBrowser/2.0",
    });
    // Noise that must NOT appear: revoked, expired, and another user's session.
    await insertSession(user.id, { revokedAt: new Date() });
    await insertSession(user.id, { expiresAt: new Date(Date.now() - 1000) });
    await insertSession(other.id);

    const res = await request(app)
      .get("/api/auth/sessions")
      .set("Cookie", authCookies(user, current.refreshToken));

    expect(res.status).toBe(200);
    const sessions = res.body.sessions as Array<{
      id: number;
      current: boolean;
      ipAddress: string | null;
      userAgent: string | null;
    }>;
    expect(sessions.map((s) => s.id)).toEqual([current.id, older.id]);
    expect(sessions.find((s) => s.id === current.id)!.current).toBe(true);
    expect(sessions.find((s) => s.id === older.id)!.current).toBe(false);
    expect(sessions.find((s) => s.id === current.id)!.userAgent).toBe(
      "CurrentBrowser/2.0",
    );
  });

  it("flags no session as current when the refresh cookie is absent", async () => {
    const user = await insertUser("list-no-refresh");
    await insertSession(user.id);

    const res = await request(app)
      .get("/api/auth/sessions")
      .set("Cookie", authCookies(user));

    expect(res.status).toBe(200);
    expect(res.body.sessions.every((s: { current: boolean }) => !s.current)).toBe(
      true,
    );
  });
});

describe("POST /api/auth/sessions/:sessionId/revoke", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(app).post("/api/auth/sessions/1/revoke");
    expect(res.status).toBe(401);
  });

  it("revokes one of the caller's own sessions and reports revoked:true", async () => {
    const user = await insertUser("revoke-one");
    const target = await insertSession(user.id);
    const keep = await insertSession(user.id);

    const res = await request(app)
      .post(`/api/auth/sessions/${target.id}/revoke`)
      .set("Cookie", authCookies(user, keep.refreshToken));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, sessionId: target.id, revoked: true });

    const [targetAfter] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, target.id));
    expect(targetAfter.revokedAt).toBeInstanceOf(Date);

    const [keepAfter] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, keep.id));
    expect(keepAfter.revokedAt).toBeNull();
  });

  it("reports revoked:false when the session was already revoked", async () => {
    const user = await insertUser("revoke-already");
    const target = await insertSession(user.id, { revokedAt: new Date() });

    const res = await request(app)
      .post(`/api/auth/sessions/${target.id}/revoke`)
      .set("Cookie", authCookies(user));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ revoked: false });
  });

  it("returns 404 and does not touch a session belonging to another user", async () => {
    const user = await insertUser("revoke-cross-a");
    const victim = await insertUser("revoke-cross-b");
    const victimSession = await insertSession(victim.id);

    const res = await request(app)
      .post(`/api/auth/sessions/${victimSession.id}/revoke`)
      .set("Cookie", authCookies(user));

    expect(res.status).toBe(404);

    const [after] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, victimSession.id));
    expect(after.revokedAt).toBeNull();
  });
});

describe("POST /api/auth/sessions/revoke-others", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(app).post("/api/auth/sessions/revoke-others");
    expect(res.status).toBe(401);
  });

  it("returns 400 when the current session can't be identified (no refresh cookie)", async () => {
    const user = await insertUser("revoke-others-no-refresh");
    const a = await insertSession(user.id);

    const res = await request(app)
      .post("/api/auth/sessions/revoke-others")
      .set("Cookie", authCookies(user));

    expect(res.status).toBe(400);

    // Nothing was revoked.
    const [after] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, a.id));
    expect(after.revokedAt).toBeNull();
  });

  it("revokes every active session except the current one", async () => {
    const user = await insertUser("revoke-others");
    const other = await insertUser("revoke-others-bystander");
    const current = await insertSession(user.id);
    const a = await insertSession(user.id);
    const b = await insertSession(user.id);
    const alreadyRevoked = await insertSession(user.id, { revokedAt: new Date() });
    const bystander = await insertSession(other.id);

    const res = await request(app)
      .post("/api/auth/sessions/revoke-others")
      .set("Cookie", authCookies(user, current.refreshToken));

    expect(res.status).toBe(200);
    // a + b are the only two newly-revoked active sessions.
    expect(res.body).toEqual({ success: true, revokedSessionCount: 2 });

    const [currentAfter] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, current.id));
    expect(currentAfter.revokedAt).toBeNull();

    for (const s of [a, b]) {
      const [after] = await db
        .select()
        .from(sessionsTable)
        .where(eq(sessionsTable.id, s.id));
      expect(after.revokedAt).toBeInstanceOf(Date);
    }

    // Another user's session is untouched.
    const [bystanderAfter] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, bystander.id));
    expect(bystanderAfter.revokedAt).toBeNull();

    // Pre-revoked row keeps its original revokedAt (not double-counted).
    const [revokedAfter] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, alreadyRevoked.id));
    expect(revokedAfter.revokedAt).toBeInstanceOf(Date);
  });
});
