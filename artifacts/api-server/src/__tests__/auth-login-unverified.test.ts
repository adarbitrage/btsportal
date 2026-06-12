import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const { sendEmailNowMock, queueGHLSyncMock, emitWebhookEventMock } = vi.hoisted(() => ({
  sendEmailNowMock: vi.fn(async (..._args: any[]) => ({ success: true })),
  queueGHLSyncMock: vi.fn(async (..._args: any[]) => "job_test_id"),
  emitWebhookEventMock: vi.fn(async (..._args: any[]) => undefined),
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

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestApp } from "./test-app";
import authRouter, { processResendVerificationRequest } from "../routes/auth";

const PASSWORD = "Sup3rSecret!";
const TEST_TAG = `auth-unverified-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestApp>;

interface SeededUser {
  id: number;
  email: string;
  name: string;
}

async function insertUser(
  suffix: string,
  options: { emailVerified: boolean } = { emailVerified: true },
): Promise<SeededUser> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
  const name = `Test ${suffix}`;
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name,
      passwordHash,
      role: "member",
      emailVerified: options.emailVerified,
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

describe("POST /api/auth/login — unverified account", () => {
  it("returns 403 + emailUnverified=true on a correct password against an unverified user, and does NOT mint a session", async () => {
    const user = await insertUser("login-unverified", { emailVerified: false });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.emailUnverified).toBe(true);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error).toMatch(/verif/i);

    // No cookies, no session.
    expect(res.headers["set-cookie"]).toBeUndefined();
    const sessions = await db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, user.id));
    expect(sessions).toHaveLength(0);

    // We don't update lastLoginAt on the unverified path — they didn't log in.
    const after = await getUser(user.id);
    expect(after.lastLoginAt).toBeNull();
    expect(after.emailVerified).toBe(false);
  });

  it("clears any prior failedLoginCount when the password is correct on an unverified account (so the user can't lock themselves out by retrying)", async () => {
    const user = await insertUser("unverified-clears-count", { emailVerified: false });
    await db
      .update(usersTable)
      .set({ failedLoginCount: 3, lockedUntil: null })
      .where(eq(usersTable.id, user.id));

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.emailUnverified).toBe(true);

    const after = await getUser(user.id);
    expect(after.failedLoginCount).toBe(0);
    expect(after.lockedUntil).toBeNull();
  });

  it("still returns the generic 'Invalid credentials' (not the unverified hint) on a wrong-password attempt against an unverified account", async () => {
    const user = await insertUser("unverified-wrong-pw", { emailVerified: false });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "wrongpass" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid credentials" });
    // Critical: do not leak verification status to a wrong-password attempt.
    expect(res.body.emailUnverified).toBeUndefined();
  });
});

describe("POST /api/auth/resend-verification — anti-enumeration response", () => {
  it("always returns the same generic 200 message regardless of whether the email exists or is verified", async () => {
    const verified = await insertUser("resend-verified", { emailVerified: true });
    const unverified = await insertUser("resend-unverified", { emailVerified: false });

    const a = await request(app)
      .post("/api/auth/resend-verification")
      .send({ email: verified.email });
    const b = await request(app)
      .post("/api/auth/resend-verification")
      .send({ email: unverified.email });
    const c = await request(app)
      .post("/api/auth/resend-verification")
      .send({ email: `${TEST_TAG}-no-such-account@example.test` });

    for (const res of [a, b, c]) {
      expect(res.status).toBe(200);
      expect(typeof res.body.message).toBe("string");
    }

    // All three responses look identical so callers can't probe membership.
    expect(a.body).toEqual(b.body);
    expect(b.body).toEqual(c.body);
  });
});

describe("processResendVerificationRequest — async worker behavior", () => {
  it("mints a fresh email_verification token (invalidating the previous one) and sends the email_verification template to an unverified user", async () => {
    const user = await insertUser("worker-unverified", { emailVerified: false });
    await db
      .update(usersTable)
      .set({
        emailVerifyToken: "old-stale-token",
        emailVerifyExpires: new Date(Date.now() + 60 * 60 * 1000),
      })
      .where(eq(usersTable.id, user.id));

    sendEmailNowMock.mockClear();
    await processResendVerificationRequest(user.email);

    const after = await getUser(user.id);
    expect(after.emailVerifyToken).toBeTruthy();
    expect(after.emailVerifyToken).not.toBe("old-stale-token");
    expect(after.emailVerifyExpires).toBeInstanceOf(Date);
    expect(after.emailVerifyExpires!.getTime()).toBeGreaterThan(Date.now());

    const verificationCalls = sendEmailNowMock.mock.calls.filter(
      ([params]) =>
        params.templateSlug === "email_verification" && params.to === user.email,
    );
    expect(verificationCalls).toHaveLength(1);
    expect(verificationCalls[0]![0].variables.verify_token).toBe(
      after.emailVerifyToken,
    );
    expect(verificationCalls[0]![0].userId).toBe(user.id);
  });

  it("does NOT send any email when the account is already verified (no-op)", async () => {
    const user = await insertUser("worker-verified", { emailVerified: true });

    sendEmailNowMock.mockClear();
    await processResendVerificationRequest(user.email);

    expect(sendEmailNowMock).not.toHaveBeenCalled();

    // Token state must remain untouched on a verified account.
    const after = await getUser(user.id);
    expect(after.emailVerifyToken).toBeNull();
    expect(after.emailVerifyExpires).toBeNull();
  });

  it("does NOT send any email when the email isn't registered (no-op)", async () => {
    sendEmailNowMock.mockClear();
    await processResendVerificationRequest(
      `${TEST_TAG}-truly-unknown@example.test`,
    );
    expect(sendEmailNowMock).not.toHaveBeenCalled();
  });

  it("normalizes the input email (trim + lowercase) so casing/whitespace can't be used to bypass the lookup", async () => {
    const user = await insertUser("worker-normalize", { emailVerified: false });

    sendEmailNowMock.mockClear();
    await processResendVerificationRequest(`  ${user.email.toUpperCase()}  `);

    const verificationCalls = sendEmailNowMock.mock.calls.filter(
      ([params]) => params.templateSlug === "email_verification",
    );
    expect(verificationCalls).toHaveLength(1);
    expect(verificationCalls[0]![0].to).toBe(user.email);
  });

  it("ignores non-string / empty inputs without throwing", async () => {
    sendEmailNowMock.mockClear();
    await processResendVerificationRequest(undefined);
    await processResendVerificationRequest(null);
    await processResendVerificationRequest("");
    await processResendVerificationRequest("   ");
    await processResendVerificationRequest(42);
    expect(sendEmailNowMock).not.toHaveBeenCalled();
  });
});
