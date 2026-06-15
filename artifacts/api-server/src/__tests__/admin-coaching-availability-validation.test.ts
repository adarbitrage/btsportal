import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, coachesTable, coachAvailabilityTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import adminCoachingRouter from "../routes/admin-coaching";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `avail-val-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
const userIds: number[] = [];
let coachId: number;
const slotIds: number[] = [];

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertAdmin(): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-admin@example.test`,
      name: "Admin",
      passwordHash,
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  userIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminCoachingRouter]);
  const adminId = await insertAdmin();
  adminCookie = signCookie(adminId, `${TAG}-admin@example.test`);

  const [coach] = await db
    .insert(coachesTable)
    .values({
      name: `Coach ${TAG}`,
      bio: "bio",
      specialties: "spec",
      oneOnOneEnabled: true,
    })
    .returning({ id: coachesTable.id });
  coachId = coach.id;
});

afterAll(async () => {
  if (slotIds.length > 0) {
    await db.delete(coachAvailabilityTable).where(inArray(coachAvailabilityTable.id, slotIds));
  }
  if (coachId) {
    await db.delete(coachAvailabilityTable).where(eq(coachAvailabilityTable.coachId, coachId));
    await db.delete(coachesTable).where(eq(coachesTable.id, coachId));
  }
  if (userIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
});

describe("admin coaching availability — session length & buffer validation", () => {
  it("persists a zero buffer instead of coercing it to the default", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/availability")
      .set("Cookie", adminCookie)
      .send({
        coachId,
        dayOfWeek: 1,
        startTime: "09:00",
        endTime: "17:00",
        sessionDurationMinutes: 45,
        bufferMinutes: 0,
      });
    expect(res.status).toBe(201);
    expect(res.body.sessionDurationMinutes).toBe(45);
    expect(res.body.bufferMinutes).toBe(0);
    slotIds.push(res.body.id);
  });

  it("rejects a session duration outside 15-180", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/availability")
      .set("Cookie", adminCookie)
      .send({ coachId, dayOfWeek: 2, startTime: "09:00", endTime: "17:00", sessionDurationMinutes: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sessionDurationMinutes/);
  });

  it("rejects a negative buffer on create", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/availability")
      .set("Cookie", adminCookie)
      .send({ coachId, dayOfWeek: 3, startTime: "09:00", endTime: "17:00", bufferMinutes: -5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bufferMinutes/);
  });

  it("rejects an out-of-range session duration on update", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/availability/${slotIds[0]}`)
      .set("Cookie", adminCookie)
      .send({ sessionDurationMinutes: 500 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sessionDurationMinutes/);
  });

  it("rejects a negative buffer on update", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/availability/${slotIds[0]}`)
      .set("Cookie", adminCookie)
      .send({ bufferMinutes: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bufferMinutes/);
  });

  it("saves valid session length and buffer on update", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/availability/${slotIds[0]}`)
      .set("Cookie", adminCookie)
      .send({ sessionDurationMinutes: 90, bufferMinutes: 30 });
    expect(res.status).toBe(200);
    expect(res.body.sessionDurationMinutes).toBe(90);
    expect(res.body.bufferMinutes).toBe(30);
  });
});
