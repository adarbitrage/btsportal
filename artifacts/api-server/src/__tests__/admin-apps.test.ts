import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  memberAppInstancesTable,
  auditLogTable,
} from "@workspace/db";
import { eq, and, inArray, desc, sql } from "drizzle-orm";

const { updateStaffUserPasswordMock, generateRandomPasswordMock } = vi.hoisted(() => ({
  updateStaffUserPasswordMock: vi.fn(async () => undefined),
  generateRandomPasswordMock: vi.fn(() => "MockedPassw0rd!"),
}));

vi.mock("../lib/ghl-agency-client", () => ({
  FLEXY_PORTAL_URL: "https://dashboard.getflexy.app",
  FLEXY_SNAPSHOT_ID: "",
  createLocation: vi.fn(),
  createStaffUser: vi.fn(),
  disableStaffUserForLocation: vi.fn(),
  findExistingStaffUser: vi.fn(),
  mintFlexyLoginUrl: vi.fn(),
  reactivateStaffUserForLocation: vi.fn(),
  updateStaffUserPassword: updateStaffUserPasswordMock,
  generateRandomPassword: generateRandomPasswordMock,
}));

import { buildTestApp } from "./test-app";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

interface SeededUser {
  id: number;
  email: string;
  name: string;
}

const TEST_TAG = `flexy-test-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestApp>;

let adminUser: SeededUser;
let memberUser: SeededUser;
let installedMember: SeededUser;

async function insertUser(role: string, suffix: string): Promise<SeededUser> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
  const name = `Test ${suffix}`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name,
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email, name };
}

beforeAll(async () => {
  app = buildTestApp();
  adminUser = await insertUser("super_admin", "admin");
  memberUser = await insertUser("member", "member");
  installedMember = await insertUser("member", "installed");

  await db.insert(memberAppInstancesTable).values({
    userId: installedMember.id,
    appName: "flexy",
    status: "installed",
    providerLocationId: "loc_test_123",
    providerStaffUserId: "staff_test_123",
    providerStaffEmail: `${TEST_TAG}-flexy-staff@example.test`,
  });
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db
      .delete(memberAppInstancesTable)
      .where(inArray(memberAppInstancesTable.userId, seededUserIds));
    await db
      .delete(auditLogTable)
      .where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  updateStaffUserPasswordMock.mockClear();
  generateRandomPasswordMock.mockClear();
});

describe("GET /api/admin/apps/flexy/lookup/:userId", () => {
  it("returns email + locationId + status for an installed member when called by an admin", async () => {
    const res = await request(app)
      .get(`/api/admin/apps/flexy/lookup/${installedMember.id}`)
      .set("Cookie", signCookie(adminUser.id, adminUser.email));

    expect(res.status).toBe(200);
    expect(res.body.member).toEqual(
      expect.objectContaining({
        id: installedMember.id,
        name: installedMember.name,
        email: installedMember.email,
        hasPhone: false,
        smsOptIn: false,
      }),
    );
    expect(res.body.flexy.status).toBe("installed");
    expect(res.body.flexy.email).toBe(`${TEST_TAG}-flexy-staff@example.test`);
    expect(res.body.flexy.locationId).toBe("loc_test_123");
    expect(res.body.flexy.hasStaffUser).toBe(true);
  });

  it("returns not_installed for a member without a Flexy instance", async () => {
    const res = await request(app)
      .get(`/api/admin/apps/flexy/lookup/${memberUser.id}`)
      .set("Cookie", signCookie(adminUser.id, adminUser.email));

    expect(res.status).toBe(200);
    expect(res.body.flexy.status).toBe("not_installed");
    expect(res.body.flexy.email).toBeNull();
    expect(res.body.flexy.locationId).toBeNull();
    expect(res.body.flexy.hasStaffUser).toBe(false);
  });

  it("returns 401 when there is no auth cookie at all", async () => {
    const res = await request(app).get(
      `/api/admin/apps/flexy/lookup/${installedMember.id}`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when called by a non-admin member", async () => {
    const res = await request(app)
      .get(`/api/admin/apps/flexy/lookup/${installedMember.id}`)
      .set("Cookie", signCookie(memberUser.id, memberUser.email));
    expect(res.status).toBe(403);
  });

  it("returns 404 for a userId that does not exist", async () => {
    const res = await request(app)
      .get(`/api/admin/apps/flexy/lookup/999999999`)
      .set("Cookie", signCookie(adminUser.id, adminUser.email));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 400 for a malformed userId", async () => {
    const res = await request(app)
      .get(`/api/admin/apps/flexy/lookup/not-a-number`)
      .set("Cookie", signCookie(adminUser.id, adminUser.email));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid user id/i);
  });
});

describe("POST /api/admin/apps/flexy/regenerate-password/:userId", () => {
  it("regenerates the password, calls the GHL client, and writes a regenerate_password audit log entry", async () => {
    const beforeMaxIdRows = await db
      .select({ id: sql<number>`COALESCE(MAX(${auditLogTable.id}), 0)` })
      .from(auditLogTable);
    const beforeMaxId = beforeMaxIdRows[0]?.id ?? 0;

    const res = await request(app)
      .post(`/api/admin/apps/flexy/regenerate-password/${installedMember.id}`)
      .set("Cookie", signCookie(adminUser.id, adminUser.email));

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(`${TEST_TAG}-flexy-staff@example.test`);
    expect(res.body.newPassword).toBe("MockedPassw0rd!");

    // Confirms we never hit the real GoHighLevel API.
    expect(updateStaffUserPasswordMock).toHaveBeenCalledTimes(1);
    expect(updateStaffUserPasswordMock).toHaveBeenCalledWith(
      "staff_test_123",
      "MockedPassw0rd!",
    );
    expect(generateRandomPasswordMock).toHaveBeenCalledTimes(1);

    // Audit-log entry must exist with the right action / actor / target.
    const newEntries = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actorId, adminUser.id),
          eq(auditLogTable.actionType, "regenerate_password"),
          eq(auditLogTable.entityType, "flexy_credentials"),
          eq(auditLogTable.entityId, String(installedMember.id)),
        ),
      )
      .orderBy(desc(auditLogTable.id))
      .limit(1);

    expect(newEntries.length).toBe(1);
    expect(newEntries[0].id).toBeGreaterThan(beforeMaxId);
    expect(newEntries[0].actorEmail).toBe(adminUser.email);
    expect(newEntries[0].description).toContain(installedMember.email);
  });

  it("returns 404 when called for a member who does not have Flexy installed", async () => {
    const res = await request(app)
      .post(`/api/admin/apps/flexy/regenerate-password/${memberUser.id}`)
      .set("Cookie", signCookie(adminUser.id, adminUser.email));
    expect(res.status).toBe(404);
    expect(updateStaffUserPasswordMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a userId that does not exist", async () => {
    const res = await request(app)
      .post(`/api/admin/apps/flexy/regenerate-password/999999999`)
      .set("Cookie", signCookie(adminUser.id, adminUser.email));
    expect(res.status).toBe(404);
    expect(updateStaffUserPasswordMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed userId", async () => {
    const res = await request(app)
      .post(`/api/admin/apps/flexy/regenerate-password/abc`)
      .set("Cookie", signCookie(adminUser.id, adminUser.email));
    expect(res.status).toBe(400);
    expect(updateStaffUserPasswordMock).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no auth cookie", async () => {
    const res = await request(app).post(
      `/api/admin/apps/flexy/regenerate-password/${installedMember.id}`,
    );
    expect(res.status).toBe(401);
    expect(updateStaffUserPasswordMock).not.toHaveBeenCalled();
  });

  it("returns 403 when called by a non-admin member", async () => {
    const res = await request(app)
      .post(`/api/admin/apps/flexy/regenerate-password/${installedMember.id}`)
      .set("Cookie", signCookie(memberUser.id, memberUser.email));
    expect(res.status).toBe(403);
    expect(updateStaffUserPasswordMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/apps/flexy/password-reset-history", () => {
  let historyAdmin: SeededUser;
  let historyOtherAdmin: SeededUser;
  let historyMember: SeededUser;

  beforeAll(async () => {
    historyAdmin = await insertUser("super_admin", "history-admin");
    historyOtherAdmin = await insertUser("super_admin", "history-other-admin");
    historyMember = await insertUser("member", "history-member");

    // Seed a regenerate event from historyAdmin
    await db.insert(auditLogTable).values({
      actorId: historyAdmin.id,
      actorEmail: historyAdmin.email,
      actionType: "regenerate_password",
      entityType: "flexy_credentials",
      entityId: String(historyMember.id),
      description: `Regenerated Flexy password for member ${historyMember.email}`,
      changeDiff: { memberId: historyMember.id, memberEmail: historyMember.email },
    });

    // Seed a notify event from historyOtherAdmin with channels payload
    await db.insert(auditLogTable).values({
      actorId: historyOtherAdmin.id,
      actorEmail: historyOtherAdmin.email,
      actionType: "notify_password",
      entityType: "flexy_credentials",
      entityId: String(historyMember.id),
      description: `Sent new Flexy password to member ${historyMember.email} via email=sent`,
      changeDiff: {
        memberId: historyMember.id,
        memberEmail: historyMember.email,
        channels: {
          email: { status: "sent" },
          sms: { status: "skipped", reason: "no_phone_on_file" },
        },
      },
    });

    // Unrelated audit row that must NOT be returned
    await db.insert(auditLogTable).values({
      actorId: historyAdmin.id,
      actorEmail: historyAdmin.email,
      actionType: "update",
      entityType: "user",
      entityId: String(historyMember.id),
      description: "Updated member profile",
    });
  });

  it("returns flexy_credentials reset events for a specific member", async () => {
    const res = await request(app)
      .get(`/api/admin/apps/flexy/password-reset-history?userId=${historyMember.id}`)
      .set("Cookie", signCookie(adminUser.id, adminUser.email));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
    const events = res.body.events as Array<{
      actionType: string;
      actorEmail: string | null;
      memberId: number | null;
      channels: unknown;
    }>;

    expect(events.length).toBe(2);
    for (const event of events) {
      expect(["regenerate_password", "notify_password"]).toContain(event.actionType);
      expect(event.memberId).toBe(historyMember.id);
    }

    const notify = events.find((e) => e.actionType === "notify_password");
    expect(notify).toBeDefined();
    expect(notify!.channels).toEqual({
      email: { status: "sent" },
      sms: { status: "skipped", reason: "no_phone_on_file" },
    });

    // Plaintext password must never be exposed by this endpoint.
    expect(JSON.stringify(res.body)).not.toContain("MockedPassw0rd");
    expect(JSON.stringify(res.body)).not.toMatch(/"password"/i);
  });

  it("can be filtered by initiator email", async () => {
    const res = await request(app)
      .get(
        `/api/admin/apps/flexy/password-reset-history?userId=${historyMember.id}&actorEmail=${encodeURIComponent(historyOtherAdmin.email)}`,
      )
      .set("Cookie", signCookie(adminUser.id, adminUser.email));

    expect(res.status).toBe(200);
    const events = res.body.events as Array<{ actorEmail: string | null; actionType: string }>;
    expect(events.length).toBe(1);
    expect(events[0].actionType).toBe("notify_password");
    expect(events[0].actorEmail).toBe(historyOtherAdmin.email);
  });

  it("returns no events for a member who has never had a reset", async () => {
    const res = await request(app)
      .get(`/api/admin/apps/flexy/password-reset-history?userId=${memberUser.id}`)
      .set("Cookie", signCookie(adminUser.id, adminUser.email));

    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
  });

  it("returns 400 for a malformed userId", async () => {
    const res = await request(app)
      .get(`/api/admin/apps/flexy/password-reset-history?userId=not-a-number`)
      .set("Cookie", signCookie(adminUser.id, adminUser.email));
    expect(res.status).toBe(400);
  });

  it("returns 401 without an auth cookie", async () => {
    const res = await request(app).get(
      `/api/admin/apps/flexy/password-reset-history?userId=${historyMember.id}`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when called by a non-admin member", async () => {
    const res = await request(app)
      .get(`/api/admin/apps/flexy/password-reset-history?userId=${historyMember.id}`)
      .set("Cookie", signCookie(memberUser.id, memberUser.email));
    expect(res.status).toBe(403);
  });
});
