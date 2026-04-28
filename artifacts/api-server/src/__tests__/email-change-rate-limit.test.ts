import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  emailChangeAttemptsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    sendEmailNow: vi.fn(async () => undefined),
    sendSmsNow: vi.fn(async () => undefined),
  },
}));

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: vi.fn(async () => undefined),
}));

import { buildTestApp } from "./test-app";
import membersRouter from "../routes/members";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

const TEST_TAG = `email-rl-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestApp>;
let user: { id: number; email: string };
const PASSWORD = "test-password-123";

beforeAll(async () => {
  app = buildTestApp({ routers: [membersRouter] });

  const email = `${TEST_TAG}-member@example.test`;
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const [row] = await db
    .insert(usersTable)
    .values({ name: "RL Tester", email, passwordHash, role: "member" })
    .returning({ id: usersTable.id, email: usersTable.email });
  user = row;
  seededUserIds.push(row.id);
});

afterAll(async () => {
  for (const id of seededUserIds) {
    await db.execute(
      sql`DELETE FROM communication_log WHERE user_id = ${id}`,
    );
    await db
      .delete(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

beforeEach(async () => {
  await db
    .delete(emailChangeAttemptsTable)
    .where(eq(emailChangeAttemptsTable.userId, user.id));
});

describe("POST /members/me/email rate limiting", () => {
  it("allows the first 3 requests within an hour and rejects the 4th with 429", async () => {
    const cookie = signCookie(user.id, user.email);

    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/members/me/email")
        .set("Cookie", cookie)
        .send({
          currentPassword: PASSWORD,
          newEmail: `${TEST_TAG}-target-${i}-${Date.now()}@example.test`,
        });
      expect(res.status).toBe(200);
    }

    const blocked = await request(app)
      .post("/api/members/me/email")
      .set("Cookie", cookie)
      .send({
        currentPassword: PASSWORD,
        newEmail: `${TEST_TAG}-target-blocked-${Date.now()}@example.test`,
      });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many email changes/i);
    expect(blocked.body.retryAfter).toBeGreaterThan(0);
    expect(blocked.headers["retry-after"]).toBeDefined();

    const rows = await db
      .select()
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.userId, user.id));
    expect(rows).toHaveLength(3);
  });

  it("rejects with 429 once the daily cap is reached even if hourly counts roll over", async () => {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    // Pre-seed 10 attempts more than 1h ago but within the last 24h.
    // Hourly count is 0, but daily count already at the cap.
    await db.insert(emailChangeAttemptsTable).values(
      Array.from({ length: 10 }, () => ({
        userId: user.id,
        createdAt: twoHoursAgo,
      })),
    );

    const cookie = signCookie(user.id, user.email);
    const res = await request(app)
      .post("/api/members/me/email")
      .set("Cookie", cookie)
      .send({
        currentPassword: PASSWORD,
        newEmail: `${TEST_TAG}-daily-cap-${Date.now()}@example.test`,
      });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many email changes/i);
  });

  it("only allows the configured cap when many requests fire concurrently", async () => {
    const cookie = signCookie(user.id, user.email);

    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        request(app)
          .post("/api/members/me/email")
          .set("Cookie", cookie)
          .send({
            currentPassword: PASSWORD,
            newEmail: `${TEST_TAG}-concurrent-${i}-${Date.now()}@example.test`,
          }),
      ),
    );

    const ok = responses.filter((r) => r.status === 200).length;
    const limited = responses.filter((r) => r.status === 429).length;

    expect(ok).toBe(3);
    expect(limited).toBe(5);

    const rows = await db
      .select()
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.userId, user.id));
    expect(rows).toHaveLength(3);
  });

  it("does not consume rate-limit slots for invalid-password attempts", async () => {
    const cookie = signCookie(user.id, user.email);

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/members/me/email")
        .set("Cookie", cookie)
        .send({
          currentPassword: "wrong-password",
          newEmail: `${TEST_TAG}-bad-${i}-${Date.now()}@example.test`,
        });
      expect(res.status).toBe(400);
    }

    const rows = await db
      .select()
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.userId, user.id));
    expect(rows).toHaveLength(0);
  });
});
