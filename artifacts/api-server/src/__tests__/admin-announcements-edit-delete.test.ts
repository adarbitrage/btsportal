import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, announcementsTable, auditLogTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// The announcements PUT/DELETE handlers only touch Postgres, but the test app's
// auth middleware (and anything it transitively pulls in) expects a redis
// module to exist. The scheduled-comms path additionally fans out to
// queueSms/queueEmail + a Postgres-backed dedup helper. We mock all three so
// the test never touches Redis and so the per-announcement SMS dedup is
// exercised against a real in-memory Set keyed on the sendKey. The mock mirrors
// the production `checkAndRecordSend` contract: it returns the string outcome
// "recorded" the first time a key is seen and "duplicate" on every repeat (never
// "error" here) — reserveSend only proceeds when the outcome is exactly
// "recorded".
const { queueSmsMock, queueEmailMock, sentKeys, sentChannels, checkAndRecordSendMock } =
  vi.hoisted(() => {
    const sentKeys = new Set<string>();
    const sentChannels: Array<{ sendKey: string; channel: string }> = [];
    return {
      sentKeys,
      sentChannels,
      queueSmsMock: vi.fn(async (..._args: any[]) => ({ result: "queued" as const })),
      queueEmailMock: vi.fn(async (..._args: any[]) => ({ result: "queued" as const })),
      checkAndRecordSendMock: vi.fn(async (sendKey: string, channel: string) => {
        sentChannels.push({ sendKey, channel });
        if (sentKeys.has(sendKey)) return "duplicate" as const;
        sentKeys.add(sendKey);
        return "recorded" as const;
      }),
    };
  });

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    queueEmail: queueEmailMock,
    queueSms: queueSmsMock,
  },
}));

vi.mock("../lib/comms-dedup", () => ({
  checkAndRecordSend: checkAndRecordSendMock,
  wasSent: vi.fn(async () => false),
}));

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: async () => false,
  QUEUE_REDIS_OPTIONS: {},
  makeThrottledRedisErrorLogger: () => () => undefined,
}));

import { buildTestAppWithRouters } from "./test-app";
import announcementsRouter from "../routes/announcements";
import { processNewContentAlerts } from "../lib/scheduled-comms";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `ann-edit-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededAnnouncementIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let memberCookie: string;
let contentMemberId = 0;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(
  role: string,
  suffix: string,
  prefs: { phone?: string | null; smsOptIn?: boolean; contentSmsOptIn?: boolean } = {},
): Promise<{ id: number; email: string }> {
  const email = `${TAG}-${suffix}@example.test`;
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
      phone: prefs.phone ?? null,
      smsOptIn: prefs.smsOptIn ?? false,
      contentSmsOptIn: prefs.contentSmsOptIn ?? false,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email };
}

async function seedAnnouncement(
  title: string,
  body: string,
  type: "new_content" | "event" | "milestone" | "general",
): Promise<number> {
  const [row] = await db
    .insert(announcementsTable)
    .values({ title, body, type })
    .returning({ id: announcementsTable.id });
  seededAnnouncementIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([announcementsRouter]);

  const admin = await insertUser("super_admin", "admin");
  const member = await insertUser("member", "non-admin");
  adminCookie = signCookie(admin.id, admin.email);
  memberCookie = signCookie(member.id, member.email);

  // A content-eligible member: master SMS on + content category on + phone.
  const contentMember = await insertUser("member", "content-yes", {
    phone: "+15555559901",
    smsOptIn: true,
    contentSmsOptIn: true,
  });
  contentMemberId = contentMember.id;
});

afterAll(async () => {
  if (seededAnnouncementIds.length > 0) {
    await db
      .delete(announcementsTable)
      .where(inArray(announcementsTable.id, seededAnnouncementIds));
  }
  // The PUT/DELETE handlers write audit_log rows (logAdminAction) keyed to the
  // admin actor, so those rows must be cleared before the users they reference
  // can be deleted (FK: audit_log_actor_id_users_id_fk).
  if (seededUserIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  queueSmsMock.mockClear();
  queueEmailMock.mockClear();
  checkAndRecordSendMock.mockClear();
  sentKeys.clear();
  sentChannels.length = 0;
});

describe("PUT/DELETE /admin/announcements/:id — RBAC + CRUD", () => {
  it("edits an announcement: updates title/body/type and returns 200", async () => {
    const id = await seedAnnouncement(`${TAG} original`, "original body", "general");

    const res = await request(app)
      .put(`/api/admin/announcements/${id}`)
      .set("Cookie", adminCookie)
      .send({ title: `${TAG} edited`, body: "edited body", type: "event" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id,
      title: `${TAG} edited`,
      body: "edited body",
      type: "event",
    });

    const [row] = await db
      .select()
      .from(announcementsTable)
      .where(eq(announcementsTable.id, id));
    expect(row.title).toBe(`${TAG} edited`);
    expect(row.body).toBe("edited body");
    expect(row.type).toBe("event");
  });

  it("deletes an announcement and returns 204", async () => {
    const id = await seedAnnouncement(`${TAG} to-delete`, "delete me", "general");

    const res = await request(app)
      .delete(`/api/admin/announcements/${id}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(204);

    const rows = await db
      .select()
      .from(announcementsTable)
      .where(eq(announcementsTable.id, id));
    expect(rows).toHaveLength(0);
  });

  it("returns 404 when editing a missing id", async () => {
    // Create then delete a row so we have an id guaranteed not to collide with
    // any live announcement in the shared dev DB.
    const missingId = await seedAnnouncement(`${TAG} gone-edit`, "gone", "general");
    await db.delete(announcementsTable).where(eq(announcementsTable.id, missingId));

    const res = await request(app)
      .put(`/api/admin/announcements/${missingId}`)
      .set("Cookie", adminCookie)
      .send({ title: "x", body: "y", type: "general" });

    expect(res.status).toBe(404);
  });

  it("returns 404 when deleting a missing id", async () => {
    const missingId = await seedAnnouncement(`${TAG} gone-delete`, "gone", "general");
    await db.delete(announcementsTable).where(eq(announcementsTable.id, missingId));

    const res = await request(app)
      .delete(`/api/admin/announcements/${missingId}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(404);
  });

  it("requires communications:manage: a non-admin member is rejected with 403 on edit", async () => {
    const id = await seedAnnouncement(`${TAG} rbac-edit`, "body", "general");

    const res = await request(app)
      .put(`/api/admin/announcements/${id}`)
      .set("Cookie", memberCookie)
      .send({ title: "hacked", body: "hacked", type: "general" });

    expect(res.status).toBe(403);

    // Row must be untouched.
    const [row] = await db
      .select()
      .from(announcementsTable)
      .where(eq(announcementsTable.id, id));
    expect(row.title).toBe(`${TAG} rbac-edit`);
  });

  it("requires communications:manage: a non-admin member is rejected with 403 on delete", async () => {
    const id = await seedAnnouncement(`${TAG} rbac-delete`, "body", "general");

    const res = await request(app)
      .delete(`/api/admin/announcements/${id}`)
      .set("Cookie", memberCookie);

    expect(res.status).toBe(403);

    // Row must still exist.
    const rows = await db
      .select()
      .from(announcementsTable)
      .where(eq(announcementsTable.id, id));
    expect(rows).toHaveLength(1);
  });
});

describe("editing a new_content announcement preserves the SMS dedup key", () => {
  it("does NOT re-text an already-texted member after an edit (id-keyed dedup survives)", async () => {
    const id = await seedAnnouncement(`${TAG} new lesson`, "a fresh lesson is live", "new_content");

    // First scheduler pass: the eligible member is texted exactly once and the
    // per-member-per-announcement dedup key is recorded.
    await processNewContentAlerts();

    // Scope the count to THIS announcement via its uniquely-tagged title — the
    // seeded member matches the global content-SMS recipient query, so any other
    // recent new_content announcement in the shared dev DB would also text them.
    const firstPass = queueSmsMock.mock.calls.filter((c: unknown[]) => {
      const arg = c[0] as {
        templateSlug: string;
        userId: number;
        variables?: { content_title?: string };
      };
      return (
        arg.templateSlug === "new_content_alert" &&
        arg.userId === contentMemberId &&
        arg.variables?.content_title?.startsWith(`${TAG} new lesson`) === true
      );
    });
    expect(firstPass).toHaveLength(1);

    const expectedKey = `content_alert_sms_${id}_${contentMemberId}`;
    expect(sentKeys.has(expectedKey)).toBe(true);

    // Admin edits the announcement (title + body change) but it stays
    // new_content. The PUT route preserves the announcement id.
    const editRes = await request(app)
      .put(`/api/admin/announcements/${id}`)
      .set("Cookie", adminCookie)
      .send({ title: `${TAG} new lesson (fixed typo)`, body: "a fresh lesson is live now", type: "new_content" });
    expect(editRes.status).toBe(200);
    expect(editRes.body.id).toBe(id);

    // Second scheduler pass after the edit: because the dedup key is keyed on
    // the (unchanged) announcement id, the already-texted member is suppressed.
    await processNewContentAlerts();

    const totalForMember = queueSmsMock.mock.calls.filter((c: unknown[]) => {
      const arg = c[0] as {
        templateSlug: string;
        userId: number;
        variables?: { content_title?: string };
      };
      return (
        arg.templateSlug === "new_content_alert" &&
        arg.userId === contentMemberId &&
        arg.variables?.content_title?.startsWith(`${TAG} new lesson`) === true
      );
    });
    expect(totalForMember).toHaveLength(1);

    // The dedup key used after the edit is the SAME id-keyed key, never a new one.
    const smsKeysForMember = sentChannels.filter(
      (c) => c.channel === "sms" && c.sendKey.endsWith(`_${contentMemberId}`),
    );
    expect(smsKeysForMember.every((c) => c.sendKey === expectedKey)).toBe(true);
  });
});
