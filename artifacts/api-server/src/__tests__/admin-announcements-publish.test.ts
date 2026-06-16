import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, announcementsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// processNewContentAlerts fans out to BOTH queueEmail and queueSms
// (Redis-backed) plus a Postgres-backed dedup helper. We mock all of them so
// the scan exercises ONLY the channel-routing decisions without touching Redis:
//   - EMAIL: sent to every member (role=member), independent of SMS prefs
//     (email opt-out is handled by the suppression list, not contentSmsOptIn)
//   - SMS: gated on smsOptIn && contentSmsOptIn && phone
// checkAndRecordSend is backed by a real in-memory Set keyed on sendKey so the
// per-member-per-announcement dedup across repeated runs is exercised for real;
// the Set is cleared in beforeEach. These mocks do NOT affect the announcements
// router (it imports none of them), so the POST route is exercised end-to-end
// against the real DB.
const { queueSmsMock, queueEmailMock, sentKeys, checkAndRecordSendMock } =
  vi.hoisted(() => {
    const sentKeys = new Set<string>();
    return {
      sentKeys,
      queueSmsMock: vi.fn(async (..._args: any[]) => ({ result: "queued" as const })),
      queueEmailMock: vi.fn(async (..._args: any[]) => ({ result: "queued" as const })),
      checkAndRecordSendMock: vi.fn(async (sendKey: string, _channel: string) => {
        if (sentKeys.has(sendKey)) return false;
        sentKeys.add(sendKey);
        return true;
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
  isRedisConnected: async () => false,
  QUEUE_REDIS_OPTIONS: {},
  makeThrottledRedisErrorLogger: () => () => undefined,
}));

import announcementsRouter from "../routes/announcements";
import { processNewContentAlerts } from "../lib/scheduled-comms";
import { buildTestAppWithRouters } from "./test-app";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `ann-pub-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
// Announcements created during the suite (via the route or directly) so the
// 24h content-alert scan only ever sees this test's rows. Cleaned up in afterAll.
const seededAnnouncementIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;

// communications:manage (required by POST /admin/announcements) is granted to
// super_admin + admin only. We seed one allowed role, one admin role that
// lacks it, and a plain member to prove the gate end-to-end.
let superAdminCookie = "";
let supportAgentCookie = "";
let memberCookie = "";

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function seedUser(
  suffix: string,
  role: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: number; cookie: string }> {
  const email = `${TAG}-${suffix}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test ${suffix}`,
      passwordHash,
      role: role as never,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
      ...extra,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, cookie: signCookie(row.id, email) };
}

// --- Content cohort for the scan (all role=member -> all get the EMAIL) ---
let contentOptedIn = 0; // smsOptIn + contentSmsOptIn + phone -> SHOULD text + email
let contentCategoryOff = 0; // contentSmsOptIn=false -> SMS skipped, email still sent
let contentMasterOff = 0; // smsOptIn=false -> SMS skipped, email still sent
let contentNoPhone = 0; // phone=null -> SMS skipped, email still sent

beforeAll(async () => {
  app = buildTestAppWithRouters([announcementsRouter]);

  superAdminCookie = (await seedUser("superadmin", "super_admin")).cookie;
  supportAgentCookie = (await seedUser("support", "support_agent")).cookie;
  memberCookie = (await seedUser("member", "member")).cookie;

  contentOptedIn = (
    await seedUser("content-yes", "member", {
      phone: "+15555550601",
      smsOptIn: true,
      contentSmsOptIn: true,
    })
  ).id;
  contentCategoryOff = (
    await seedUser("content-cat-off", "member", {
      phone: "+15555550602",
      smsOptIn: true,
      contentSmsOptIn: false,
    })
  ).id;
  contentMasterOff = (
    await seedUser("content-master-off", "member", {
      phone: "+15555550603",
      smsOptIn: false,
      contentSmsOptIn: true,
    })
  ).id;
  contentNoPhone = (
    await seedUser("content-no-phone", "member", {
      phone: null,
      smsOptIn: true,
      contentSmsOptIn: true,
    })
  ).id;
});

afterAll(async () => {
  if (seededAnnouncementIds.length > 0) {
    await db
      .delete(announcementsTable)
      .where(inArray(announcementsTable.id, seededAnnouncementIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  queueSmsMock.mockClear();
  queueEmailMock.mockClear();
  checkAndRecordSendMock.mockClear();
  sentKeys.clear();
});

describe("POST /admin/announcements — auth + permission gate", () => {
  it("requires authentication (no cookie -> 401)", async () => {
    const res = await request(app)
      .post("/api/admin/announcements")
      .send({ title: "x", body: "y" });
    expect(res.status).toBe(401);
  });

  it("rejects a plain member with 403", async () => {
    const res = await request(app)
      .post("/api/admin/announcements")
      .set("Cookie", memberCookie)
      .send({ title: "x", body: "y" });
    expect(res.status).toBe(403);
  });

  it("rejects an admin role lacking communications:manage (support_agent) with 403", async () => {
    const res = await request(app)
      .post("/api/admin/announcements")
      .set("Cookie", supportAgentCookie)
      .send({ title: "x", body: "y" });
    expect(res.status).toBe(403);
  });
});

describe("POST /admin/announcements — validation", () => {
  it("rejects an empty body with 400 (no row inserted)", async () => {
    const res = await request(app)
      .post("/api/admin/announcements")
      .set("Cookie", superAdminCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it("rejects a missing body field with 400", async () => {
    const res = await request(app)
      .post("/api/admin/announcements")
      .set("Cookie", superAdminCookie)
      .send({ title: "Has a title" });
    expect(res.status).toBe(400);
  });

  it("rejects whitespace-only title/body with 400 (trimmed to empty)", async () => {
    const res = await request(app)
      .post("/api/admin/announcements")
      .set("Cookie", superAdminCookie)
      .send({ title: "   ", body: "   " });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid type enum with 400", async () => {
    const res = await request(app)
      .post("/api/admin/announcements")
      .set("Cookie", superAdminCookie)
      .send({ title: "T", body: "B", type: "not-a-real-type" });
    expect(res.status).toBe(400);
  });
});

describe("POST /admin/announcements — insert", () => {
  it("inserts a row for a permitted admin and returns 201 with the persisted record", async () => {
    const title = `${TAG} general post`;
    const body = "Body of the general announcement";
    const res = await request(app)
      .post("/api/admin/announcements")
      .set("Cookie", superAdminCookie)
      .send({ title, body });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title, body });
    expect(typeof res.body.id).toBe("number");
    // No explicit type -> schema default "general".
    expect(res.body.type).toBe("general");
    seededAnnouncementIds.push(res.body.id);

    const [persisted] = await db
      .select()
      .from(announcementsTable)
      .where(eq(announcementsTable.id, res.body.id));
    expect(persisted).toBeDefined();
    expect(persisted.title).toBe(title);
    expect(persisted.body).toBe(body);
  });

  it("trims surrounding whitespace before persisting", async () => {
    const res = await request(app)
      .post("/api/admin/announcements")
      .set("Cookie", superAdminCookie)
      .send({ title: `  ${TAG} trimmed  `, body: "  padded body  " });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe(`${TAG} trimmed`);
    expect(res.body.body).toBe("padded body");
    seededAnnouncementIds.push(res.body.id);
  });

  it("persists an explicit type ('new_content')", async () => {
    const res = await request(app)
      .post("/api/admin/announcements")
      .set("Cookie", superAdminCookie)
      .send({ title: `${TAG} typed`, body: "B", type: "new_content" });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe("new_content");
    seededAnnouncementIds.push(res.body.id);
  });
});

// Filter queued SMS by recipient AND announcement title so the assertions stay
// robust even if unrelated new_content announcements exist in the shared DB.
function contentSmsFor(userId: number, contentTitle: string) {
  return queueSmsMock.mock.calls.filter((c: unknown[]) => {
    const arg = c[0] as {
      templateSlug: string;
      userId: number;
      variables?: { content_title?: string };
    };
    return (
      arg.templateSlug === "new_content_alert" &&
      arg.userId === userId &&
      arg.variables?.content_title === contentTitle
    );
  });
}

// Matches queued emails by recipient + announcement title so assertions stay
// robust even if unrelated new_content announcements exist in the shared DB.
function contentEmailFor(userId: number, contentTitle: string) {
  return queueEmailMock.mock.calls.filter((c: unknown[]) => {
    const arg = c[0] as {
      templateSlug: string;
      userId: number;
      variables?: { content_title?: string };
    };
    return (
      arg.templateSlug === "new_content_alert" &&
      arg.userId === userId &&
      arg.variables?.content_title === contentTitle
    );
  });
}

async function publishNewContent(title: string, body: string): Promise<number> {
  const res = await request(app)
    .post("/api/admin/announcements")
    .set("Cookie", superAdminCookie)
    .send({ title, body, type: "new_content" });
  expect(res.status).toBe(201);
  seededAnnouncementIds.push(res.body.id);
  return res.body.id as number;
}

describe("processNewContentAlerts — SMS gating for a freshly published announcement", () => {
  it("texts only the fully-eligible member (smsOptIn + contentSmsOptIn + phone); skips category-off, master-off, and no-phone", async () => {
    const title = `${TAG} fresh content drop`;
    await publishNewContent(title, "A new lesson is live");

    await processNewContentAlerts();

    const texted = contentSmsFor(contentOptedIn, title);
    expect(texted).toHaveLength(1);
    expect(texted[0][0]).toMatchObject({
      templateSlug: "new_content_alert",
      to: "+15555550601",
      userId: contentOptedIn,
      variables: { content_title: title },
    });

    // Every other SMS gate must suppress the text.
    expect(contentSmsFor(contentCategoryOff, title)).toHaveLength(0); // category off
    expect(contentSmsFor(contentMasterOff, title)).toHaveLength(0); // master off
    expect(contentSmsFor(contentNoPhone, title)).toHaveLength(0); // no phone
  });
});

describe("processNewContentAlerts — email goes to every member regardless of SMS prefs", () => {
  it("emails the opted-in member AND members who have SMS off / no phone (email is not gated by the SMS toggles)", async () => {
    const title = `${TAG} email content drop`;
    await publishNewContent(title, "A new lesson is live");

    await processNewContentAlerts();

    // All four seeded members are role=member, so each gets exactly one email
    // for this announcement, independent of their SMS preferences.
    for (const userId of [
      contentOptedIn,
      contentCategoryOff,
      contentMasterOff,
      contentNoPhone,
    ]) {
      expect(contentEmailFor(userId, title)).toHaveLength(1);
    }

    // The email payload carries the announcement title (sanity-check the slug
    // + variables on the category-off member who would NOT get an SMS).
    const emailed = contentEmailFor(contentCategoryOff, title);
    expect(emailed[0][0]).toMatchObject({
      templateSlug: "new_content_alert",
      variables: { content_title: title },
    });
  });
});

describe("processNewContentAlerts — dedupe across repeated scheduler runs", () => {
  it("sends each eligible member at most one email and one SMS per announcement across two passes", async () => {
    const announcementId = await publishNewContent(
      `${TAG} dedupe content drop`,
      "Another lesson is live",
    );
    const title = `${TAG} dedupe content drop`;

    // Two passes simulate the 15-minute scheduler firing twice while the
    // announcement is still inside the 24h window. The Set-backed dedup mock
    // must suppress the second send on both channels.
    await processNewContentAlerts();
    await processNewContentAlerts();

    expect(contentSmsFor(contentOptedIn, title)).toHaveLength(1);
    expect(contentEmailFor(contentOptedIn, title)).toHaveLength(1);

    // Dedup keys are per-channel + per-member + per-announcement.
    expect(sentKeys.has(`content_alert_sms_${announcementId}_${contentOptedIn}`)).toBe(true);
    expect(sentKeys.has(`content_alert_email_${announcementId}_${contentOptedIn}`)).toBe(true);
  });
});
