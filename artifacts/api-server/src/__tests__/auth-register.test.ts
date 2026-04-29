import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const { sendEmailNowMock, queueGHLSyncMock, emitWebhookEventMock } = vi.hoisted(
  () => ({
    sendEmailNowMock: vi.fn<
      (params: {
        templateSlug: string;
        to: string;
        userId?: number;
        variables?: Record<string, unknown>;
      }) => Promise<{ success: boolean }>
    >(async () => ({ success: true })),
    queueGHLSyncMock: vi.fn<(params: unknown) => Promise<string>>(
      async () => "job_test_id",
    ),
    emitWebhookEventMock: vi.fn<
      (eventType: string, payload: Record<string, unknown>) => Promise<void>
    >(async () => undefined),
  }),
);

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

// abuseRateLimit no-ops when getRedis() returns null, but we stub Redis here
// for safety so any Redis-touching helper that wakes up during the route
// also short-circuits cleanly.
vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: vi.fn(async () => false),
}));

import { buildTestApp } from "./test-app";
import authRouter, { processRegisterRequest } from "../routes/auth";

const TEST_TAG = `auth-register-test-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestApp>;
let existingUser: { id: number; email: string; name: string };

function getCookieList(res: request.Response): string[] {
  const cookies = res.headers["set-cookie"];
  if (Array.isArray(cookies)) return cookies;
  return cookies ? [cookies] : [];
}

/**
 * Asserts none of the three auth cookies (access_token, refresh_token,
 * csrf_token) appear in the Set-Cookie response header. Register MUST NOT
 * auto-log a user in — it returns a generic 200 and lets the user verify
 * their email, then sign in via /auth/login.
 */
function expectNoAuthCookies(res: request.Response): void {
  const cookies = getCookieList(res);
  for (const c of cookies) {
    expect(c, `unexpected access_token cookie: ${c}`).not.toMatch(
      /^access_token=/,
    );
    expect(c, `unexpected refresh_token cookie: ${c}`).not.toMatch(
      /^refresh_token=/,
    );
    expect(c, `unexpected csrf_token cookie: ${c}`).not.toMatch(
      /^csrf_token=/,
    );
  }
}

beforeAll(async () => {
  app = buildTestApp({ routers: [authRouter] });

  // Seed one pre-existing user so the duplicate-email tests have a known
  // target. Stored lowercase to match the route's normalization.
  const email = `${TEST_TAG}-existing@example.test`.toLowerCase();
  const passwordHash = await bcrypt.hash("ExistingPass1!", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      name: "Existing Owner",
      email,
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
    })
    .returning({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
    });
  existingUser = row;
  seededUserIds.push(row.id);
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db
      .delete(sessionsTable)
      .where(inArray(sessionsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  sendEmailNowMock.mockClear();
  queueGHLSyncMock.mockClear();
  emitWebhookEventMock.mockClear();
});

describe("POST /api/auth/register — happy path (brand-new email)", () => {
  it("returns 200 with the generic message, sets NO auth cookies, creates the user with no session row, and emits member.created exactly once", async () => {
    const newEmail =
      `${TEST_TAG}-happy-${randomUUID().slice(0, 6)}@example.test`.toLowerCase();
    const name = "Brand New User";

    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: newEmail, password: "Brandnew1!", name });

    expect(res.status).toBe(200);
    expect(typeof res.body?.message).toBe("string");
    // No auto-login envelope fields leak through.
    expect(res.body?.id).toBeUndefined();
    expect(res.body?.role).toBeUndefined();

    // The contract: register never sets the auth cookies that login/refresh
    // do. Email-verification + a separate /auth/login is the only flow.
    expectNoAuthCookies(res);

    // Drive the fire-and-forget worker deterministically so we can assert
    // on its side effects without racing.
    await processRegisterRequest({
      email: newEmail,
      password: "Brandnew1!",
      name,
    });

    const [createdUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, newEmail));
    expect(createdUser, "user row should exist after register").toBeDefined();
    if (createdUser) seededUserIds.push(createdUser.id);

    expect(createdUser.name).toBe(name);
    expect(createdUser.emailVerified).toBe(false);
    expect(createdUser.emailVerifyToken).toBeTruthy();
    expect(createdUser.emailVerifyExpires).toBeInstanceOf(Date);
    expect(createdUser.passwordHash).toBeTruthy();
    expect(createdUser.passwordHash).not.toBe("Brandnew1!");

    // No session row is created — register does not log the user in, so
    // there is nothing for /auth/refresh or /auth/logout to operate on yet.
    const sessions = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, createdUser.id));
    expect(sessions).toHaveLength(0);

    // member.created fires exactly once, with the right payload shape.
    const memberCreated = emitWebhookEventMock.mock.calls.filter(
      ([eventType]) => eventType === "member.created",
    );
    expect(memberCreated).toHaveLength(1);
    expect(memberCreated[0]?.[1]).toEqual({
      user_id: createdUser.id,
      email: createdUser.email,
      name: createdUser.name,
    });

    // The verification email goes out to the new address with the token
    // we just stored on the row.
    const verificationCalls = sendEmailNowMock.mock.calls.filter(
      ([params]) =>
        params.templateSlug === "email_verification" && params.to === newEmail,
    );
    expect(verificationCalls).toHaveLength(1);
    const verifyEmail = verificationCalls[0]![0];
    expect(verifyEmail.userId).toBe(createdUser.id);
    expect(verifyEmail.variables?.verify_token).toBe(
      createdUser.emailVerifyToken,
    );

    // No GHL sync is queued by the register route (that's a /auth/login
    // concern). Locking that in keeps the register flow side-effect light.
    expect(queueGHLSyncMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/register — duplicate email (anti-enumeration)", () => {
  it("returns 200 with the generic message, sets NO auth cookies, creates no new user/session, and does NOT emit member.created", async () => {
    const before = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, existingUser.email));
    expect(before).toHaveLength(1);

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: existingUser.email,
        password: "Whatever1!",
        name: "Impersonator",
      });

    expect(res.status).toBe(200);
    expect(typeof res.body?.message).toBe("string");
    expect(res.body?.id).toBeUndefined();
    expectNoAuthCookies(res);

    // Drive the async worker.
    await processRegisterRequest({
      email: existingUser.email,
      password: "Whatever1!",
      name: "Impersonator",
    });

    // Still exactly one user row for that email, untouched.
    const after = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, existingUser.email));
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(existingUser.id);
    expect(after[0].name).toBe(existingUser.name);

    // No session was created for the existing user as a side effect.
    const sessions = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, existingUser.id));
    expect(sessions).toHaveLength(0);

    // No member.created webhook fires for a no-op signup — that event is
    // reserved for genuinely new accounts.
    const memberCreated = emitWebhookEventMock.mock.calls.filter(
      ([eventType]) => eventType === "member.created",
    );
    expect(memberCreated).toHaveLength(0);

    // The owner of the existing email gets the heads-up email instead of
    // a verification link.
    const ownerEmails = sendEmailNowMock.mock.calls.filter(
      ([params]) => params.to === existingUser.email,
    );
    const slugs = ownerEmails.map(([params]) => params.templateSlug);
    expect(slugs).toContain("signup_attempted");
    expect(slugs).not.toContain("email_verification");
  });
});

describe("POST /api/auth/register — validation errors", () => {
  /**
   * For each invalid input we assert: 400, no cookies, no user row created
   * for that email, no session row, no webhook, no email sent. These are
   * the same negative-side-effect promises the duplicate-email path makes.
   */
  async function expectRejected(
    body: Record<string, unknown>,
    {
      probeEmail,
    }: { probeEmail?: string } = {},
  ): Promise<request.Response> {
    const res = await request(app).post("/api/auth/register").send(body);
    expect(res.status).toBe(400);
    expect(typeof res.body?.error).toBe("string");
    expectNoAuthCookies(res);

    if (probeEmail) {
      const rows = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, probeEmail.toLowerCase()));
      expect(rows).toHaveLength(0);
    }

    expect(emitWebhookEventMock).not.toHaveBeenCalled();
    expect(sendEmailNowMock).not.toHaveBeenCalled();
    expect(queueGHLSyncMock).not.toHaveBeenCalled();
    return res;
  }

  it("rejects missing email/password/name with 400 and no side effects", async () => {
    const probe = `${TEST_TAG}-missing-${randomUUID().slice(0, 6)}@example.test`;
    await expectRejected(
      { email: probe, password: "Brandnew1!" }, // no name
      { probeEmail: probe },
    );

    sendEmailNowMock.mockClear();
    emitWebhookEventMock.mockClear();
    queueGHLSyncMock.mockClear();

    await expectRejected(
      { email: probe, name: "X" }, // no password
      { probeEmail: probe },
    );

    sendEmailNowMock.mockClear();
    emitWebhookEventMock.mockClear();
    queueGHLSyncMock.mockClear();

    await expectRejected(
      { password: "Brandnew1!", name: "X" }, // no email
      // No email to probe, but the negative side-effect assertions still fire.
    );
  });

  it("rejects too-short / no-letter / no-digit passwords with 400 and no side effects", async () => {
    const probe = `${TEST_TAG}-pw-${randomUUID().slice(0, 6)}@example.test`;
    await expectRejected(
      { email: probe, password: "short", name: "X" },
      { probeEmail: probe },
    );

    sendEmailNowMock.mockClear();
    emitWebhookEventMock.mockClear();
    queueGHLSyncMock.mockClear();

    await expectRejected(
      { email: probe, password: "12345678", name: "X" }, // digits only
      { probeEmail: probe },
    );

    sendEmailNowMock.mockClear();
    emitWebhookEventMock.mockClear();
    queueGHLSyncMock.mockClear();

    await expectRejected(
      { email: probe, password: "abcdefgh", name: "X" }, // letters only
      { probeEmail: probe },
    );
  });

  it("rejects malformed email with 400 and no side effects", async () => {
    await expectRejected({
      email: "not-an-email",
      password: "Brandnew1!",
      name: "X",
    });
  });
});
