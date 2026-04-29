import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, emailChangeAttemptsTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

const { sendEmailNowMock } = vi.hoisted(() => ({
  sendEmailNowMock: vi.fn<
    (params: unknown) => Promise<{ success: boolean }>
  >(async () => ({ success: true })),
}));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    sendEmailNow: sendEmailNowMock,
  },
}));

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: vi.fn(async () => undefined),
}));

vi.mock("../lib/webhook-events", () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
  WEBHOOK_EVENT_TYPES: [],
}));

import { buildTestApp } from "./test-app";
import membersRouter from "../routes/members";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_PASSWORD = "OriginalPassw0rd!";
const TEST_TAG = `member-cancel-pending-${randomUUID().slice(0, 8)}`;

const SLUG = "email_change_cancelled_by_member_pending";

interface SeededUser {
  id: number;
  email: string;
  name: string;
}

interface SendEmailArgs {
  templateSlug: string;
  to: string;
  variables?: Record<string, string>;
  userId?: number;
}

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestApp>;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
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

async function setPending(
  userId: number,
  pendingEmail: string,
  expiresAt: Date,
): Promise<void> {
  await db
    .update(usersTable)
    .set({
      pendingEmail,
      emailChangeToken: "deadbeef".repeat(8),
      emailChangeExpires: expiresAt,
    })
    .where(eq(usersTable.id, userId));
}

function pendingNoticeCalls(): SendEmailArgs[] {
  return sendEmailNowMock.mock.calls
    .map((c) => c[0] as SendEmailArgs)
    .filter((c) => c.templateSlug === SLUG);
}

beforeAll(() => {
  app = buildTestApp({ routers: [membersRouter] });
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.execute(
      sql`DELETE FROM communication_log WHERE user_id IN (${sql.join(
        seededUserIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
    await db
      .delete(emailChangeAttemptsTable)
      .where(inArray(emailChangeAttemptsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  sendEmailNowMock.mockClear();
  sendEmailNowMock.mockImplementation(async () => ({ success: true }));
});

describe("POST /api/members/me/email/cancel — heads-up to dropped pending address", () => {
  it("sends the dropped-pending notice exactly once on the happy path", async () => {
    const user = await insertUser("cancel-happy");
    const pendingEmail = `${TEST_TAG}-cancel-happy-pending@example.test`;
    await setPending(
      user.id,
      pendingEmail,
      new Date(Date.now() + 6 * 60 * 60 * 1000),
    );

    const res = await request(app)
      .post("/api/members/me/email/cancel")
      .set("Cookie", signCookie(user.id, user.email));
    expect(res.status).toBe(200);

    const calls = pendingNoticeCalls();
    expect(calls).toHaveLength(1);
    const [call] = calls;
    // Notice goes to the dropped pending address — NOT the verified one.
    expect(call.to).toBe(pendingEmail);
    // Recipient may not be the account owner: omit userId so this isn't
    // attached to the verified user's communication log.
    expect(call.userId).toBeUndefined();
    expect(call.variables?.cancelled_pending_email).toBe(pendingEmail);
    // Account-status variables must not leak to the recipient.
    expect(call.variables?.member_name).toBeUndefined();
    expect(call.variables?.member_email).toBeUndefined();
  });

  it("does NOT send the notice when there is no pending change to cancel", async () => {
    const user = await insertUser("cancel-noop");

    const res = await request(app)
      .post("/api/members/me/email/cancel")
      .set("Cookie", signCookie(user.id, user.email));
    expect(res.status).toBe(200);

    expect(pendingNoticeCalls()).toHaveLength(0);
  });

  it("does NOT send the notice when the pending change has already expired", async () => {
    const user = await insertUser("cancel-expired");
    await setPending(
      user.id,
      `${TEST_TAG}-cancel-expired-pending@example.test`,
      new Date(Date.now() - 60 * 1000),
    );

    const res = await request(app)
      .post("/api/members/me/email/cancel")
      .set("Cookie", signCookie(user.id, user.email));
    expect(res.status).toBe(200);

    expect(pendingNoticeCalls()).toHaveLength(0);
  });

  it("does NOT send the notice when the request is unauthenticated (401)", async () => {
    const res = await request(app).post("/api/members/me/email/cancel");
    expect(res.status).toBe(401);
    expect(pendingNoticeCalls()).toHaveLength(0);
  });
});

describe("POST /api/members/me/email — heads-up to replaced pending address", () => {
  it("sends the dropped-pending notice exactly once when a fresh request replaces an in-flight pending change", async () => {
    const user = await insertUser("replace-happy");
    const oldPending = `${TEST_TAG}-replace-old-pending@example.test`;
    await setPending(
      user.id,
      oldPending,
      new Date(Date.now() + 6 * 60 * 60 * 1000),
    );

    const newEmail = `${TEST_TAG}-replace-new@example.test`;
    const res = await request(app)
      .post("/api/members/me/email")
      .set("Cookie", signCookie(user.id, user.email))
      .send({ currentPassword: TEST_PASSWORD, newEmail });
    expect(res.status).toBe(200);
    expect(res.body.pendingEmail).toBe(newEmail);

    const calls = pendingNoticeCalls();
    expect(calls).toHaveLength(1);
    const [call] = calls;
    // Goes to the previously-pending address that's now been dropped.
    expect(call.to).toBe(oldPending);
    expect(call.userId).toBeUndefined();
    expect(call.variables?.cancelled_pending_email).toBe(oldPending);
    expect(call.variables?.member_name).toBeUndefined();
    expect(call.variables?.member_email).toBeUndefined();
  });

  it("does NOT send the notice when the new email matches the existing pending address (re-request)", async () => {
    const user = await insertUser("replace-same");
    const sharedPending = `${TEST_TAG}-replace-same-pending@example.test`;
    await setPending(
      user.id,
      sharedPending,
      new Date(Date.now() + 6 * 60 * 60 * 1000),
    );

    const res = await request(app)
      .post("/api/members/me/email")
      .set("Cookie", signCookie(user.id, user.email))
      .send({ currentPassword: TEST_PASSWORD, newEmail: sharedPending });
    expect(res.status).toBe(200);

    // No notice — the recipient is still the (renewed) pending address.
    expect(pendingNoticeCalls()).toHaveLength(0);
  });

  it("does NOT send the notice when there is no prior pending change", async () => {
    const user = await insertUser("replace-fresh");
    const newEmail = `${TEST_TAG}-replace-fresh-new@example.test`;

    const res = await request(app)
      .post("/api/members/me/email")
      .set("Cookie", signCookie(user.id, user.email))
      .send({ currentPassword: TEST_PASSWORD, newEmail });
    expect(res.status).toBe(200);

    expect(pendingNoticeCalls()).toHaveLength(0);
  });

  it("does NOT send the notice when the prior pending change has already expired", async () => {
    const user = await insertUser("replace-expired");
    await setPending(
      user.id,
      `${TEST_TAG}-replace-expired-old@example.test`,
      new Date(Date.now() - 60 * 1000),
    );

    const newEmail = `${TEST_TAG}-replace-expired-new@example.test`;
    const res = await request(app)
      .post("/api/members/me/email")
      .set("Cookie", signCookie(user.id, user.email))
      .send({ currentPassword: TEST_PASSWORD, newEmail });
    expect(res.status).toBe(200);

    expect(pendingNoticeCalls()).toHaveLength(0);
  });

  it("does NOT send the notice when the password is wrong (request rejected with 400)", async () => {
    const user = await insertUser("replace-bad-pass");
    const oldPending = `${TEST_TAG}-replace-bad-pass-pending@example.test`;
    await setPending(
      user.id,
      oldPending,
      new Date(Date.now() + 6 * 60 * 60 * 1000),
    );

    const res = await request(app)
      .post("/api/members/me/email")
      .set("Cookie", signCookie(user.id, user.email))
      .send({
        currentPassword: "wrong-password",
        newEmail: `${TEST_TAG}-replace-bad-pass-new@example.test`,
      });
    expect(res.status).toBe(400);

    expect(pendingNoticeCalls()).toHaveLength(0);

    // Pending change must still be intact — the request was rejected.
    const [after] = await db
      .select({ pendingEmail: usersTable.pendingEmail })
      .from(usersTable)
      .where(eq(usersTable.id, user.id));
    expect(after.pendingEmail).toBe(oldPending);
  });

  it("does NOT send the notice when the request is unauthenticated (401)", async () => {
    const res = await request(app)
      .post("/api/members/me/email")
      .send({
        currentPassword: TEST_PASSWORD,
        newEmail: `${TEST_TAG}-replace-noauth-new@example.test`,
      });
    expect(res.status).toBe(401);
    expect(pendingNoticeCalls()).toHaveLength(0);
  });

  it("still returns 200 to the member if the dropped-pending notice fails to enqueue", async () => {
    const user = await insertUser("replace-notice-fail");
    const oldPending = `${TEST_TAG}-replace-notice-fail-pending@example.test`;
    await setPending(
      user.id,
      oldPending,
      new Date(Date.now() + 6 * 60 * 60 * 1000),
    );

    // First two calls (verify + notice to old/current) succeed; the
    // third (dropped-pending heads-up) blows up. The cancel/replace
    // itself must still succeed and the pending change must roll over.
    sendEmailNowMock.mockImplementation(async (params) => {
      const args = params as SendEmailArgs;
      if (args.templateSlug === SLUG) {
        throw new Error("redis exploded");
      }
      return { success: true };
    });

    const newEmail = `${TEST_TAG}-replace-notice-fail-new@example.test`;
    const res = await request(app)
      .post("/api/members/me/email")
      .set("Cookie", signCookie(user.id, user.email))
      .send({ currentPassword: TEST_PASSWORD, newEmail });
    expect(res.status).toBe(200);
    expect(res.body.pendingEmail).toBe(newEmail);

    const [after] = await db
      .select({ pendingEmail: usersTable.pendingEmail })
      .from(usersTable)
      .where(eq(usersTable.id, user.id));
    expect(after.pendingEmail).toBe(newEmail);

    // The notice was attempted exactly once even though it rejected.
    expect(pendingNoticeCalls()).toHaveLength(1);
  });
});
