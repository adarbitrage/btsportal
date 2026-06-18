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
      callTypes: ["weekly_qa"],
    })
    .returning({ id: coachesTable.id });
  coachId = coach.id;
});

afterAll(async () => {
  if (callId) {
    await db.delete(coachingCallsTable).where(eq(coachingCallsTable.id, callId));
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

  it("rejects a blank specialty", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({ specialties: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/specialty/i);
  });

  it("rejects a blank bio", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/${coachId}`)
      .set("Cookie", adminCookie)
      .send({ bio: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bio/i);
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

  it("rejects creating a coach with a missing required field", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/coaches")
      .set("Cookie", adminCookie)
      .send({ name: "No Specialty", bio: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/specialty/i);
  });

  it("rejects creating a coach without a bio", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/coaches")
      .set("Cookie", adminCookie)
      .send({ name: `${TAG} Bad`, specialties: "SEO" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bio/i);
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
        callTypes: ["weekly_qa"],
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
        callTypes: ["weekly_qa", "strategy"],
        timezone: "Europe/London",
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: `${TAG} New Coach`,
      specialties: "Email Marketing",
      bio: "A brand new coach",
      photoUrl: "https://example.test/new-coach.png",
      callTypes: ["weekly_qa", "strategy"],
      timezone: "Europe/London",
    });
    expect(typeof res.body.id).toBe("number");
    created.push(res.body.id);

    // The member /coaches endpoint only lists active group-call coaches, so the
    // new row must have those flags set for it to surface there. The scheduling
    // fields must persist exactly as sent.
    const [row] = await db
      .select()
      .from(coachesTable)
      .where(eq(coachesTable.id, res.body.id));
    expect(row.doesGroupCalls).toBe(true);
    expect(row.isActive).toBe(true);
    expect(row.callTypes).toEqual(["weekly_qa", "strategy"]);
    expect(row.timezone).toBe("Europe/London");
  });

  it("falls back to schema defaults when scheduling fields are omitted", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/coaches")
      .set("Cookie", adminCookie)
      .send({
        name: `${TAG} Default Coach`,
        specialties: "Funnels",
        bio: "No scheduling fields supplied",
      });
    expect(res.status).toBe(201);
    created.push(res.body.id);
    expect(res.body.callTypes).toEqual([]);
    expect(res.body.timezone).toBe("America/New_York");
  });

  it("rejects an invalid timezone", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/coaches")
      .set("Cookie", adminCookie)
      .send({
        name: `${TAG} Bad TZ`,
        specialties: "Funnels",
        bio: "Bad timezone",
        timezone: "Not/AZone",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/timezone/i);
  });

  it("rejects creation when a required field is missing", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/coaches")
      .set("Cookie", adminCookie)
      .send({ name: "Only A Name" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/specialty/i);
  });

  it("updates scheduling fields on an existing coach", async () => {
    const [created2] = await db
      .insert(coachesTable)
      .values({ name: `${TAG} Patchable`, callTypes: ["weekly_qa"] })
      .returning({ id: coachesTable.id });
    created.push(created2.id);

    const res = await request(app)
      .patch(`/api/admin/coaching/coaches/${created2.id}`)
      .set("Cookie", adminCookie)
      .send({ callTypes: ["mastermind"], timezone: "America/Chicago" });
    expect(res.status).toBe(200);
    expect(res.body.callTypes).toEqual(["mastermind"]);
    expect(res.body.timezone).toBe("America/Chicago");
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
});
