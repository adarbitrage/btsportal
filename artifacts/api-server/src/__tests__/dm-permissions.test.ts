/**
 * DM Permission regression guard
 *
 * Critical invariants under test:
 *  1. Member → member messaging is ALWAYS rejected (through every entry point).
 *  2. Member → coach messaging is permitted.
 *  3. Coach → member messaging is permitted.
 *  4. Admin → member messaging is permitted (existing behaviour stays intact).
 *  5. Member → admin messaging is permitted (existing behaviour stays intact).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, dmThreadsTable, dmMessagesTable, auditLogTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import express from "express";
import cookieParser from "cookie-parser";
import { authenticate } from "../middleware/auth";
import { requestIdMiddleware, apiErrorHandler } from "../lib/api-errors";
import dmRouter from "../routes/dm";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `dm-perm-test-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

interface TestUser {
  id: number;
  email: string;
  cookie: string;
}

async function seedUser(suffix: string, role: string): Promise<TestUser> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test ${suffix}`,
      passwordHash,
      role: role as any,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email, cookie: signCookie(row.id, email) };
}

let app: ReturnType<typeof express>;
let member1: TestUser;
let member2: TestUser;
let coach: TestUser;
let admin: TestUser;

beforeAll(async () => {
  // Mount the dm router under /dm to mirror the production mount in routes/index.ts
  const _app = express();
  _app.use(express.json());
  _app.use(cookieParser());
  _app.use("/api", requestIdMiddleware);
  _app.use("/api", authenticate);
  _app.use("/api/dm", dmRouter);
  _app.use("/api", apiErrorHandler);
  app = _app;

  [member1, member2, coach, admin] = await Promise.all([
    seedUser("member1", "member"),
    seedUser("member2", "member"),
    seedUser("coach1", "coach"),
    seedUser("admin1", "admin"),
  ]);
});

afterAll(async () => {
  if (seededUserIds.length) {
    await db
      .delete(dmMessagesTable)
      .where(inArray(dmMessagesTable.senderId, seededUserIds));
    await db
      .delete(dmThreadsTable)
      .where(inArray(dmThreadsTable.memberId, seededUserIds));
    await db
      .delete(dmThreadsTable)
      .where(inArray(dmThreadsTable.adminId, seededUserIds));
    // Audit log entries reference actor_id → must be removed before user rows
    await db
      .delete(auditLogTable)
      .where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

// ---------------------------------------------------------------------------
// The non-negotiable guarantee
// ---------------------------------------------------------------------------

describe("member → member DMs are ALWAYS forbidden", () => {
  it("rejects thread creation between two members", async () => {
    const res = await request(app)
      .post("/api/dm/threads")
      .set("Cookie", member1.cookie)
      .send({ recipient_user_id: member2.id });

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/not permitted/i);
  });

  it("rejects thread creation where member tries to message themselves", async () => {
    const res = await request(app)
      .post("/api/dm/threads")
      .set("Cookie", member1.cookie)
      .send({ recipient_user_id: member1.id });

    expect(res.status).toBe(403);
  });

  it("rejects listing recipients that would include another member", async () => {
    const res = await request(app)
      .get("/api/dm/recipients")
      .set("Cookie", member1.cookie);

    expect(res.status).toBe(200);
    const recipients: Array<{ id: number; role: string }> = res.body.recipients;
    const memberRecipients = recipients.filter((r) => r.role === "member");
    expect(memberRecipients).toHaveLength(0);
  });

  it("rejects message sending in a member↔member thread (every-endpoint guarantee)", async () => {
    // Bypass the thread-creation guard by force-inserting a thread where both
    // participants are members. This proves the message endpoint independently
    // enforces the non-negotiable member↔member ban.
    const [forceThread] = await db
      .insert(dmThreadsTable)
      .values({ memberId: member1.id, adminId: member2.id })
      .returning();

    try {
      const res = await request(app)
        .post(`/api/dm/threads/${forceThread.id}/messages`)
        .set("Cookie", member1.cookie)
        .send({ body: "should be blocked" });

      expect(res.status).toBe(403);
    } finally {
      await db.delete(dmMessagesTable).where(eq(dmMessagesTable.threadId, forceThread.id));
      await db.delete(dmThreadsTable).where(eq(dmThreadsTable.id, forceThread.id));
    }
  });
});

// ---------------------------------------------------------------------------
// Permitted pairs
// ---------------------------------------------------------------------------

describe("member ↔ coach DMs are permitted", () => {
  it("allows a member to create a thread with a coach", async () => {
    const res = await request(app)
      .post("/api/dm/threads")
      .set("Cookie", member1.cookie)
      .send({ recipient_user_id: coach.id });

    expect(res.status).toBe(200);
    expect(res.body.thread).toBeDefined();
    expect(res.body.thread.memberId).toBe(member1.id);
    expect(res.body.thread.adminId).toBe(coach.id);
  });

  it("allows a member to list coaches among recipients", async () => {
    const res = await request(app)
      .get("/api/dm/recipients")
      .set("Cookie", member1.cookie);

    expect(res.status).toBe(200);
    const coachRecipients = res.body.recipients.filter((r: any) => r.role === "coach");
    expect(coachRecipients.length).toBeGreaterThan(0);
    expect(coachRecipients.some((r: any) => r.id === coach.id)).toBe(true);
  });

  it("allows a coach to create a thread with a member", async () => {
    const res = await request(app)
      .post("/api/dm/threads")
      .set("Cookie", coach.cookie)
      .send({ recipient_user_id: member2.id });

    expect(res.status).toBe(200);
    expect(res.body.thread).toBeDefined();
    expect(res.body.thread.memberId).toBe(member2.id);
    expect(res.body.thread.adminId).toBe(coach.id);
  });

  it("allows a coach to list threads", async () => {
    const res = await request(app)
      .get("/api/dm/threads")
      .set("Cookie", coach.cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.threads)).toBe(true);
  });

  it("allows a coach to list members as recipients", async () => {
    const res = await request(app)
      .get("/api/dm/recipients")
      .set("Cookie", coach.cookie);

    expect(res.status).toBe(200);
    const memberRecipients = res.body.recipients.filter((r: any) => r.role === "member");
    expect(memberRecipients.length).toBeGreaterThan(0);
  });

  it("allows a coach to get their unread count", async () => {
    const res = await request(app)
      .get("/api/dm/unread-count")
      .set("Cookie", coach.cookie);

    expect(res.status).toBe(200);
    expect(typeof res.body.unreadCount).toBe("number");
  });
});

describe("member ↔ admin DMs still work (regression guard)", () => {
  it("allows a member to create a thread with an admin", async () => {
    const res = await request(app)
      .post("/api/dm/threads")
      .set("Cookie", member1.cookie)
      .send({ recipient_user_id: admin.id });

    expect(res.status).toBe(200);
    expect(res.body.thread.memberId).toBe(member1.id);
    expect(res.body.thread.adminId).toBe(admin.id);
  });

  it("allows an admin to create a thread with a member", async () => {
    const res = await request(app)
      .post("/api/dm/threads")
      .set("Cookie", admin.cookie)
      .send({ recipient_user_id: member1.id });

    expect(res.status).toBe(200);
    expect(res.body.thread.memberId).toBe(member1.id);
    expect(res.body.thread.adminId).toBe(admin.id);
  });
});

describe("coach shared inbox coverage — any coach can access member↔coach threads", () => {
  it("allows coach B to list threads originally started with coach A", async () => {
    // coach starts a thread with member1 as the initiating coach
    const threadRes = await request(app)
      .post("/api/dm/threads")
      .set("Cookie", coach.cookie)
      .send({ recipient_user_id: member1.id });
    expect(threadRes.status).toBe(200);
    const threadId = threadRes.body.thread.id;

    // A second coach seeds another cookie to act as coach B
    const coachB = await seedUser("coachB", "coach");

    // Coach B should see this thread in their inbox (shared inbox)
    const threadsRes = await request(app)
      .get("/api/dm/threads")
      .set("Cookie", coachB.cookie);
    expect(threadsRes.status).toBe(200);
    const ids = threadsRes.body.threads.map((t: any) => t.id);
    expect(ids).toContain(threadId);

    // Coach B can also open the thread
    const msgRes = await request(app)
      .get(`/api/dm/threads/${threadId}/messages`)
      .set("Cookie", coachB.cookie);
    expect(msgRes.status).toBe(200);

    // Coach B can reply
    const replyRes = await request(app)
      .post(`/api/dm/threads/${threadId}/messages`)
      .set("Cookie", coachB.cookie)
      .send({ body: "Covering for coach A!" });
    expect(replyRes.status).toBe(201);
    expect(replyRes.body.message.body).toBe("Covering for coach A!");
  });

  it("includes shared threads in coach B unread count when member messages coach A", async () => {
    // Coach A creates a thread with member1
    const threadRes = await request(app)
      .post("/api/dm/threads")
      .set("Cookie", coach.cookie)
      .send({ recipient_user_id: member1.id });
    expect(threadRes.status).toBe(200);
    const threadId = threadRes.body.thread.id;

    // Member1 sends a message (unread for all coaches)
    await request(app)
      .post(`/api/dm/threads/${threadId}/messages`)
      .set("Cookie", member1.cookie)
      .send({ body: "Hey coach, quick question!" });

    // Coach B (different coach) — their shared-inbox unread count should be > 0
    const coachB = await seedUser("coachB_unread", "coach");
    const unreadRes = await request(app)
      .get("/api/dm/unread-count")
      .set("Cookie", coachB.cookie);
    expect(unreadRes.status).toBe(200);
    expect(unreadRes.body.unreadCount).toBeGreaterThan(0);
  });
});

describe("message sending respects permissions", () => {
  it("allows a member to send a message in a member↔coach thread", async () => {
    // Ensure the thread exists first
    const threadRes = await request(app)
      .post("/api/dm/threads")
      .set("Cookie", member1.cookie)
      .send({ recipient_user_id: coach.id });
    expect(threadRes.status).toBe(200);
    const threadId = threadRes.body.thread.id;

    const msgRes = await request(app)
      .post(`/api/dm/threads/${threadId}/messages`)
      .set("Cookie", member1.cookie)
      .send({ body: "Hello coach!" });

    expect(msgRes.status).toBe(201);
    expect(msgRes.body.message.body).toBe("Hello coach!");
  });

  it("allows a coach to reply in a member↔coach thread", async () => {
    const threadRes = await request(app)
      .post("/api/dm/threads")
      .set("Cookie", member1.cookie)
      .send({ recipient_user_id: coach.id });
    expect(threadRes.status).toBe(200);
    const threadId = threadRes.body.thread.id;

    const msgRes = await request(app)
      .post(`/api/dm/threads/${threadId}/messages`)
      .set("Cookie", coach.cookie)
      .send({ body: "Hi there!" });

    expect(msgRes.status).toBe(201);
    expect(msgRes.body.message.body).toBe("Hi there!");
  });
});
