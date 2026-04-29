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
import { db, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const { sendEmailNowMock, emitWebhookEventMock, queueGHLSyncMock } = vi.hoisted(
  () => ({
    sendEmailNowMock: vi.fn(async () => ({ success: true })),
    emitWebhookEventMock: vi.fn(async () => undefined),
    queueGHLSyncMock: vi.fn(async () => "job_test_id"),
  }),
);

vi.mock("../lib/communication-service", () => ({
  CommunicationService: { sendEmailNow: sendEmailNowMock },
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

// No Redis in this test — abuseRateLimit no-ops when getRedis() returns null,
// so the per-IP and per-email register limiters won't interfere with the
// behavioral assertions below.
vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: vi.fn(async () => false),
}));

// The register handler constructs per-IP and per-email rate limiters at
// module load time. We stub the middleware so the abuse-rate logic can't
// interfere with the behavioral assertions below regardless of whether
// Redis happens to be reachable from the test runner.
vi.mock("../middleware/abuse-rate-limit", () => {
  const passthrough =
    () => (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    abuseRateLimit: passthrough,
    ipKey: () => () => null,
    emailKey: () => () => null,
  };
});

import { buildTestApp } from "./test-app";
import authRouter, { processRegisterRequest } from "../routes/auth";

const TEST_TAG = `register-enum-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestApp>;
let existingUser: { id: number; email: string; name: string };

beforeAll(async () => {
  app = buildTestApp({ routers: [authRouter] });

  const email = `${TEST_TAG}-existing@example.test`.toLowerCase();
  const passwordHash = await bcrypt.hash("ExistingPass1!", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      name: "Existing Owner",
      email,
      passwordHash,
      role: "member",
      emailVerified: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email, name: usersTable.name });
  existingUser = row;
  seededUserIds.push(row.id);
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  sendEmailNowMock.mockClear();
  emitWebhookEventMock.mockClear();
  queueGHLSyncMock.mockClear();
});

describe("POST /api/auth/register — anti-enumeration response", () => {
  it("returns 200 with a generic message and no auth cookies for a brand-new email", async () => {
    const newEmail = `${TEST_TAG}-fresh-${randomUUID().slice(0, 6)}@example.test`;

    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: newEmail, password: "Brandnew1!", name: "New User" });

    expect(res.status).toBe(200);
    expect(res.body?.message).toBeTruthy();
    // The response must not reveal whether the email was new or existing.
    expect(JSON.stringify(res.body)).not.toMatch(/already/i);
    expect(JSON.stringify(res.body)).not.toMatch(/registered/i);
    expect(JSON.stringify(res.body)).not.toMatch(/exists?/i);
    // No id/role/onboarding fields — register no longer auto-logs you in.
    expect(res.body?.id).toBeUndefined();
    expect(res.body?.role).toBeUndefined();
    // No auth cookies should be set on the response.
    const cookies = res.headers["set-cookie"];
    const cookieList = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
    for (const c of cookieList) {
      expect(c).not.toMatch(/access_token=/);
      expect(c).not.toMatch(/refresh_token=/);
    }

    // Drive the fire-and-forget worker deterministically.
    await processRegisterRequest({
      email: newEmail,
      password: "Brandnew1!",
      name: "New User",
    });

    // The new user was created and got a verification email.
    const [createdUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, newEmail.toLowerCase()));
    expect(createdUser).toBeTruthy();
    expect(createdUser.emailVerified).toBe(false);
    if (createdUser) seededUserIds.push(createdUser.id);

    const calls = sendEmailNowMock.mock.calls.filter(
      (c: any[]) => c[0]?.to === newEmail.toLowerCase(),
    );
    expect(calls.some((c: any[]) => c[0]?.templateSlug === "email_verification")).toBe(
      true,
    );
    expect(
      calls.some((c: any[]) => c[0]?.templateSlug === "signup_attempted"),
    ).toBe(false);
  });

  it("returns the IDENTICAL 200 response shape for an email that's already registered", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: existingUser.email,
        password: "Whatever1!",
        name: "Impersonator",
      });

    expect(res.status).toBe(200);
    expect(res.body?.message).toBeTruthy();
    // No hint about whether the email exists.
    expect(JSON.stringify(res.body)).not.toMatch(/already/i);
    expect(JSON.stringify(res.body)).not.toMatch(/registered/i);
    expect(JSON.stringify(res.body)).not.toMatch(/exists?/i);
    expect(res.body?.id).toBeUndefined();
    // No auth cookies leaked either.
    const cookies = res.headers["set-cookie"];
    const cookieList = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
    for (const c of cookieList) {
      expect(c).not.toMatch(/access_token=/);
      expect(c).not.toMatch(/refresh_token=/);
    }

    // Drive the fire-and-forget worker.
    await processRegisterRequest({
      email: existingUser.email,
      password: "Whatever1!",
      name: "Impersonator",
    });

    // No new user was created with the impersonator's name.
    const matches = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, existingUser.email));
    expect(matches.length).toBe(1);
    expect(matches[0].name).toBe(existingUser.name);

    // The existing owner got a "signup_attempted" notice — not a verification
    // email or a welcome email.
    const calls = sendEmailNowMock.mock.calls.filter(
      (c: any[]) => c[0]?.to === existingUser.email,
    );
    const slugs = calls.map((c: any[]) => c[0]?.templateSlug);
    expect(slugs).toContain("signup_attempted");
    expect(slugs).not.toContain("email_verification");
    expect(slugs).not.toContain("welcome");

    const notice = calls.find(
      (c: any[]) => c[0]?.templateSlug === "signup_attempted",
    ) as any[] | undefined;
    expect(notice?.[0]?.userId).toBe(existingUser.id);
    expect(notice?.[0]?.variables?.member_name).toBe(existingUser.name);
    expect(notice?.[0]?.variables?.member_email).toBe(existingUser.email);

    // No webhook is fired for the no-op signup.
    const memberCreatedEmits = emitWebhookEventMock.mock.calls.filter(
      (c: any[]) => c[0] === "member.created",
    );
    expect(memberCreatedEmits.length).toBe(0);
  });

  it("returns the same response shape and message for both new and existing emails", async () => {
    const newEmail = `${TEST_TAG}-shape-${randomUUID().slice(0, 6)}@example.test`;

    const newRes = await request(app)
      .post("/api/auth/register")
      .send({ email: newEmail, password: "Brandnew1!", name: "New" });

    const existingRes = await request(app)
      .post("/api/auth/register")
      .send({
        email: existingUser.email,
        password: "Brandnew1!",
        name: "Imp",
      });

    expect(newRes.status).toBe(existingRes.status);
    expect(newRes.body).toEqual(existingRes.body);

    // Clean up the user that was created via the route handler's
    // fire-and-forget worker.
    await processRegisterRequest({
      email: newEmail,
      password: "Brandnew1!",
      name: "New",
    });
    const [created] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, newEmail.toLowerCase()));
    if (created) seededUserIds.push(created.id);
  });

  it("normalizes email casing when matching against an existing account", async () => {
    const upper = existingUser.email.toUpperCase();

    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: upper, password: "Whatever1!", name: "Imp" });

    expect(res.status).toBe(200);

    sendEmailNowMock.mockClear();
    await processRegisterRequest({
      email: upper,
      password: "Whatever1!",
      name: "Imp",
    });

    const calls = sendEmailNowMock.mock.calls;
    const slugs = calls.map((c: any[]) => c[0]?.templateSlug);
    expect(slugs).toContain("signup_attempted");
    expect(slugs).not.toContain("email_verification");

    // No duplicate user row was created from the uppercase variant.
    const rows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, existingUser.email));
    expect(rows.length).toBe(1);
  });

  it("still 400s on invalid input (these errors don't leak account state)", async () => {
    const missing = await request(app)
      .post("/api/auth/register")
      .send({ email: "x@y.test", password: "Brandnew1!" });
    expect(missing.status).toBe(400);

    const badPw = await request(app)
      .post("/api/auth/register")
      .send({ email: "x@y.test", password: "short", name: "X" });
    expect(badPw.status).toBe(400);

    const badEmail = await request(app)
      .post("/api/auth/register")
      .send({ email: "not-an-email", password: "Brandnew1!", name: "X" });
    expect(badEmail.status).toBe(400);
  });
});
