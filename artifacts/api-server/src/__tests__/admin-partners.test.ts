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
  partnersTable,
  partnerAssignmentsTable,
  ghlSyncLogTable,
  kickoffCoachesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminPartnersRouter from "../routes/admin-partners";
import adminExpirationRouter from "../routes/admin-expiration";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `admin-partners-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededPartnerIds: number[] = [];
const seededKickoffCoachIds: number[] = [];
const seededProductIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let managerCookie: string;
let viewerCookie: string;
let memberCookie: string;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function seedUser(role: string, suffix: string): Promise<{ id: number; cookie: string }> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test ${suffix}`,
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, cookie: signCookie(row.id, email) };
}

async function insertPartner(suffix: string): Promise<number> {
  const [row] = await db
    .insert(partnersTable)
    .values({ displayName: `Partner ${suffix} ${TEST_TAG}`, isActive: true })
    .returning({ id: partnersTable.id });
  seededPartnerIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPartnersRouter, adminExpirationRouter]);
  // Per PERMISSION_MATRIX, support_agent holds partners:view but NOT
  // partners:manage (support staff can look at partner surfaces without
  // administering the program); `viewer` below is used exactly for that
  // "has view, lacks manage" negative case on manage-gated routes.
  const manager = await seedUser("admin", "manager");
  const viewer = await seedUser("support_agent", "viewer");
  const member = await seedUser("member", "member");
  managerCookie = manager.cookie;
  viewerCookie = viewer.cookie;
  memberCookie = member.cookie;
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(ghlSyncLogTable).where(inArray(ghlSyncLogTable.userId, seededUserIds));
    await db
      .delete(partnerAssignmentsTable)
      .where(inArray(partnerAssignmentsTable.memberId, seededUserIds));
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
  }
  if (seededProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, seededProductIds));
  }
  if (seededPartnerIds.length > 0) {
    await db
      .delete(partnerAssignmentsTable)
      .where(inArray(partnerAssignmentsTable.partnerId, seededPartnerIds));
    await db.delete(partnersTable).where(inArray(partnersTable.id, seededPartnerIds));
  }
  if (seededKickoffCoachIds.length > 0) {
    await db
      .delete(kickoffCoachesTable)
      .where(inArray(kickoffCoachesTable.id, seededKickoffCoachIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

async function insertKickoffCoach(suffix: string): Promise<number> {
  const [row] = await db
    .insert(kickoffCoachesTable)
    .values({
      displayName: `Kickoff Coach ${suffix} ${TEST_TAG}`,
      ghlLocationId: "test-location",
      isActive: false,
      tier: "full",
    })
    .returning({ id: kickoffCoachesTable.id });
  seededKickoffCoachIds.push(row.id);
  return row.id;
}

// Task #2115: kickoff-coach bios (e.g. Mark's blurb on the Book Kickoff step)
// must be editable from the admin panel without a redeploy — these routes are
// the edit surface whose values always win over the IS NULL-guarded roster
// seed.
describe("kickoff coach admin routes", () => {
  it("rejects list for members with no admin permission", async () => {
    const res = await request(app).get("/api/admin/kickoff-coaches").set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });

  it("lists coaches for a role holding partners:view", async () => {
    const id = await insertKickoffCoach("list");
    const res = await request(app).get("/api/admin/kickoff-coaches").set("Cookie", viewerCookie);
    expect(res.status).toBe(200);
    const coach = res.body.coaches.find((c: { id: number }) => c.id === id);
    expect(coach).toBeTruthy();
    expect(coach.bio).toBe(""); // null coalesced to ''
  });

  it("rejects PATCH for a role that lacks partners:manage", async () => {
    const id = await insertKickoffCoach("patch-403");
    const res = await request(app)
      .patch(`/api/admin/kickoff-coaches/${id}`)
      .set("Cookie", viewerCookie)
      .send({ bio: "should not persist" });
    expect(res.status).toBe(403);
  });

  it("updates the bio for a role holding partners:manage and persists it", async () => {
    const id = await insertKickoffCoach("patch-ok");
    const res = await request(app)
      .patch(`/api/admin/kickoff-coaches/${id}`)
      .set("Cookie", managerCookie)
      .send({ bio: "Updated blurb from the admin panel." });
    expect(res.status).toBe(200);
    expect(res.body.bio).toBe("Updated blurb from the admin panel.");

    const list = await request(app).get("/api/admin/kickoff-coaches").set("Cookie", managerCookie);
    const coach = list.body.coaches.find((c: { id: number }) => c.id === id);
    expect(coach.bio).toBe("Updated blurb from the admin panel.");
  });

  it("ignores calendar/tier fields and rejects an empty update", async () => {
    const id = await insertKickoffCoach("patch-empty");
    const res = await request(app)
      .patch(`/api/admin/kickoff-coaches/${id}`)
      .set("Cookie", managerCookie)
      .send({ ghlCalendarId: "forged-calendar", tier: "launchpad" });
    expect(res.status).toBe(400);
  });

  it("404s on a missing coach", async () => {
    const res = await request(app)
      .patch(`/api/admin/kickoff-coaches/999999999`)
      .set("Cookie", managerCookie)
      .send({ bio: "x" });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/admin/partners", () => {
  it("rejects members with no admin permission", async () => {
    const res = await request(app).get("/api/admin/partners").set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });

  it("allows a role holding partners:view", async () => {
    await insertPartner("list");
    const res = await request(app).get("/api/admin/partners").set("Cookie", managerCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.partners)).toBe(true);
  });
});

describe("POST /api/admin/partners", () => {
  it("rejects a role that lacks partners:manage", async () => {
    const res = await request(app)
      .post("/api/admin/partners")
      .set("Cookie", viewerCookie)
      .send({ displayName: "Should Not Be Created" });
    expect(res.status).toBe(403);
  });

  it("creates a partner for a role holding partners:manage", async () => {
    const res = await request(app)
      .post("/api/admin/partners")
      .set("Cookie", managerCookie)
      .send({ displayName: `Created ${TEST_TAG}` });
    expect(res.status).toBe(201);
    expect(res.body.displayName).toBe(`Created ${TEST_TAG}`);
    seededPartnerIds.push(res.body.id);
  });

  it("rejects an empty display name", async () => {
    const res = await request(app)
      .post("/api/admin/partners")
      .set("Cookie", managerCookie)
      .send({ displayName: "   " });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/members/:memberId/reassign-partner", () => {
  it("requires a reason", async () => {
    const member = await seedUser("member", "reassign-no-reason");
    const res = await request(app)
      .post(`/api/admin/members/${member.id}/reassign-partner`)
      .set("Cookie", managerCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it("reassigns to a specific partner and ends the prior active row", async () => {
    const oldPartner = await insertPartner("reassign-old");
    const newPartner = await insertPartner("reassign-new");
    const member = await seedUser("member", "reassign-target");
    await db
      .insert(partnerAssignmentsTable)
      .values({ memberId: member.id, partnerId: oldPartner, status: "active" });

    const res = await request(app)
      .post(`/api/admin/members/${member.id}/reassign-partner`)
      .set("Cookie", managerCookie)
      .send({ partnerId: newPartner, reason: "test reassignment" });
    expect(res.status).toBe(200);
    expect(res.body.partnerId).toBe(newPartner);

    const history = await db
      .select()
      .from(partnerAssignmentsTable)
      .where(eq(partnerAssignmentsTable.memberId, member.id));
    expect(history.filter((r) => r.status === "active")).toHaveLength(1);
    expect(history.filter((r) => r.status === "reassigned")).toHaveLength(1);
  });

  it("rejects a non-manager role", async () => {
    const member = await seedUser("member", "reassign-forbidden");
    const res = await request(app)
      .post(`/api/admin/members/${member.id}/reassign-partner`)
      .set("Cookie", viewerCookie)
      .send({ reason: "test" });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/members/:memberId/end-partner-assignment", () => {
  it("ends the active assignment", async () => {
    const partnerId = await insertPartner("end-route");
    const member = await seedUser("member", "end-target");
    await db
      .insert(partnerAssignmentsTable)
      .values({ memberId: member.id, partnerId, status: "active" });

    const res = await request(app)
      .post(`/api/admin/members/${member.id}/end-partner-assignment`)
      .set("Cookie", managerCookie)
      .send({ reason: "manual end" });
    expect(res.status).toBe(200);
    expect(res.body.ended).toBe(true);
  });
});

describe("term-expiry cleanup (run-expiration-check)", () => {
  it("ends a partner assignment when a member's only qualifying grant expires", async () => {
    const partnerId = await insertPartner("expiry");
    const member = await seedUser("member", "expiry-target");
    await db
      .insert(partnerAssignmentsTable)
      .values({ memberId: member.id, partnerId, status: "active" });

    const [sixMonthProduct] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(eq(productsTable.slug, "6month"))
      .limit(1);
    expect(sixMonthProduct).toBeDefined();

    await db.insert(userProductsTable).values({
      userId: member.id,
      productId: sixMonthProduct.id,
      status: "active",
      expiresAt: new Date(Date.now() - 1000 * 60),
    });

    const superAdmin = await seedUser("super_admin", "expiry-runner");
    const res = await request(app)
      .post("/api/admin/run-expiration-check")
      .set("Cookie", superAdmin.cookie);
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(partnerAssignmentsTable)
      .where(eq(partnerAssignmentsTable.memberId, member.id));
    const active = rows.filter((r) => r.status === "active");
    const ended = rows.filter((r) => r.status === "ended");
    expect(active).toHaveLength(0);
    expect(ended).toHaveLength(1);
  });

  it("keeps the partner assignment if another qualifying grant is still active", async () => {
    const partnerId = await insertPartner("expiry-keep");
    const member = await seedUser("member", "expiry-keep-target");
    await db
      .insert(partnerAssignmentsTable)
      .values({ memberId: member.id, partnerId, status: "active" });

    const [sixMonthProduct] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(eq(productsTable.slug, "6month"))
      .limit(1);
    const [lifetimeProduct] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(eq(productsTable.slug, "lifetime"))
      .limit(1);
    expect(sixMonthProduct).toBeDefined();
    expect(lifetimeProduct).toBeDefined();

    await db.insert(userProductsTable).values({
      userId: member.id,
      productId: sixMonthProduct.id,
      status: "active",
      expiresAt: new Date(Date.now() - 1000 * 60),
    });
    await db.insert(userProductsTable).values({
      userId: member.id,
      productId: lifetimeProduct.id,
      status: "active",
      expiresAt: null,
    });

    const superAdmin = await seedUser("super_admin", "expiry-keep-runner");
    const res = await request(app)
      .post("/api/admin/run-expiration-check")
      .set("Cookie", superAdmin.cookie);
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(partnerAssignmentsTable)
      .where(eq(partnerAssignmentsTable.memberId, member.id));
    const active = rows.filter((r) => r.status === "active");
    expect(active).toHaveLength(1);
  });
});
