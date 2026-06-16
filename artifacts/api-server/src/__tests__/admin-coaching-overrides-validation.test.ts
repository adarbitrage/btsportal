import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, coachesTable, coachAvailabilityOverridesTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import adminCoachingRouter from "../routes/admin-coaching";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `override-val-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
const userIds: number[] = [];
let coachId: number;
const overrideIds: number[] = [];

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
  if (coachId) {
    await db.delete(coachAvailabilityOverridesTable).where(eq(coachAvailabilityOverridesTable.coachId, coachId));
    await db.delete(coachesTable).where(eq(coachesTable.id, coachId));
  }
  if (userIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
});

describe("admin coaching overrides — session length & buffer validation", () => {
  it("persists session length and buffer on create when valid", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/overrides")
      .set("Cookie", adminCookie)
      .send({
        coachId,
        overrideDate: "2099-01-15",
        overrideType: "extra",
        startTime: "09:00",
        endTime: "12:00",
        sessionDurationMinutes: 45,
        bufferMinutes: 10,
      });
    expect(res.status).toBe(201);
    expect(res.body.sessionDurationMinutes).toBe(45);
    expect(res.body.bufferMinutes).toBe(10);
    overrideIds.push(res.body.id);
  });

  it("persists a zero buffer on create instead of coercing to null", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/overrides")
      .set("Cookie", adminCookie)
      .send({
        coachId,
        overrideDate: "2099-01-16",
        overrideType: "extra",
        startTime: "09:00",
        endTime: "12:00",
        sessionDurationMinutes: 60,
        bufferMinutes: 0,
      });
    expect(res.status).toBe(201);
    expect(res.body.sessionDurationMinutes).toBe(60);
    expect(res.body.bufferMinutes).toBe(0);
    overrideIds.push(res.body.id);
  });

  it("stores null when session length and buffer are omitted on create", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/overrides")
      .set("Cookie", adminCookie)
      .send({
        coachId,
        overrideDate: "2099-01-17",
        overrideType: "extra",
        startTime: "09:00",
        endTime: "12:00",
      });
    expect(res.status).toBe(201);
    expect(res.body.sessionDurationMinutes).toBeNull();
    expect(res.body.bufferMinutes).toBeNull();
    overrideIds.push(res.body.id);
  });

  it("stores null when session length and buffer are blank on create", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/overrides")
      .set("Cookie", adminCookie)
      .send({
        coachId,
        overrideDate: "2099-01-18",
        overrideType: "extra",
        startTime: "09:00",
        endTime: "12:00",
        sessionDurationMinutes: "",
        bufferMinutes: "",
      });
    expect(res.status).toBe(201);
    expect(res.body.sessionDurationMinutes).toBeNull();
    expect(res.body.bufferMinutes).toBeNull();
    overrideIds.push(res.body.id);
  });

  it("rejects a zero session length on create", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/overrides")
      .set("Cookie", adminCookie)
      .send({
        coachId,
        overrideDate: "2099-01-19",
        overrideType: "extra",
        sessionDurationMinutes: 0,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sessionDurationMinutes/);
  });

  it("rejects a negative session length on create", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/overrides")
      .set("Cookie", adminCookie)
      .send({
        coachId,
        overrideDate: "2099-01-20",
        overrideType: "extra",
        sessionDurationMinutes: -30,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sessionDurationMinutes/);
  });

  it("rejects a non-integer session length on create", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/overrides")
      .set("Cookie", adminCookie)
      .send({
        coachId,
        overrideDate: "2099-01-21",
        overrideType: "extra",
        sessionDurationMinutes: "abc",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sessionDurationMinutes/);
  });

  it("rejects a negative buffer on create", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/overrides")
      .set("Cookie", adminCookie)
      .send({
        coachId,
        overrideDate: "2099-01-22",
        overrideType: "extra",
        bufferMinutes: -5,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bufferMinutes/);
  });

  it("rejects a non-integer buffer on create", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/overrides")
      .set("Cookie", adminCookie)
      .send({
        coachId,
        overrideDate: "2099-01-24",
        overrideType: "extra",
        bufferMinutes: "abc",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bufferMinutes/);
  });

  it("rejects a non-integer buffer on update", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/overrides/${overrideIds[0]}`)
      .set("Cookie", adminCookie)
      .send({ bufferMinutes: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bufferMinutes/);
  });

  it("persists session length and buffer on update when valid", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/overrides/${overrideIds[0]}`)
      .set("Cookie", adminCookie)
      .send({ sessionDurationMinutes: 90, bufferMinutes: 30 });
    expect(res.status).toBe(200);
    expect(res.body.sessionDurationMinutes).toBe(90);
    expect(res.body.bufferMinutes).toBe(30);
  });

  it("clears session length and buffer to null when explicitly blanked on update", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/overrides/${overrideIds[0]}`)
      .set("Cookie", adminCookie)
      .send({ sessionDurationMinutes: "", bufferMinutes: "" });
    expect(res.status).toBe(200);
    expect(res.body.sessionDurationMinutes).toBeNull();
    expect(res.body.bufferMinutes).toBeNull();
  });

  it("leaves session length and buffer untouched when omitted on update", async () => {
    const seed = await request(app)
      .post("/api/admin/coaching/overrides")
      .set("Cookie", adminCookie)
      .send({
        coachId,
        overrideDate: "2099-01-23",
        overrideType: "extra",
        sessionDurationMinutes: 50,
        bufferMinutes: 20,
      });
    expect(seed.status).toBe(201);
    overrideIds.push(seed.body.id);

    const res = await request(app)
      .patch(`/api/admin/coaching/overrides/${seed.body.id}`)
      .set("Cookie", adminCookie)
      .send({ reason: "updated reason" });
    expect(res.status).toBe(200);
    expect(res.body.sessionDurationMinutes).toBe(50);
    expect(res.body.bufferMinutes).toBe(20);
  });

  it("rejects a zero session length on update", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/overrides/${overrideIds[0]}`)
      .set("Cookie", adminCookie)
      .send({ sessionDurationMinutes: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sessionDurationMinutes/);
  });

  it("rejects an out-of-range session length on update", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/overrides/${overrideIds[0]}`)
      .set("Cookie", adminCookie)
      .send({ sessionDurationMinutes: 500 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sessionDurationMinutes/);
  });

  it("rejects a non-integer session length on update", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/overrides/${overrideIds[0]}`)
      .set("Cookie", adminCookie)
      .send({ sessionDurationMinutes: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sessionDurationMinutes/);
  });

  it("rejects a negative buffer on update", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/overrides/${overrideIds[0]}`)
      .set("Cookie", adminCookie)
      .send({ bufferMinutes: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bufferMinutes/);
  });
});
