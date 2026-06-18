import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, coachesTable, coachingCallsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminCoachesRouter from "../routes/admin-coaches";

// Exercises the admin editor that lets staff maintain coach profiles (name,
// specialty, bio, photo) shown on the member Coaching page. RBAC is covered in
// admin-rbac.test.ts; this suite proves the list / update behavior and the
// required-field validation.

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `admin-coaches-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
let memberCookie = "";
let seededAdminId = 0;
let seededMemberId = 0;
let coachId = 0;
// Tracking for cleanup
const extraCoachIds: number[] = [];
let callId = 0;
const cleanupCallIds: number[] = [];
const DAY = 24 * 60 * 60 * 1000;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminCoachesRouter]);

  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [admin] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-admin@example.test`,
      name: "Coaches Admin",
      passwordHash,
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededAdminId = admin.id;
  adminCookie = signCookie(admin.id, admin.email);

  const [member] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-member@example.test`,
      name: "Plain Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededMemberId = member.id;
  memberCookie = signCookie(member.id, member.email);

  const [coach] = await db
    .insert(coachesTable)
    .values({
      name: `${TAG} Coach`,
      bio: "Original bio",
      specialties: "Original specialty",
      photoUrl: "https://example.test/old.png",
    })
    .returning({ id: coachesTable.id });
  coachId = coach.id;
});

afterAll(async () => {
  const allCallIds = [callId, ...cleanupCallIds].filter(Boolean);
  if (allCallIds.length > 0) {
    await db
      .delete(coachingCallsTable)
      .where(inArray(coachingCallsTable.id, allCallIds));
  }
  const allCoachIds = [coachId, ...extraCoachIds].filter(Boolean);
  if (allCoachIds.length > 0) {
    await db.delete(coachesTable).where(inArray(coachesTable.id, allCoachIds));
  }
  const userIds = [seededAdminId, seededMemberId].filter(Boolean);
  if (userIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
});

describe("admin coach profiles", () => {
  it("lists coach profiles", async () => {
    const res = await request(app)
      .get("/api/admin/coaching/coaches")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const found = res.body.coaches.find((c: { id: number }) => c.id === coachId);
    expect(found).toMatchObject({
      id: coachId,
      name: `${TAG} Coach`,
      bio: "Original bio",
      specialties: "Original specialty",
    });
  });

  it("updates editable profile fields", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({
        name: "New Name",
        specialties: "Funnel Strategy",
        bio: "Updated bio",
        photoUrl: "https://example.test/new.png",
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: coachId,
      name: "New Name",
      specialties: "Funnel Strategy",
      bio: "Updated bio",
      photoUrl: "https://example.test/new.png",
    });

    const [row] = await db
      .select()
      .from(coachesTable)
      .where(eq(coachesTable.id, coachId));
    expect(row.name).toBe("New Name");
    expect(row.bio).toBe("Updated bio");
  });

  it("includes visibility / capability flags in the list", async () => {
    const res = await request(app)
      .get("/api/admin/coaching/coaches")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const found = res.body.coaches.find((c: { id: number }) => c.id === coachId);
    expect(found).toMatchObject({
      isActive: expect.any(Boolean),
      doesGroupCalls: expect.any(Boolean),
      doesPrivateCoaching: expect.any(Boolean),
    });
  });

  it("toggles a coach's member-facing visibility (isActive)", async () => {
    const hide = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({ isActive: false });
    expect(hide.status).toBe(200);
    expect(hide.body.isActive).toBe(false);

    const [hidden] = await db
      .select()
      .from(coachesTable)
      .where(eq(coachesTable.id, coachId));
    expect(hidden.isActive).toBe(false);

    const show = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({ isActive: true });
    expect(show.status).toBe(200);
    expect(show.body.isActive).toBe(true);
  });

  it("updates capability switches (group / private)", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({ doesGroupCalls: false, doesPrivateCoaching: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      doesGroupCalls: false,
      doesPrivateCoaching: true,
    });

    const [row] = await db
      .select()
      .from(coachesTable)
      .where(eq(coachesTable.id, coachId));
    expect(row.doesGroupCalls).toBe(false);
    expect(row.doesPrivateCoaching).toBe(true);

    // Restore so later tests that assume the default keep working.
    await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({ doesGroupCalls: true, doesPrivateCoaching: false });
  });

  it("rejects a non-boolean visibility flag", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({ isActive: "yes" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/isActive/i);
  });

  it("creates a coach honoring explicit capability switches", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/coaches")
      .set("Cookie", adminCookie)
      .send({
        name: `${TAG} PrivateOnly`,
        specialties: "Private Strategy",
        bio: "Private-coaching only.",
        doesGroupCalls: false,
        doesPrivateCoaching: true,
        isActive: false,
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      doesGroupCalls: false,
      doesPrivateCoaching: true,
      isActive: false,
    });
    extraCoachIds.push(res.body.id);
  });

  it("clears the photo when given a blank value", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({ photoUrl: "" });
    expect(res.status).toBe(200);
    expect(res.body.photoUrl).toBeNull();
  });

  it("accepts and stores an absolute http:// photo URL", async () => {
    const httpUrl = "http://example.test/headshots/coach.png";
    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({ photoUrl: httpUrl });
    expect(res.status).toBe(200);
    expect(res.body.photoUrl).toBe(httpUrl);
  });

  it("accepts and stores an internal /objects/... upload path verbatim", async () => {
    const objectPath = "/objects/uploads/coach-headshot-abc123.png";
    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({ photoUrl: objectPath });
    expect(res.status).toBe(200);
    expect(res.body.photoUrl).toBe(objectPath);

    const [row] = await db
      .select()
      .from(coachesTable)
      .where(eq(coachesTable.id, coachId));
    expect(row.photoUrl).toBe(objectPath);
  });

  it("rejects a blank name", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({ name: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it("accepts a blank specialty (optional field)", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({ specialties: "   " });
    expect(res.status).toBe(200);
    expect(res.body.specialties).toBe("");
  });

  it("accepts a blank bio (optional field)", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({ bio: "   " });
    expect(res.status).toBe(200);
    expect(res.body.bio).toBe("");
  });

  it("rejects an over-length name", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({ name: "a".repeat(121) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it("rejects an over-length specialty", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({ specialties: "a".repeat(201) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/specialty/i);
  });

  it("rejects an over-length bio", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({ bio: "a".repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bio/i);
  });

  it("rejects an over-length photo URL", async () => {
    const longUrl = "https://example.test/" + "a".repeat(2048);
    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({ photoUrl: longUrl });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/photo url/i);
  });

  it("rejects a non-http(s) photo URL", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({ photoUrl: "ftp://example.test/pic.png" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/http/i);
  });

  it("rejects a malformed photo URL", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({ photoUrl: "not a url" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/photo url/i);
  });

  it("rejects an update with no fields", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown coach", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/99999999`)
      .set("Cookie", adminCookie)
      .send({ name: "Nobody" });
    expect(res.status).toBe(404);
  });

  it("creates a new coach with all fields", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/coaches")
      .set("Cookie", adminCookie)
      .send({
        name: `${TAG} Created`,
        specialties: "Email Marketing",
        bio: "A brand new coach.",
        photoUrl: "https://example.test/created.png",
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: `${TAG} Created`,
      specialties: "Email Marketing",
      bio: "A brand new coach.",
      photoUrl: "https://example.test/created.png",
    });
    expect(typeof res.body.id).toBe("number");
    extraCoachIds.push(res.body.id);

    // New coaches must surface on the member-facing "Your Coaches" grid, which
    // only lists active group-call coaches.
    const [row] = await db
      .select()
      .from(coachesTable)
      .where(eq(coachesTable.id, res.body.id));
    expect(row.doesGroupCalls).toBe(true);
    expect(row.isActive).toBe(true);
  });

  it("creates a coach without a photo (photo optional)", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/coaches")
      .set("Cookie", adminCookie)
      .send({
        name: `${TAG} NoPhoto`,
        specialties: "SEO",
        bio: "No photo on this one.",
      });
    expect(res.status).toBe(201);
    expect(res.body.photoUrl).toBeNull();
    extraCoachIds.push(res.body.id);
  });

  it("creates a coach without a specialty (optional field)", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/coaches")
      .set("Cookie", adminCookie)
      .send({ name: `${TAG} No Specialty`, bio: "x" });
    expect(res.status).toBe(201);
    extraCoachIds.push(res.body.id);
    expect(res.body.specialties).toBe("");
  });

  it("creates a coach without a bio (optional field)", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/coaches")
      .set("Cookie", adminCookie)
      .send({ name: `${TAG} No Bio`, specialties: "SEO" });
    expect(res.status).toBe(201);
    extraCoachIds.push(res.body.id);
    expect(res.body.bio).toBe("");
  });

  it("rejects creating a coach with an over-length name", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/coaches")
      .set("Cookie", adminCookie)
      .send({
        name: "a".repeat(121),
        specialties: "SEO",
        bio: "Valid bio.",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it("rejects creating a coach with a bad photo URL", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/coaches")
      .set("Cookie", adminCookie)
      .send({
        name: `${TAG} BadPhoto`,
        specialties: "SEO",
        bio: "Valid bio.",
        photoUrl: "not a url",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/photo url/i);
  });

  it("deletes a coach", async () => {
    const [coach] = await db
      .insert(coachesTable)
      .values({
        name: `${TAG} ToDelete`,
        bio: "Will be removed",
        specialties: "Temp",
      })
      .returning({ id: coachesTable.id });

    const res = await request(app)
      .delete(`/api/admin/coaching/coaches/${coach.id}`)
      .set("Cookie", adminCookie);
    expect([200, 204]).toContain(res.status);

    const rows = await db
      .select()
      .from(coachesTable)
      .where(eq(coachesTable.id, coach.id));
    expect(rows).toHaveLength(0);
  });

  it("blocks deleting a coach that is still on a scheduled call", async () => {
    const [guarded] = await db
      .insert(coachesTable)
      .values({
        name: `${TAG} Guarded`,
        bio: "Has a call",
        specialties: "Coaching",
      })
      .returning({ id: coachesTable.id });
    extraCoachIds.push(guarded.id);

    const [call] = await db
      .insert(coachingCallsTable)
      .values({
        title: `${TAG} Call`,
        description: "Test call",
        coachId: guarded.id,
        scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: coachingCallsTable.id });
    callId = call.id;

    const res = await request(app)
      .delete(`/api/admin/coaching/coaches/${guarded.id}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/upcoming coaching call/i);

    // Coach must still exist.
    const rows = await db
      .select()
      .from(coachesTable)
      .where(eq(coachesTable.id, guarded.id));
    expect(rows).toHaveLength(1);
  });

  it("lists the scheduled calls assigned to a coach", async () => {
    const [coach] = await db
      .insert(coachesTable)
      .values({
        name: `${TAG} CallsList`,
        bio: "Has calls",
        specialties: "Coaching",
      })
      .returning({ id: coachesTable.id });
    extraCoachIds.push(coach.id);

    const [c1] = await db
      .insert(coachingCallsTable)
      .values({
        title: `${TAG} List Call 1`,
        description: "one",
        coachId: coach.id,
        scheduledAt: new Date(Date.now() + 3 * DAY),
      })
      .returning({ id: coachingCallsTable.id });
    const [c2] = await db
      .insert(coachingCallsTable)
      .values({
        title: `${TAG} List Call 2`,
        description: "two",
        coachId: coach.id,
        scheduledAt: new Date(Date.now() + 1 * DAY),
      })
      .returning({ id: coachingCallsTable.id });
    cleanupCallIds.push(c1.id, c2.id);

    const res = await request(app)
      .get(`/api/admin/coaching/coaches/${coach.id}/calls`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.calls).toHaveLength(2);
    // Soonest first.
    expect(res.body.calls[0].id).toBe(c2.id);
    expect(res.body.calls[1].id).toBe(c1.id);
    expect(res.body.calls[0]).toMatchObject({ title: `${TAG} List Call 2` });
  });

  it("reassigns a coach's calls to another coach, then allows delete", async () => {
    const [fromCoach] = await db
      .insert(coachesTable)
      .values({ name: `${TAG} From`, bio: "from", specialties: "x" })
      .returning({ id: coachesTable.id });
    const [toCoach] = await db
      .insert(coachesTable)
      .values({ name: `${TAG} To`, bio: "to", specialties: "y" })
      .returning({ id: coachesTable.id });
    extraCoachIds.push(toCoach.id);

    const [call] = await db
      .insert(coachingCallsTable)
      .values({
        title: `${TAG} Reassign Call`,
        description: "x",
        coachId: fromCoach.id,
        scheduledAt: new Date(Date.now() + 5 * DAY),
      })
      .returning({ id: coachingCallsTable.id });
    cleanupCallIds.push(call.id);

    const reassign = await request(app)
      .post(`/api/admin/coaching/coaches/${fromCoach.id}/reassign-calls`)
      .set("Cookie", adminCookie)
      .send({ toCoachId: toCoach.id });
    expect(reassign.status).toBe(200);
    expect(reassign.body.reassigned).toBe(1);

    const [moved] = await db
      .select()
      .from(coachingCallsTable)
      .where(eq(coachingCallsTable.id, call.id));
    expect(moved.coachId).toBe(toCoach.id);

    // With no remaining calls, the from-coach can now be deleted.
    const del = await request(app)
      .delete(`/api/admin/coaching/coaches/${fromCoach.id}`)
      .set("Cookie", adminCookie);
    expect([200, 204]).toContain(del.status);
  });

  it("rejects reassigning to the same coach", async () => {
    const res = await request(app)
      .post(`/api/admin/coaching/coaches/${coachId}/reassign-calls`)
      .set("Cookie", adminCookie)
      .send({ toCoachId: coachId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/different coach/i);
  });

  it("rejects reassigning to an unknown coach", async () => {
    const res = await request(app)
      .post(`/api/admin/coaching/coaches/${coachId}/reassign-calls`)
      .set("Cookie", adminCookie)
      .send({ toCoachId: 99999999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not exist/i);
  });

  it("rejects reassigning without a destination coach", async () => {
    const res = await request(app)
      .post(`/api/admin/coaching/coaches/${coachId}/reassign-calls`)
      .set("Cookie", adminCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it("cancels a coach's calls, then allows delete", async () => {
    const [coach] = await db
      .insert(coachesTable)
      .values({ name: `${TAG} CancelCalls`, bio: "c", specialties: "z" })
      .returning({ id: coachesTable.id });

    const [call] = await db
      .insert(coachingCallsTable)
      .values({
        title: `${TAG} Cancel Call`,
        description: "x",
        coachId: coach.id,
        scheduledAt: new Date(Date.now() + 6 * DAY),
      })
      .returning({ id: coachingCallsTable.id });
    cleanupCallIds.push(call.id);

    const cancel = await request(app)
      .post(`/api/admin/coaching/coaches/${coach.id}/cancel-calls`)
      .set("Cookie", adminCookie);
    expect(cancel.status).toBe(200);
    expect(cancel.body.cancelled).toBe(1);

    const remaining = await db
      .select()
      .from(coachingCallsTable)
      .where(eq(coachingCallsTable.coachId, coach.id));
    expect(remaining).toHaveLength(0);

    const del = await request(app)
      .delete(`/api/admin/coaching/coaches/${coach.id}`)
      .set("Cookie", adminCookie);
    expect([200, 204]).toContain(del.status);
  });

  it("denies a plain member reassigning a coach's calls (403)", async () => {
    const res = await request(app)
      .post(`/api/admin/coaching/coaches/${coachId}/reassign-calls`)
      .set("Cookie", memberCookie)
      .send({ toCoachId: coachId });
    expect(res.status).toBe(403);
  });

  it("returns 404 when deleting an unknown coach", async () => {
    const res = await request(app)
      .delete(`/api/admin/coaching/coaches/99999999`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
  });

  it("returns 400 when deleting with an invalid id", async () => {
    const res = await request(app)
      .delete(`/api/admin/coaching/coaches/not-a-number`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(400);
  });

  it("denies a plain member listing coach profiles (403)", async () => {
    const res = await request(app)
      .get("/api/admin/coaching/coaches")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });

  it("denies a plain member updating a coach profile (403)", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", memberCookie)
      .send({ name: "Should Not Apply" });
    expect(res.status).toBe(403);
  });

  it("requires authentication to list coach profiles (401)", async () => {
    const res = await request(app).get("/api/admin/coaching/coaches");
    expect(res.status).toBe(401);
  });

  it("reorders coaches and persists sortOrder", async () => {
    const [a] = await db
      .insert(coachesTable)
      .values({ name: `${TAG} Order A`, bio: "A", specialties: "A" })
      .returning({ id: coachesTable.id });
    const [b] = await db
      .insert(coachesTable)
      .values({ name: `${TAG} Order B`, bio: "B", specialties: "B" })
      .returning({ id: coachesTable.id });
    const [c] = await db
      .insert(coachesTable)
      .values({ name: `${TAG} Order C`, bio: "C", specialties: "C" })
      .returning({ id: coachesTable.id });
    extraCoachIds.push(a.id, b.id, c.id);

    const res = await request(app)
      .put("/api/admin/coaching/coaches/order")
      .set("Cookie", adminCookie)
      .send({ ids: [c.id, a.id, b.id] });
    expect(res.status).toBe(200);

    const [rowA] = await db
      .select()
      .from(coachesTable)
      .where(eq(coachesTable.id, a.id));
    const [rowB] = await db
      .select()
      .from(coachesTable)
      .where(eq(coachesTable.id, b.id));
    const [rowC] = await db
      .select()
      .from(coachesTable)
      .where(eq(coachesTable.id, c.id));
    expect(rowC.sortOrder).toBe(0);
    expect(rowA.sortOrder).toBe(1);
    expect(rowB.sortOrder).toBe(2);

    // The returned list reflects the new order for these three coaches.
    const ordered = (res.body.coaches as { id: number }[])
      .map((coach) => coach.id)
      .filter((id) => [a.id, b.id, c.id].includes(id));
    expect(ordered).toEqual([c.id, a.id, b.id]);
  });

  it("rejects a reorder with a non-array ids", async () => {
    const res = await request(app)
      .put("/api/admin/coaching/coaches/order")
      .set("Cookie", adminCookie)
      .send({ ids: "nope" });
    expect(res.status).toBe(400);
  });

  it("rejects a reorder with duplicate ids", async () => {
    const res = await request(app)
      .put("/api/admin/coaching/coaches/order")
      .set("Cookie", adminCookie)
      .send({ ids: [coachId, coachId] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unique/i);
  });

  it("rejects a reorder referencing an unknown coach", async () => {
    const res = await request(app)
      .put("/api/admin/coaching/coaches/order")
      .set("Cookie", adminCookie)
      .send({ ids: [coachId, 99999999] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no longer exist/i);
  });

  it("denies a plain member reordering coaches (403)", async () => {
    const res = await request(app)
      .put("/api/admin/coaching/coaches/order")
      .set("Cookie", memberCookie)
      .send({ ids: [coachId] });
    expect(res.status).toBe(403);
  });
});

describe("admin coach create", () => {
  const created: number[] = [];

  afterAll(async () => {
    if (created.length) {
      await db.delete(coachesTable).where(inArray(coachesTable.id, created));
    }
  });

  it("creates a coach that shows on the member coaching page", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/coaches")
      .set("Cookie", adminCookie)
      .send({
        name: `${TAG} New Coach`,
        specialties: "Email Marketing",
        bio: "A brand new coach",
        photoUrl: "https://example.test/new-coach.png",
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: `${TAG} New Coach`,
      specialties: "Email Marketing",
      bio: "A brand new coach",
      photoUrl: "https://example.test/new-coach.png",
    });
    expect(typeof res.body.id).toBe("number");
    created.push(res.body.id);

    // The member /coaches endpoint only lists active group-call coaches, so the
    // new row must have those flags set for it to surface there.
    const [row] = await db
      .select()
      .from(coachesTable)
      .where(eq(coachesTable.id, res.body.id));
    expect(row.doesGroupCalls).toBe(true);
    expect(row.isActive).toBe(true);
  });

  it("creates a coach with only a name (specialty + bio optional)", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/coaches")
      .set("Cookie", adminCookie)
      .send({ name: `${TAG} Name Only` });
    expect(res.status).toBe(201);
    created.push(res.body.id);
    expect(res.body.name).toBe(`${TAG} Name Only`);
  });
});

describe("admin coach delete", () => {
  let plainCoachId = 0;
  let busyCoachId = 0;
  let callId = 0;

  beforeAll(async () => {
    const [plain] = await db
      .insert(coachesTable)
      .values({ name: `${TAG} Deletable` })
      .returning({ id: coachesTable.id });
    plainCoachId = plain.id;

    const [busy] = await db
      .insert(coachesTable)
      .values({ name: `${TAG} Busy` })
      .returning({ id: coachesTable.id });
    busyCoachId = busy.id;

    const [call] = await db
      .insert(coachingCallsTable)
      .values({
        title: `${TAG} Upcoming`,
        description: "",
        coachId: busyCoachId,
        scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: coachingCallsTable.id });
    callId = call.id;
  });

  afterAll(async () => {
    if (callId) {
      await db.delete(coachingCallsTable).where(eq(coachingCallsTable.id, callId));
    }
    const ids = [plainCoachId, busyCoachId].filter(Boolean);
    if (ids.length) {
      await db.delete(coachesTable).where(inArray(coachesTable.id, ids));
    }
  });

  it("blocks deletion when the coach has an upcoming call", async () => {
    const res = await request(app)
      .delete(`/api/admin/coaching/coaches/${busyCoachId}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/upcoming/i);

    // The coach must still exist after the blocked delete.
    const [row] = await db
      .select({ id: coachesTable.id })
      .from(coachesTable)
      .where(eq(coachesTable.id, busyCoachId));
    expect(row).toBeTruthy();
  });

  it("deletes a coach with no assigned calls", async () => {
    const res = await request(app)
      .delete(`/api/admin/coaching/coaches/${plainCoachId}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const rows = await db
      .select({ id: coachesTable.id })
      .from(coachesTable)
      .where(eq(coachesTable.id, plainCoachId));
    expect(rows).toHaveLength(0);
    plainCoachId = 0;
  });

  it("returns 404 when deleting an unknown coach", async () => {
    const res = await request(app)
      .delete(`/api/admin/coaching/coaches/99999999`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
  });

  it("returns a structured 409 (code + count) when delete is blocked by calls", async () => {
    const [guarded] = await db
      .insert(coachesTable)
      .values({
        name: `${TAG} Blocked`,
        bio: "Has calls",
        specialties: "Coaching",
      })
      .returning({ id: coachesTable.id });
    extraCoachIds.push(guarded.id);

    const inserted = await db
      .insert(coachingCallsTable)
      .values([
        {
          title: `${TAG} Blocked Call 1`,
          description: "x",
          coachId: guarded.id,
          scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        },
        {
          title: `${TAG} Blocked Call 2`,
          description: "x",
          coachId: guarded.id,
          scheduledAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
        },
      ])
      .returning({ id: coachingCallsTable.id });

    const res = await request(app)
      .delete(`/api/admin/coaching/coaches/${guarded.id}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("coach_has_scheduled_calls");
    expect(res.body.callCount).toBe(2);

    // Clean up the calls so the afterAll coach delete succeeds.
    await db
      .delete(coachingCallsTable)
      .where(
        inArray(
          coachingCallsTable.id,
          inserted.map((r) => r.id),
        ),
      );
  });

  it("reassigns a coach's calls to another coach, then allows deletion", async () => {
    const [from] = await db
      .insert(coachesTable)
      .values({
        name: `${TAG} Reassign From`,
        bio: "Leaving",
        specialties: "Coaching",
      })
      .returning({ id: coachesTable.id });
    const [to] = await db
      .insert(coachesTable)
      .values({
        name: `${TAG} Reassign To`,
        bio: "Taking over",
        specialties: "Coaching",
      })
      .returning({ id: coachesTable.id });
    extraCoachIds.push(from.id, to.id);

    const inserted = await db
      .insert(coachingCallsTable)
      .values([
        {
          title: `${TAG} Reassign Call 1`,
          description: "x",
          coachId: from.id,
          scheduledAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        },
        {
          title: `${TAG} Reassign Call 2`,
          description: "x",
          coachId: from.id,
          scheduledAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
        },
      ])
      .returning({ id: coachingCallsTable.id });

    const reassignRes = await request(app)
      .post(`/api/admin/coaching/coaches/${from.id}/reassign-calls`)
      .set("Cookie", adminCookie)
      .send({ toCoachId: to.id });
    expect(reassignRes.status).toBe(200);
    expect(reassignRes.body.reassigned).toBe(2);

    // Every call now points at the destination coach.
    const moved = await db
      .select({ coachId: coachingCallsTable.coachId })
      .from(coachingCallsTable)
      .where(
        inArray(
          coachingCallsTable.id,
          inserted.map((r) => r.id),
        ),
      );
    expect(moved.every((c) => c.coachId === to.id)).toBe(true);

    // The source coach can now be deleted.
    const delRes = await request(app)
      .delete(`/api/admin/coaching/coaches/${from.id}`)
      .set("Cookie", adminCookie);
    expect(delRes.status).toBe(200);

    // Clean up the moved calls (now on the destination coach).
    await db
      .delete(coachingCallsTable)
      .where(
        inArray(
          coachingCallsTable.id,
          inserted.map((r) => r.id),
        ),
      );
  });

  it("rejects reassigning to the same coach", async () => {
    const [solo] = await db
      .insert(coachesTable)
      .values({
        name: `${TAG} Solo`,
        bio: "x",
        specialties: "Coaching",
      })
      .returning({ id: coachesTable.id });
    extraCoachIds.push(solo.id);

    const res = await request(app)
      .post(`/api/admin/coaching/coaches/${solo.id}/reassign-calls`)
      .set("Cookie", adminCookie)
      .send({ toCoachId: solo.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/different coach/i);
  });

  it("rejects reassigning to a non-existent destination coach", async () => {
    const [src] = await db
      .insert(coachesTable)
      .values({
        name: `${TAG} Src`,
        bio: "x",
        specialties: "Coaching",
      })
      .returning({ id: coachesTable.id });
    extraCoachIds.push(src.id);

    const res = await request(app)
      .post(`/api/admin/coaching/coaches/${src.id}/reassign-calls`)
      .set("Cookie", adminCookie)
      .send({ toCoachId: 99999999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/destination coach/i);
  });

  it("returns 404 reassigning from an unknown coach", async () => {
    const [dest] = await db
      .insert(coachesTable)
      .values({
        name: `${TAG} Dest`,
        bio: "x",
        specialties: "Coaching",
      })
      .returning({ id: coachesTable.id });
    extraCoachIds.push(dest.id);

    const res = await request(app)
      .post(`/api/admin/coaching/coaches/99999999/reassign-calls`)
      .set("Cookie", adminCookie)
      .send({ toCoachId: dest.id });
    expect(res.status).toBe(404);
  });

  it("denies a plain member reassigning calls (403)", async () => {
    const res = await request(app)
      .post(`/api/admin/coaching/coaches/${coachId}/reassign-calls`)
      .set("Cookie", memberCookie)
      .send({ toCoachId: coachId });
    expect(res.status).toBe(403);
  });
});
