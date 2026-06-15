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

// Toggle the result of `members:pii` checks at runtime so the
// reset-history endpoint can be exercised on both the unredacted
// (admin with PII) and redacted (admin without PII) paths without
// inventing a new role. Other permission checks keep their real
// behavior so requirePermission middleware still authorizes apps:support.
const piiState = vi.hoisted(() => ({ allowPii: true }));

vi.mock("@workspace/auth", async () => {
  const actual =
    await vi.importActual<typeof import("@workspace/auth")>("@workspace/auth");
  return {
    ...actual,
    hasPermission: (role: unknown, perm: unknown) => {
      if (perm === "members:pii" && !piiState.allowPii) return false;
      return actual.hasPermission(role as never, perm as never);
    },
  };
});

const {
  queueEmailMock,
  queueSmsMock,
  sendEmailNowMock,
  sendSmsNowMock,
} = vi.hoisted(() => ({
  queueEmailMock: vi.fn(async (..._args: any[]): Promise<{ result: string; reason?: string }> => ({ result: "queued" })),
  queueSmsMock: vi.fn(async (..._args: any[]): Promise<{ result: string; reason?: string }> => ({ result: "queued" })),
  sendEmailNowMock: vi.fn(async (..._args: any[]) => ({ success: true })),
  sendSmsNowMock: vi.fn(async (..._args: any[]) => ({ success: true })),
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

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    queueEmail: queueEmailMock,
    queueSms: queueSmsMock,
    sendEmailNow: sendEmailNowMock,
    sendSmsNow: sendSmsNowMock,
  },
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
  queueEmailMock.mockClear();
  queueEmailMock.mockResolvedValue({ result: "queued" as const });
  queueSmsMock.mockClear();
  queueSmsMock.mockResolvedValue({ result: "queued" as const });
  sendEmailNowMock.mockClear();
  sendSmsNowMock.mockClear();
  // Default to "viewer has members:pii" so existing tests see the
  // unredacted shape; PII-gated tests opt in to false.
  piiState.allowPii = true;
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

  it("fails loudly with HTTP 500 if duplicate flexy rows exist for one member, instead of silently returning an arbitrary row", async () => {
    // Seed an extra member who'll have two flexy rows. We deliberately
    // bypass the (user_id, app_name) UNIQUE constraint so we can simulate
    // the historical bug. The test restores the constraint and cleans up
    // even if the assertion fails.
    const dupMember = await insertUser("member", "dup");
    try {
      await db.execute(
        sql`ALTER TABLE member_app_instances DROP CONSTRAINT member_app_instances_user_app_unique`,
      );
      try {
        await db.insert(memberAppInstancesTable).values([
          {
            userId: dupMember.id,
            appName: "flexy",
            status: "not_installed",
          },
          {
            userId: dupMember.id,
            appName: "flexy",
            status: "installed",
            providerLocationId: "loc_dup_real",
            providerStaffUserId: "staff_dup_real",
            providerStaffEmail: `${TEST_TAG}-dup-real@example.test`,
          },
        ]);

        const res = await request(app)
          .get(`/api/admin/apps/flexy/lookup/${dupMember.id}`)
          .set("Cookie", signCookie(adminUser.id, adminUser.email));

        expect(res.status).toBe(500);
        expect(res.body.error).toMatch(/failed to look up/i);
      } finally {
        await db
          .delete(memberAppInstancesTable)
          .where(eq(memberAppInstancesTable.userId, dupMember.id));
      }
    } finally {
      await db.execute(
        sql`ALTER TABLE member_app_instances ADD CONSTRAINT member_app_instances_user_app_unique UNIQUE (user_id, app_name)`,
      );
    }
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

  // Notification flow: confirms we go through the standard queue path
  // (queueEmail / queueSms) and never the direct sendEmailNow / sendSmsNow
  // path, and that the per-channel response shape the admin UI consumes
  // is preserved.
  describe("notification flow", () => {
    let smsMember: SeededUser;

    beforeAll(async () => {
      smsMember = await insertUser("member", "sms-member");
      await db
        .update(usersTable)
        .set({ phone: "+15555550199", smsOptIn: true })
        .where(eq(usersTable.id, smsMember.id));
      await db.insert(memberAppInstancesTable).values({
        userId: smsMember.id,
        appName: "flexy",
        status: "installed",
        providerLocationId: "loc_test_456",
        providerStaffUserId: "staff_test_456",
        providerStaffEmail: `${TEST_TAG}-flexy-staff-sms@example.test`,
      });
    });

    it("queues the email via queueEmail (not sendEmailNow) and reports status=sent when the queue accepts the job", async () => {
      const res = await request(app)
        .post(`/api/admin/apps/flexy/regenerate-password/${installedMember.id}`)
        .set("Cookie", signCookie(adminUser.id, adminUser.email))
        .send({ notifyEmail: true });

      expect(res.status).toBe(200);
      expect(queueEmailMock).toHaveBeenCalledTimes(1);
      expect(sendEmailNowMock).not.toHaveBeenCalled();

      const call = queueEmailMock.mock.calls[0]?.[0] as
        | { templateSlug: string; to: string; userId: number; category: string }
        | undefined;
      expect(call?.templateSlug).toBe("flexy_password_reset");
      expect(call?.to).toBe(installedMember.email);
      expect(call?.userId).toBe(installedMember.id);
      expect(call?.category).toBe("transactional");

      expect(res.body.notifications.email).toEqual({
        requested: true,
        status: "sent",
      });
    });

    it("queues the SMS via queueSms (not sendSmsNow) when the member is opted in, and reports status=sent", async () => {
      const res = await request(app)
        .post(`/api/admin/apps/flexy/regenerate-password/${smsMember.id}`)
        .set("Cookie", signCookie(adminUser.id, adminUser.email))
        .send({ notifySms: true });

      expect(res.status).toBe(200);
      expect(queueSmsMock).toHaveBeenCalledTimes(1);
      expect(sendSmsNowMock).not.toHaveBeenCalled();

      const call = queueSmsMock.mock.calls[0]?.[0] as
        | { templateSlug: string; to: string; userId: number }
        | undefined;
      expect(call?.templateSlug).toBe("flexy_password_reset");
      expect(call?.to).toBe("+15555550199");
      expect(call?.userId).toBe(smsMember.id);

      expect(res.body.notifications.sms).toEqual({
        requested: true,
        status: "sent",
      });
    });

    it("reports status=sent when the queue is offline and the direct fallback succeeds (sent_direct outcome)", async () => {
      queueEmailMock.mockResolvedValueOnce({ result: "sent_direct" as const });

      const res = await request(app)
        .post(`/api/admin/apps/flexy/regenerate-password/${installedMember.id}`)
        .set("Cookie", signCookie(adminUser.id, adminUser.email))
        .send({ notifyEmail: true });

      expect(res.status).toBe(200);
      expect(res.body.notifications.email.status).toBe("sent");
    });

    it("maps a 'skipped' outcome to status=skipped with the reason preserved", async () => {
      queueEmailMock.mockResolvedValueOnce({
        result: "skipped" as const,
        reason: "provider_not_configured",
      });

      const res = await request(app)
        .post(`/api/admin/apps/flexy/regenerate-password/${installedMember.id}`)
        .set("Cookie", signCookie(adminUser.id, adminUser.email))
        .send({ notifyEmail: true });

      expect(res.status).toBe(200);
      expect(res.body.notifications.email).toEqual({
        requested: true,
        status: "skipped",
        reason: "provider_not_configured",
      });
    });

    it("maps a 'failed' outcome to status=failed with the reason preserved", async () => {
      queueEmailMock.mockResolvedValueOnce({
        result: "failed" as const,
        reason: "sendgrid_503",
      });

      const res = await request(app)
        .post(`/api/admin/apps/flexy/regenerate-password/${installedMember.id}`)
        .set("Cookie", signCookie(adminUser.id, adminUser.email))
        .send({ notifyEmail: true });

      expect(res.status).toBe(200);
      expect(res.body.notifications.email).toEqual({
        requested: true,
        status: "failed",
        reason: "sendgrid_503",
      });
    });

    it("does not call queueSms when the member has no phone on file (skipped without touching the queue)", async () => {
      const res = await request(app)
        .post(`/api/admin/apps/flexy/regenerate-password/${installedMember.id}`)
        .set("Cookie", signCookie(adminUser.id, adminUser.email))
        .send({ notifySms: true });

      expect(res.status).toBe(200);
      expect(queueSmsMock).not.toHaveBeenCalled();
      expect(res.body.notifications.sms).toEqual({
        requested: true,
        status: "skipped",
        reason: "no_phone_on_file",
      });
    });

    it("does not call queueSms when the member opted out of the account & security SMS category, even with master SMS on (skipped: category_opted_out)", async () => {
      const securityOptOut = await insertUser("member", "sms-security-optout");
      await db
        .update(usersTable)
        .set({ phone: "+15555550200", smsOptIn: true, securitySmsOptIn: false })
        .where(eq(usersTable.id, securityOptOut.id));
      await db.insert(memberAppInstancesTable).values({
        userId: securityOptOut.id,
        appName: "flexy",
        status: "installed",
        providerLocationId: "loc_test_789",
        providerStaffUserId: "staff_test_789",
        providerStaffEmail: `${TEST_TAG}-flexy-staff-security-optout@example.test`,
      });

      const res = await request(app)
        .post(`/api/admin/apps/flexy/regenerate-password/${securityOptOut.id}`)
        .set("Cookie", signCookie(adminUser.id, adminUser.email))
        .send({ notifySms: true });

      expect(res.status).toBe(200);
      expect(queueSmsMock).not.toHaveBeenCalled();
      expect(res.body.notifications.sms).toEqual({
        requested: true,
        status: "skipped",
        reason: "category_opted_out",
      });
    });
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

  // PII redaction: this endpoint reads the same audit rows the main audit
  // log does, so it must respect the same `members:pii` gate. Otherwise an
  // apps:support-only role (granted without `members:pii`) would still see
  // the member's email in the structured `memberEmail` field and embedded
  // in the description template.
  describe("members:pii redaction", () => {
    it("returns memberEmail and the raw description when the viewer has members:pii", async () => {
      piiState.allowPii = true;

      const res = await request(app)
        .get(`/api/admin/apps/flexy/password-reset-history?userId=${historyMember.id}`)
        .set("Cookie", signCookie(adminUser.id, adminUser.email));

      expect(res.status).toBe(200);
      const events = res.body.events as Array<{
        actionType: string;
        memberEmail: string | null;
        description: string;
      }>;
      expect(events.length).toBe(2);
      for (const event of events) {
        expect(event.memberEmail).toBe(historyMember.email);
        expect(event.description).toContain(historyMember.email);
      }
    });

    it("nulls out memberEmail and scrubs the description when the viewer lacks members:pii", async () => {
      piiState.allowPii = false;

      const res = await request(app)
        .get(`/api/admin/apps/flexy/password-reset-history?userId=${historyMember.id}`)
        .set("Cookie", signCookie(adminUser.id, adminUser.email));

      expect(res.status).toBe(200);
      const events = res.body.events as Array<{
        actionType: string;
        memberEmail: string | null;
        description: string;
        channels: unknown;
      }>;
      expect(events.length).toBe(2);

      // The member's email must not leak anywhere in the response body.
      expect(JSON.stringify(res.body)).not.toContain(historyMember.email);

      for (const event of events) {
        expect(event.memberEmail).toBeNull();
        expect(event.description).not.toContain(historyMember.email);
        expect(event.description).toContain("redacted");
      }

      const regen = events.find((e) => e.actionType === "regenerate_password");
      expect(regen?.description).toBe(
        "Regenerated Flexy password for member redacted",
      );

      const notify = events.find((e) => e.actionType === "notify_password");
      expect(notify?.description).toBe(
        "Sent new Flexy password to member redacted via email=sent",
      );
      // Non-PII fields the UI still renders must survive the scrub.
      expect(notify?.channels).toEqual({
        email: { status: "sent" },
        sms: { status: "skipped", reason: "no_phone_on_file" },
      });
    });
  });
});
