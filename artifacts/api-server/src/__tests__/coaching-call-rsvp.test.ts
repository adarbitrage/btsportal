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
import { and, eq, inArray } from "drizzle-orm";

// RSVP-first flow for group coaching calls:
//  - RSVPs close 1 hour before start (server-enforced 409 on register).
//  - The meet link is withheld by the listing unless the member RSVP'd AND
//    the join window (5 min before start) is open.
//  - POST /:id/join stamps joined_at (first click only) and returns the link;
//    403 without an RSVP or outside the join window.

import { buildTestAppWithRouters } from "./test-app";
import coachingRouter from "../routes/coaching";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `coaching-rsvp-${randomUUID().slice(0, 8)}`;
const MEET_LINK = "https://meet.google.com/rsvp-test";

let app: ReturnType<typeof buildTestAppWithRouters>;

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
const seededCallIds: number[] = [];
let seededCoachId = 0;

let member = { userId: 0, cookie: "" };
let memberNoRsvp = { userId: 0, cookie: "" };

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
      entitlementKeys: ["coaching:group"] as unknown as string[],
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

// A weekly group call starting `minutesFromNow` minutes from now.
async function makeCall(minutesFromNow: number): Promise<number> {
  const [call] = await db
    .insert(coachingCallsTable)
    .values({
      title: `${TAG} weekly (${minutesFromNow}m out)`,
      description: "Weekly group Q&A",
      callType: "weekly_qa",
      coachId: seededCoachId,
      meetLink: MEET_LINK,
      scheduledAt: new Date(Date.now() + minutesFromNow * 60_000),
      durationMinutes: 60,
      requiredEntitlement: "coaching:group",
    })
    .returning({ id: coachingCallsTable.id });
  seededCallIds.push(call.id);
  return call.id;
}

async function setScheduledAt(callId: number, minutesFromNow: number): Promise<void> {
  await db
    .update(coachingCallsTable)
    .set({ scheduledAt: new Date(Date.now() + minutesFromNow * 60_000) })
    .where(eq(coachingCallsTable.id, callId));
}

async function getAttendance(callId: number, userId: number) {
  const [row] = await db
    .select()
    .from(coachingCallAttendanceTable)
    .where(
      and(
        eq(coachingCallAttendanceTable.callId, callId),
        eq(coachingCallAttendanceTable.userId, userId),
      ),
    );
  return row ?? null;
}

function listCalls(cookie: string) {
  return request(app).get("/api/coaching-calls").set("Cookie", cookie);
}
function registerFor(callId: number, cookie: string) {
  return request(app).post(`/api/coaching-calls/${callId}/attendance`).set("Cookie", cookie);
}
function join(callId: number, cookie: string) {
  return request(app).post(`/api/coaching-calls/${callId}/join`).set("Cookie", cookie);
}

beforeAll(async () => {
  app = buildTestAppWithRouters([coachingRouter]);
  member = await makeUser("m");
  memberNoRsvp = await makeUser("n");

  const [coach] = await db
    .insert(coachesTable)
    .values({ name: `${TAG} coach`, bio: "t", specialties: "t" })
    .returning({ id: coachesTable.id });
  seededCoachId = coach.id;
});

afterAll(async () => {
  if (seededCallIds.length > 0) {
    await db
      .delete(coachingCallAttendanceTable)
      .where(inArray(coachingCallAttendanceTable.callId, seededCallIds));
    await db.delete(coachingCallsTable).where(inArray(coachingCallsTable.id, seededCallIds));
  }
  if (seededCoachId) {
    await db.delete(coachesTable).where(eq(coachesTable.id, seededCoachId));
  }
  if (seededUserIds.length > 0) {
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  if (seededProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, seededProductIds));
  }
});

describe("RSVP cutoff (1h before start)", () => {
  it("rejects registration inside the final hour with 409", async () => {
    const callId = await makeCall(30); // 30 min out — past the cutoff
    const res = await registerFor(callId, member.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/RSVPs are closed/i);
    expect(await getAttendance(callId, member.userId)).toBeNull();
  });

  it("accepts registration while more than an hour remains", async () => {
    const callId = await makeCall(120);
    const res = await registerFor(callId, member.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ registered: true });
  });
});

describe("meet link withholding in the listing", () => {
  it("withholds the link from a registered member before the join window", async () => {
    const callId = await makeCall(120);
    await registerFor(callId, member.cookie);
    const res = await listCalls(member.cookie);
    const call = res.body.find((c: { id: number }) => c.id === callId)!;
    expect(call.hasRegistered).toBe(true);
    expect(call.meetLink).toBeNull();
  });

  it("withholds the link from a non-RSVP'd member even inside the join window", async () => {
    const callId = await makeCall(120);
    await setScheduledAt(callId, 3); // window open, but no RSVP
    const res = await listCalls(memberNoRsvp.cookie);
    const call = res.body.find((c: { id: number }) => c.id === callId)!;
    expect(call.hasRegistered).toBe(false);
    expect(call.meetLink).toBeNull();
  });

  it("serves the link to an RSVP'd member once the window opens (5 min before)", async () => {
    const callId = await makeCall(120);
    await registerFor(callId, member.cookie);
    await setScheduledAt(callId, 3);
    const res = await listCalls(member.cookie);
    const call = res.body.find((c: { id: number }) => c.id === callId)!;
    expect(call.meetLink).toBe(MEET_LINK);
  });
});

describe("POST /api/coaching-calls/:id/join", () => {
  it("403s before the join window even with an RSVP", async () => {
    const callId = await makeCall(120);
    await registerFor(callId, member.cookie);
    const res = await join(callId, member.cookie);
    expect(res.status).toBe(403);
    expect((await getAttendance(callId, member.userId))!.joinedAt).toBeNull();
  });

  it("403s in-window without an RSVP and never creates an attendance row", async () => {
    const callId = await makeCall(120);
    await setScheduledAt(callId, 3);
    const res = await join(callId, memberNoRsvp.cookie);
    expect(res.status).toBe(403);
    expect(await getAttendance(callId, memberNoRsvp.userId)).toBeNull();
  });

  it("stamps joined_at (first click only) and returns the meet link in-window", async () => {
    const callId = await makeCall(120);
    await registerFor(callId, member.cookie);
    await setScheduledAt(callId, 3);

    let res = await join(callId, member.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ joined: true, meetLink: MEET_LINK });

    const first = (await getAttendance(callId, member.userId))!.joinedAt;
    expect(first).not.toBeNull();

    // Repeat click: still 200, but the original joined_at is preserved.
    res = await join(callId, member.cookie);
    expect(res.status).toBe(200);
    const second = (await getAttendance(callId, member.userId))!.joinedAt;
    expect(second!.getTime()).toBe(first!.getTime());

    // hasJoined surfaces in the listing.
    const list = await listCalls(member.cookie);
    const call = list.body.find((c: { id: number }) => c.id === callId)!;
    expect(call.hasJoined).toBe(true);
  });

  it("409s for a cancelled occurrence", async () => {
    const callId = await makeCall(120);
    await registerFor(callId, member.cookie);
    await db
      .update(coachingCallsTable)
      .set({ cancelledAt: new Date() })
      .where(eq(coachingCallsTable.id, callId));
    await setScheduledAt(callId, 3);
    const res = await join(callId, member.cookie);
    expect(res.status).toBe(409);
  });
});
