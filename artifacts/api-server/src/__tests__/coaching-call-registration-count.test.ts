import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  coachesTable,
  coachingCallsTable,
  coachingCallAttendanceTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import coachingRouter from "../routes/coaching";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `coaching-regcount-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
let seededCoachId = 0;
let callId = 0;

let memberA = { userId: 0, cookie: "" };
let memberB = { userId: 0, cookie: "" };

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function makeUser(label: string): Promise<{ userId: number; cookie: string }> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-${label}@example.test`,
      name: `Member ${label}`,
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededUserIds.push(user.id);

  const [product] = await db
    .insert(productsTable)
    .values({
      slug: `${TAG}-product-${label}`,
      name: `${label} product`,
      type: "backend",
      entitlementKeys: ["coaching:strategy"] as unknown as string[],
      sortOrder: 99,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(product.id);

  await db.insert(userProductsTable).values({
    userId: user.id,
    productId: product.id,
    status: "active",
  });

  return { userId: user.id, cookie: signCookie(user.id, user.email) };
}

beforeAll(async () => {
  app = buildTestAppWithRouters([coachingRouter]);

  memberA = await makeUser("a");
  memberB = await makeUser("b");

  const [coach] = await db
    .insert(coachesTable)
    .values({
      name: `${TAG} coach`,
      bio: "Test coach",
      specialties: "test",
      callTypes: ["strategy"],
    })
    .returning({ id: coachesTable.id });
  seededCoachId = coach.id;

  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const [call] = await db
    .insert(coachingCallsTable)
    .values({
      title: `${TAG} strategy session`,
      description: "One-off strategy session",
      callType: "strategy",
      coachId: coach.id,
      meetLink: "https://meet.google.com/strategy-xyz",
      scheduledAt: future,
      durationMinutes: 60,
      requiredEntitlement: "coaching:strategy",
    })
    .returning({ id: coachingCallsTable.id });
  callId = call.id;
});

afterAll(async () => {
  if (callId) {
    await db
      .delete(coachingCallAttendanceTable)
      .where(inArray(coachingCallAttendanceTable.callId, [callId]));
    await db.delete(coachingCallsTable).where(inArray(coachingCallsTable.id, [callId]));
  }
  if (seededCoachId) {
    await db.delete(coachesTable).where(inArray(coachesTable.id, [seededCoachId]));
  }
  if (seededUserIds.length > 0) {
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  if (seededProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, seededProductIds));
  }
});

function register(cookie: string) {
  return request(app).post(`/api/coaching-calls/${callId}/attendance`).set("Cookie", cookie);
}
function cancel(cookie: string) {
  return request(app).delete(`/api/coaching-calls/${callId}/attendance`).set("Cookie", cookie);
}

describe("POST/DELETE /api/coaching-calls/:id/attendance — registeredCount accuracy", () => {
  it("register -> cancel -> re-register keeps the count correct (no drift)", async () => {
    let res = await register(memberA.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ registered: true, registeredCount: 1 });

    // A second member registers: count is 2.
    res = await register(memberB.cookie);
    expect(res.body).toMatchObject({ registered: true, registeredCount: 2 });

    // Member A cancels: back down to 1.
    res = await cancel(memberA.cookie);
    expect(res.body).toMatchObject({ registered: false, registeredCount: 1 });

    // Member A re-registers. The attendance row already exists from the first
    // registration, so a naive "only count brand-new rows" approach would leave
    // the count stuck at 1. It must climb back to 2.
    res = await register(memberA.cookie);
    expect(res.body).toMatchObject({ registered: true, registeredCount: 2 });
  });

  it("registering twice does not double-count the same member", async () => {
    // Reset to a clean slate for this call's two members.
    await cancel(memberA.cookie);
    await cancel(memberB.cookie);

    let res = await register(memberA.cookie);
    expect(res.body.registeredCount).toBe(1);

    // Idempotent: a repeated register for the same member stays at 1.
    res = await register(memberA.cookie);
    expect(res.body).toMatchObject({ registered: true, registeredCount: 1 });
  });

  it("repeated cancels are no-ops and never drive the count negative", async () => {
    await cancel(memberA.cookie);
    let res = await cancel(memberA.cookie);
    expect(res.body).toMatchObject({ registered: false, registeredCount: 0 });

    res = await cancel(memberB.cookie);
    expect(res.body.registeredCount).toBe(0);
  });

  it("a recording-view row that later registers is counted exactly once", async () => {
    await cancel(memberA.cookie);
    await cancel(memberB.cookie);

    // Member A opens the recording first (creates an attendance row with
    // registered_at still null — must NOT count yet).
    let res = await request(app)
      .post(`/api/coaching-calls/${callId}/recording-view`)
      .set("Cookie", memberA.cookie);
    expect(res.status).toBe(200);

    res = await request(app)
      .get("/api/coaching-calls")
      .set("Cookie", memberA.cookie);
    const call = (res.body as Array<{ id: number; registeredCount: number; hasRegistered: boolean }>)
      .find((c) => c.id === callId)!;
    expect(call.registeredCount).toBe(0);
    expect(call.hasRegistered).toBe(false);

    // Now member A registers on top of the existing recording-view row: counts 1.
    res = await register(memberA.cookie);
    expect(res.body).toMatchObject({ registered: true, registeredCount: 1 });
  });
});
