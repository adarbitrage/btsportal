import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, emailChangeHistoryTable, sessionsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: vi.fn(async () => undefined),
}));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    sendEmailNow: vi.fn(async () => undefined),
  },
}));

vi.mock("../lib/webhook-events", () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
}));

import authRouter from "../routes/auth";
import { requestIdMiddleware, apiErrorHandler } from "../lib/api-errors";

function buildAuthApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", requestIdMiddleware);
  app.use("/api", authRouter);
  app.use("/api", apiErrorHandler);
  return app;
}

const TEST_TAG = `email-hint-test-${randomUUID().slice(0, 8)}`;
const PASSWORD = "Sup3rSecret!";

const seededUserIds: number[] = [];
const seededOldEmails: string[] = [];
let app: Express;

let changedUserOldEmail: string;
let changedUserNewEmail: string;
let activeUserEmail: string;

async function seedUser(suffix: string, email: string): Promise<number> {
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test ${suffix}`,
      passwordHash,
      role: "member",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  app = buildAuthApp();

  changedUserOldEmail = `${TEST_TAG}-old@example.test`;
  changedUserNewEmail = `${TEST_TAG}-new@example.test`;
  activeUserEmail = `${TEST_TAG}-active@example.test`;

  // The user who recently changed their address — currently lives at the new one.
  const changedUserId = await seedUser("changed", changedUserNewEmail);

  // Independent active user we can use to verify the hint doesn't fire on a real
  // wrong-password attempt against a totally unrelated account.
  await seedUser("active", activeUserEmail);

  // Pretend they verified an email change a few days ago.
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await db.insert(emailChangeHistoryTable).values({
    userId: changedUserId,
    oldEmail: changedUserOldEmail,
    newEmail: changedUserNewEmail,
    changedAt: oneWeekAgo,
  });
  seededOldEmails.push(changedUserOldEmail);
});

afterAll(async () => {
  if (seededOldEmails.length > 0) {
    await db
      .delete(emailChangeHistoryTable)
      .where(inArray(emailChangeHistoryTable.oldEmail, seededOldEmails));
  }
  if (seededUserIds.length > 0) {
    await db.delete(sessionsTable).where(inArray(sessionsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("POST /api/auth/login — recently-changed email hint", () => {
  it("hints when the entered email matches a recently-changed old address", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: changedUserOldEmail, password: "anything-wrong" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid credentials");
    expect(res.body.emailRecentlyChanged).toBe(true);
    // Critical: never leak the new address itself.
    expect(JSON.stringify(res.body)).not.toContain(changedUserNewEmail);
  });

  it("hint is case-insensitive on the entered email", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: changedUserOldEmail.toUpperCase(), password: "anything-wrong" });

    expect(res.status).toBe(401);
    expect(res.body.emailRecentlyChanged).toBe(true);
  });

  it("does not hint for an unrelated wrong-password attempt on an active account", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: activeUserEmail, password: "definitely-wrong" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid credentials");
    expect(res.body.emailRecentlyChanged).toBeUndefined();
  });

  it("does not hint for an email that was never used", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `${TEST_TAG}-never-existed@example.test`, password: "whatever" });

    expect(res.status).toBe(401);
    expect(res.body.emailRecentlyChanged).toBeUndefined();
  });

  it("ignores email changes older than the 30-day window", async () => {
    const staleOldEmail = `${TEST_TAG}-stale-old@example.test`;
    const staleUserId = await seedUser("stale", `${TEST_TAG}-stale-current@example.test`);
    const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await db.insert(emailChangeHistoryTable).values({
      userId: staleUserId,
      oldEmail: staleOldEmail,
      newEmail: `${TEST_TAG}-stale-current@example.test`,
      changedAt: longAgo,
    });
    seededOldEmails.push(staleOldEmail);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: staleOldEmail, password: "whatever" });

    expect(res.status).toBe(401);
    expect(res.body.emailRecentlyChanged).toBeUndefined();
  });

  it("succeeds when logging in with the new address and correct password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: changedUserNewEmail, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(changedUserNewEmail);
  });
});
