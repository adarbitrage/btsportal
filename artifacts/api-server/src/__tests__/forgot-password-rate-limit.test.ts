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
import crypto from "crypto";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  passwordResetAttemptsTable,
} from "@workspace/db";
import { eq, sql, and, gte, inArray } from "drizzle-orm";

const { sendEmailNowMock } = vi.hoisted(() => ({
  sendEmailNowMock: vi.fn(async () => undefined),
}));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    sendEmailNow: sendEmailNowMock,
    sendSmsNow: vi.fn(async () => undefined),
  },
}));

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: vi.fn(async () => undefined),
}));

vi.mock("../lib/webhook-events", () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
}));

import { buildTestApp } from "./test-app";
import authRouter, { processForgotPasswordRequest } from "../routes/auth";

const TEST_TAG = `pwreset-rl-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];
const seededEmailHashes: string[] = [];
// Captured at beforeAll so afterAll can broadly delete every password_reset_attempts
// row this file inserted — including IP rows for whatever address supertest used,
// which we can't predict without trust-proxy configuration.
let testRunStartedAt: Date;
let app: ReturnType<typeof buildTestApp>;
let realUser: { id: number; email: string };

const PASSWORD_HASH_PLACEHOLDER = "x";

function hashIdentifier(kind: "email" | "ip", value: string): string {
  return crypto.createHash("sha256").update(`${kind}:${value}`).digest("hex");
}

function trackEmail(email: string): string {
  const h = hashIdentifier("email", email.toLowerCase());
  seededEmailHashes.push(h);
  return h;
}

beforeAll(async () => {
  // trustProxy lets us send X-Forwarded-For headers to simulate distinct
  // client IPs — without it Express returns 127.0.0.1 for every request and
  // our route-level tests would collide with the per-IP cap of any other
  // forgot-password test running in parallel against the same DB.
  app = buildTestApp({ routers: [authRouter], trustProxy: true });
  testRunStartedAt = new Date(Date.now() - 1000);

  const email = `${TEST_TAG}-real@example.test`.toLowerCase();
  const passwordHash = await bcrypt.hash(PASSWORD_HASH_PLACEHOLDER, 4);
  const [row] = await db
    .insert(usersTable)
    .values({ name: "PW Reset Tester", email, passwordHash, role: "member" })
    .returning({ id: usersTable.id, email: usersTable.email });
  realUser = row;
  seededUserIds.push(row.id);
  trackEmail(email);
});

afterAll(async () => {
  // Catch every row this file's test run inserted, including rows for the
  // supertest source IP we never explicitly seeded.
  await db
    .delete(passwordResetAttemptsTable)
    .where(gte(passwordResetAttemptsTable.createdAt, testRunStartedAt));
  for (const id of seededUserIds) {
    await db.execute(
      sql`DELETE FROM communication_log WHERE user_id = ${id}`,
    );
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

beforeEach(async () => {
  sendEmailNowMock.mockClear();
  // Wipe everything this test file inserted so each test gets a fresh window
  // for both per-email and per-IP caps.
  await db
    .delete(passwordResetAttemptsTable)
    .where(gte(passwordResetAttemptsTable.createdAt, testRunStartedAt));
});

describe("processForgotPasswordRequest (rate limit)", () => {
  it("allows the first 3 requests for a real user, then suppresses further sends silently", async () => {
    for (let i = 0; i < 3; i++) {
      await processForgotPasswordRequest(realUser.email, `203.0.113.${i + 1}`);
    }
    expect(sendEmailNowMock).toHaveBeenCalledTimes(3);

    sendEmailNowMock.mockClear();
    await processForgotPasswordRequest(realUser.email, "203.0.113.99");
    expect(sendEmailNowMock).not.toHaveBeenCalled();

    const rows = await db
      .select()
      .from(passwordResetAttemptsTable)
      .where(
        and(
          eq(passwordResetAttemptsTable.identifierType, "email"),
          eq(
            passwordResetAttemptsTable.identifierHash,
            hashIdentifier("email", realUser.email),
          ),
        ),
      );
    expect(rows).toHaveLength(3);
  });

  it("enforces the per-IP cap across many different target emails", async () => {
    const sharedIp = "198.51.100.42";
    // Hammer the same IP with 11 different made-up addresses; the IP cap is 10/hour.
    for (let i = 0; i < 11; i++) {
      const email = `${TEST_TAG}-ip-${i}@example.test`.toLowerCase();
      trackEmail(email);
      await processForgotPasswordRequest(email, sharedIp);
    }

    const ipHash = hashIdentifier("ip", sharedIp);
    seededEmailHashes.push(ipHash);
    const ipRows = await db
      .select()
      .from(passwordResetAttemptsTable)
      .where(
        and(
          eq(passwordResetAttemptsTable.identifierType, "ip"),
          eq(passwordResetAttemptsTable.identifierHash, ipHash),
        ),
      );
    expect(ipRows).toHaveLength(10);

    // None of these emails resolve to a real user, so sendEmailNow should
    // never have been called regardless of the limit.
    expect(sendEmailNowMock).not.toHaveBeenCalled();
  });

  it("does not log attempts for empty or non-string emails", async () => {
    await processForgotPasswordRequest(undefined, "203.0.113.7");
    await processForgotPasswordRequest("", "203.0.113.7");
    await processForgotPasswordRequest("   ", "203.0.113.7");
    await processForgotPasswordRequest(123 as unknown as string, "203.0.113.7");

    const ipHash = hashIdentifier("ip", "203.0.113.7");
    seededEmailHashes.push(ipHash);
    const rows = await db
      .select()
      .from(passwordResetAttemptsTable)
      .where(eq(passwordResetAttemptsTable.identifierHash, ipHash));
    expect(rows).toHaveLength(0);
    expect(sendEmailNowMock).not.toHaveBeenCalled();
  });

  it("respects the cap even under concurrent requests for the same email", async () => {
    const email = `${TEST_TAG}-concurrent@example.test`.toLowerCase();
    trackEmail(email);
    const passwordHash = await bcrypt.hash(PASSWORD_HASH_PLACEHOLDER, 4);
    const [row] = await db
      .insert(usersTable)
      .values({
        name: "PW Reset Concurrent",
        email,
        passwordHash,
        role: "member",
      })
      .returning({ id: usersTable.id });
    seededUserIds.push(row.id);

    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        processForgotPasswordRequest(email, `198.51.100.${100 + i}`),
      ),
    );

    const rows = await db
      .select()
      .from(passwordResetAttemptsTable)
      .where(
        and(
          eq(passwordResetAttemptsTable.identifierType, "email"),
          eq(
            passwordResetAttemptsTable.identifierHash,
            hashIdentifier("email", email),
          ),
        ),
      );
    expect(rows).toHaveLength(3);
    expect(sendEmailNowMock).toHaveBeenCalledTimes(3);
  });
});

describe("POST /auth/forgot-password (route)", () => {
  it("always returns the same friendly response, even when rate-limited", async () => {
    const responses: number[] = [];
    const bodies: any[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post("/api/auth/forgot-password")
        .set("X-Forwarded-For", "192.0.2.50")
        .send({ email: realUser.email });
      responses.push(res.status);
      bodies.push(res.body);
    }
    for (const s of responses) expect(s).toBe(200);
    for (const b of bodies) {
      expect(b).toEqual({
        message: "If that email exists, we sent a reset link.",
      });
    }
  });

  it("returns the same friendly response for unknown addresses", async () => {
    const unknown = `${TEST_TAG}-no-such-user@example.test`.toLowerCase();
    trackEmail(unknown);
    const ipHash = hashIdentifier("ip", "192.0.2.51");
    seededEmailHashes.push(ipHash);

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", "192.0.2.51")
      .send({ email: unknown });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: "If that email exists, we sent a reset link.",
    });
  });
});
