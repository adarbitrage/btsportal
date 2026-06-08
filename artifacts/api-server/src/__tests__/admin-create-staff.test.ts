import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, auditLogTable } from "@workspace/db";
import { eq, inArray, and, desc, ilike } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    sendEmailNow: vi.fn(async () => ({ result: "sent" })),
    queueEmail: vi.fn(async () => ({ result: "queued" })),
  },
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `admin-staff-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;
let superAdminCookie: string;
let adminCookie: string;
let memberCookie: string;
let superAdminId: number;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(role: string, suffix: string) {
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
  return { id: row.id, email };
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);
  const superAdmin = await insertUser("super_admin", "super");
  const admin = await insertUser("admin", "admin");
  const member = await insertUser("member", "non-admin");
  superAdminId = superAdmin.id;
  superAdminCookie = signCookie(superAdmin.id, superAdmin.email);
  adminCookie = signCookie(admin.id, admin.email);
  memberCookie = signCookie(member.id, member.email);
});

afterAll(async () => {
  const createdByTests = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(ilike(usersTable.email, `${TEST_TAG}-%`));
  const allIds = Array.from(new Set([...seededUserIds, ...createdByTests.map((r) => r.id)]));
  if (allIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.actorId, allIds));
    await db.delete(auditLogTable).where(
      and(eq(auditLogTable.entityType, "user"), inArray(auditLogTable.entityId, allIds.map(String))),
    );
    await db.delete(usersTable).where(inArray(usersTable.id, allIds));
  }
});

describe("POST /api/admin/staff", () => {
  it("requires authentication (no cookie -> 401)", async () => {
    const res = await request(app)
      .post("/api/admin/staff")
      .send({ email: `${TEST_TAG}-unauth@example.test`, name: "Anon", role: "support_agent" });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin members with 403", async () => {
    const res = await request(app)
      .post("/api/admin/staff")
      .set("Cookie", memberCookie)
      .send({ email: `${TEST_TAG}-member-rbac@example.test`, name: "Blocked", role: "support_agent" });
    expect(res.status).toBe(403);
  });

  it("rejects plain admins (only members:assign_role / super_admin allowed) with 403", async () => {
    const res = await request(app)
      .post("/api/admin/staff")
      .set("Cookie", adminCookie)
      .send({ email: `${TEST_TAG}-admin-rbac@example.test`, name: "Blocked", role: "support_agent" });
    expect(res.status).toBe(403);

    const [row] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, `${TEST_TAG}-admin-rbac@example.test`));
    expect(row).toBeUndefined();
  });

  it("returns 400 when email or name is missing", async () => {
    const noEmail = await request(app)
      .post("/api/admin/staff")
      .set("Cookie", superAdminCookie)
      .send({ name: "No Email", role: "admin" });
    expect(noEmail.status).toBe(400);

    const noName = await request(app)
      .post("/api/admin/staff")
      .set("Cookie", superAdminCookie)
      .send({ email: `${TEST_TAG}-no-name@example.test`, role: "admin" });
    expect(noName.status).toBe(400);
  });

  it("returns 400 for an invalid email format", async () => {
    const res = await request(app)
      .post("/api/admin/staff")
      .set("Cookie", superAdminCookie)
      .send({ email: "not-an-email", name: "Bad Email", role: "admin" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid email/i);
  });

  it("returns 400 for a non-admin / unknown role", async () => {
    const asMember = await request(app)
      .post("/api/admin/staff")
      .set("Cookie", superAdminCookie)
      .send({ email: `${TEST_TAG}-role-member@example.test`, name: "Plain Member", role: "member" });
    expect(asMember.status).toBe(400);
    expect(asMember.body.error).toMatch(/role/i);

    const garbage = await request(app)
      .post("/api/admin/staff")
      .set("Cookie", superAdminCookie)
      .send({ email: `${TEST_TAG}-role-garbage@example.test`, name: "Garbage", role: "wizard" });
    expect(garbage.status).toBe(400);

    // Neither should have created a user.
    const rows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(ilike(usersTable.email, `${TEST_TAG}-role-%`));
    expect(rows.length).toBe(0);
  });

  it("returns 409 when the email is already registered", async () => {
    const existing = await insertUser("member", "dupe-target");

    const res = await request(app)
      .post("/api/admin/staff")
      .set("Cookie", superAdminCookie)
      .send({ email: existing.email.toUpperCase(), name: "Dupe Attempt", role: "admin" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
    expect(res.body.id).toBe(existing.id);
  });

  it("happy path: creates a ready-to-use staff account, returns a one-time password, audits the action", async () => {
    const newEmail = `${TEST_TAG}-happy@example.test`;
    const res = await request(app)
      .post("/api/admin/staff")
      .set("Cookie", superAdminCookie)
      .send({ email: newEmail.toUpperCase(), name: "  Casey Staff  ", role: "support_agent" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      email: newEmail,
      name: "Casey Staff",
      role: "support_agent",
    });
    expect(typeof res.body.id).toBe("number");
    // Temporary password is returned once and is a non-trivial string.
    expect(typeof res.body.temporaryPassword).toBe("string");
    expect(res.body.temporaryPassword.length).toBeGreaterThanOrEqual(16);

    const [stored] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, res.body.id));
    expect(stored).toBeDefined();
    expect(stored.email).toBe(newEmail);
    expect(stored.name).toBe("Casey Staff");
    expect(stored.role).toBe("support_agent");
    expect(stored.emailVerified).toBe(true);
    expect(stored.onboardingComplete).toBe(true);
    // Password is hashed (bcrypt), never the raw temp password.
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(stored.passwordHash).not.toBe(res.body.temporaryPassword);
    // The returned temp password actually authenticates against the stored hash.
    expect(await bcrypt.compare(res.body.temporaryPassword, stored.passwordHash)).toBe(true);

    const [entry] = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actionType, "create_staff"),
          eq(auditLogTable.entityType, "user"),
          eq(auditLogTable.entityId, String(res.body.id)),
        ),
      )
      .orderBy(desc(auditLogTable.createdAt))
      .limit(1);
    expect(entry, "audit log entry for create_staff").toBeDefined();
    expect(entry.actorId).toBe(superAdminId);
    expect(entry.description).toMatch(/support_agent/);
    const metadata = entry.metadata as { memberEmail?: string } | null;
    expect(metadata?.memberEmail).toBe(newEmail);
  });

  it("lowercases the stored email so case-variant duplicates collide", async () => {
    const newEmail = `${TEST_TAG}-case@example.test`;
    const first = await request(app)
      .post("/api/admin/staff")
      .set("Cookie", superAdminCookie)
      .send({ email: newEmail.toUpperCase(), name: "Case Sensitive", role: "content_manager" });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/admin/staff")
      .set("Cookie", superAdminCookie)
      .send({ email: newEmail, name: "Case Sensitive", role: "content_manager" });
    expect(second.status).toBe(409);
    expect(second.body.id).toBe(first.body.id);
  });
});
