import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, phoneChangeHistoryTable } from "@workspace/db";
import { eq, inArray, desc } from "drizzle-orm";

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: vi.fn(async () => "job_test_id"),
  startWorker: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    sendEmailNow: vi.fn(async () => ({ success: true })),
  },
}));

import { buildTestAppWithRouters } from "./test-app";
import onboardingRouter from "../routes/onboarding";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `onboarding-phone-history-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;

async function seedMember(opts: { phone: string | null }): Promise<{ id: number; cookie: string }> {
  const email = `${TEST_TAG}-${randomUUID().slice(0, 6)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Phone History Test",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
      phone: opts.phone,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  const token = jwt.sign({ userId: row.id, email }, JWT_SECRET, { expiresIn: "1h" });
  return { id: row.id, cookie: `access_token=${token}` };
}

beforeAll(() => {
  app = buildTestAppWithRouters([onboardingRouter]);
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("PATCH /members/me/profile — phone change history", () => {
  it("records the previous phone number when a member updates phone", async () => {
    const oldPhone = "+15555550100";
    const newPhone = "+15555550111";
    const { id, cookie } = await seedMember({ phone: oldPhone });

    const res = await request(app)
      .patch("/api/members/me/profile")
      .set("Cookie", cookie)
      .send({ phone: newPhone });

    expect(res.status).toBe(200);
    expect(res.body.phone).toBe(newPhone);

    const history = await db
      .select()
      .from(phoneChangeHistoryTable)
      .where(eq(phoneChangeHistoryTable.userId, id))
      .orderBy(desc(phoneChangeHistoryTable.changedAt));
    expect(history).toHaveLength(1);
    expect(history[0].oldPhone).toBe(oldPhone);
    expect(history[0].newPhone).toBe(newPhone);
  });

  it("does not record history when the phone hasn't changed", async () => {
    const phone = "+15555550200";
    const { id, cookie } = await seedMember({ phone });

    const res = await request(app)
      .patch("/api/members/me/profile")
      .set("Cookie", cookie)
      .send({ phone });

    expect(res.status).toBe(200);
    const history = await db
      .select()
      .from(phoneChangeHistoryTable)
      .where(eq(phoneChangeHistoryTable.userId, id));
    expect(history).toHaveLength(0);
  });

  it("does not record history when the member never had a phone before", async () => {
    const { id, cookie } = await seedMember({ phone: null });

    const res = await request(app)
      .patch("/api/members/me/profile")
      .set("Cookie", cookie)
      .send({ phone: "+15555550300" });

    expect(res.status).toBe(200);
    const history = await db
      .select()
      .from(phoneChangeHistoryTable)
      .where(eq(phoneChangeHistoryTable.userId, id));
    expect(history).toHaveLength(0);
  });

  it("does not record history when only non-phone fields are updated", async () => {
    const { id, cookie } = await seedMember({ phone: "+15555550400" });

    const res = await request(app)
      .patch("/api/members/me/profile")
      .set("Cookie", cookie)
      .send({ name: "New Name" });

    expect(res.status).toBe(200);
    const history = await db
      .select()
      .from(phoneChangeHistoryTable)
      .where(eq(phoneChangeHistoryTable.userId, id));
    expect(history).toHaveLength(0);
  });

  it("records a row each time the phone is changed across multiple updates", async () => {
    const phoneA = "+15555550500";
    const phoneB = "+15555550501";
    const phoneC = "+15555550502";
    const { id, cookie } = await seedMember({ phone: phoneA });

    await request(app).patch("/api/members/me/profile").set("Cookie", cookie).send({ phone: phoneB });
    await request(app).patch("/api/members/me/profile").set("Cookie", cookie).send({ phone: phoneC });

    const history = await db
      .select()
      .from(phoneChangeHistoryTable)
      .where(eq(phoneChangeHistoryTable.userId, id))
      .orderBy(desc(phoneChangeHistoryTable.changedAt));
    expect(history).toHaveLength(2);
    expect(history[0].oldPhone).toBe(phoneB);
    expect(history[0].newPhone).toBe(phoneC);
    expect(history[1].oldPhone).toBe(phoneA);
    expect(history[1].newPhone).toBe(phoneB);
  });
});
