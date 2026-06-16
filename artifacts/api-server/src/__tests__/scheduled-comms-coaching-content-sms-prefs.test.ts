import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  coachesTable,
  coachingCallsTable,
  announcementsTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

// The scheduled-comms handlers fan out to queueSms (Redis-backed) and a
// Postgres-backed dedup helper. We mock both so the test exercises ONLY the
// per-category gating decision the recipient queries make
// (entitlement && smsOptIn && coachingSmsOptIn + phone for coaching,
// smsOptIn && contentSmsOptIn + phone for content) and never touches Redis.
//
// checkAndRecordSend is backed by a real in-memory Set keyed on the sendKey so
// the per-member-per-announcement dedup is exercised for real: the second pass
// over the same announcement must suppress the duplicate. The Set is cleared in
// beforeEach so each test starts fresh.
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

import {
  processCoachingCallReminders,
  processNewContentAlerts,
} from "../lib/scheduled-comms";

const TAG = `sched-sms-${randomUUID().slice(0, 8)}`;
// Unique entitlement so the coaching recipient query matches ONLY this test's
// seeded products, isolating it from any other coaching data in the shared DB.
const ENTITLEMENT = `coaching:test-${TAG}`;
const OTHER_ENTITLEMENT = `coaching:other-${TAG}`;

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
let seededCoachId = 0;
let seededCallId = 0;
let seeded24hCallId = 0;
let seededAnnouncementId = 0;

interface SmsPrefs {
  smsOptIn: boolean;
  coachingSmsOptIn: boolean;
  contentSmsOptIn: boolean;
  phone: string | null;
}

interface SeedOpts {
  // null = grant no product at all; otherwise grant a product carrying this
  // entitlement key. Defaults to the test's own ENTITLEMENT.
  entitlement?: string | null;
}

async function seedMember(
  suffix: string,
  prefs: SmsPrefs,
  opts: SeedOpts = {},
): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-${suffix}@example.test`,
      name: `Test ${suffix}`,
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
      phone: prefs.phone,
      smsOptIn: prefs.smsOptIn,
      coachingSmsOptIn: prefs.coachingSmsOptIn,
      contentSmsOptIn: prefs.contentSmsOptIn,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(user.id);

  const entitlement = opts.entitlement === undefined ? ENTITLEMENT : opts.entitlement;
  if (entitlement !== null) {
    const [product] = await db
      .insert(productsTable)
      .values({
        slug: `${TAG}-product-${suffix}`,
        name: `${suffix} test product`,
        type: "backend",
        entitlementKeys: [entitlement] as unknown as string[],
        sortOrder: 99,
      })
      .returning({ id: productsTable.id });
    seededProductIds.push(product.id);

    await db.insert(userProductsTable).values({
      userId: user.id,
      productId: product.id,
      status: "active",
    });
  }

  return user.id;
}

function smsCallsFor(templateSlug: string, userId: number) {
  return queueSmsMock.mock.calls.filter((c: unknown[]) => {
    const arg = c[0] as { templateSlug: string; userId: number };
    return arg.templateSlug === templateSlug && arg.userId === userId;
  });
}

// --- Coaching members (master SMS on except where noted) ---
let coachingEntitledOptedIn = 0; // entitlement + smsOptIn + coachingSmsOptIn + phone -> SHOULD text
let coachingCategoryOff = 0; // coachingSmsOptIn=false -> skip
let coachingMasterOff = 0; // smsOptIn=false -> skip
let coachingNoPhone = 0; // phone=null -> skip
let coachingNoEntitlement = 0; // not entitled to this call -> skip

// --- Content members ---
let contentOptedIn = 0; // smsOptIn + contentSmsOptIn + phone -> SHOULD text
let contentCategoryOff = 0; // contentSmsOptIn=false -> skip
let contentMasterOff = 0; // smsOptIn=false -> skip
let contentNoPhone = 0; // phone=null -> skip

beforeAll(async () => {
  // Coaching cohort
  coachingEntitledOptedIn = await seedMember("coach-yes", {
    smsOptIn: true,
    coachingSmsOptIn: true,
    contentSmsOptIn: false,
    phone: "+15555550401",
  });
  coachingCategoryOff = await seedMember("coach-cat-off", {
    smsOptIn: true,
    coachingSmsOptIn: false,
    contentSmsOptIn: false,
    phone: "+15555550402",
  });
  coachingMasterOff = await seedMember("coach-master-off", {
    smsOptIn: false,
    coachingSmsOptIn: true,
    contentSmsOptIn: false,
    phone: "+15555550403",
  });
  coachingNoPhone = await seedMember("coach-no-phone", {
    smsOptIn: true,
    coachingSmsOptIn: true,
    contentSmsOptIn: false,
    phone: null,
  });
  // Fully opted in for SMS + coaching, but only holds an unrelated entitlement,
  // so the call's requiredEntitlement JOIN must exclude them.
  coachingNoEntitlement = await seedMember(
    "coach-no-ent",
    {
      smsOptIn: true,
      coachingSmsOptIn: true,
      contentSmsOptIn: false,
      phone: "+15555550404",
    },
    { entitlement: OTHER_ENTITLEMENT },
  );

  // Content cohort
  contentOptedIn = await seedMember("content-yes", {
    smsOptIn: true,
    coachingSmsOptIn: false,
    contentSmsOptIn: true,
    phone: "+15555550501",
  });
  contentCategoryOff = await seedMember("content-cat-off", {
    smsOptIn: true,
    coachingSmsOptIn: false,
    contentSmsOptIn: false,
    phone: "+15555550502",
  });
  contentMasterOff = await seedMember("content-master-off", {
    smsOptIn: false,
    coachingSmsOptIn: false,
    contentSmsOptIn: true,
    phone: "+15555550503",
  });
  contentNoPhone = await seedMember("content-no-phone", {
    smsOptIn: true,
    coachingSmsOptIn: false,
    contentSmsOptIn: true,
    phone: null,
  });

  const [coach] = await db
    .insert(coachesTable)
    .values({
      name: `${TAG} coach`,
      bio: "Test coach",
      specialties: "test",
      callTypes: ["weekly_qa"],
    })
    .returning({ id: coachesTable.id });
  seededCoachId = coach.id;

  // A call 30 minutes out lands inside the 1-hour SMS reminder window.
  const [call] = await db
    .insert(coachingCallsTable)
    .values({
      title: `${TAG} group call`,
      description: "Open Q&A",
      callType: "weekly_qa",
      coachId: coach.id,
      scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
      durationMinutes: 60,
      requiredEntitlement: ENTITLEMENT,
    })
    .returning({ id: coachingCallsTable.id });
  seededCallId = call.id;

  // A call ~3 hours out lands inside the 24-hour EMAIL reminder window but
  // OUTSIDE the 1-hour SMS window. Used to prove the email reminder path is
  // unaffected by the SMS gating (it records its own email-channel dedup key
  // and never queues an SMS).
  const [call24h] = await db
    .insert(coachingCallsTable)
    .values({
      title: `${TAG} tomorrow call`,
      description: "Open Q&A",
      callType: "weekly_qa",
      coachId: coach.id,
      scheduledAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
      durationMinutes: 60,
      requiredEntitlement: ENTITLEMENT,
    })
    .returning({ id: coachingCallsTable.id });
  seeded24hCallId = call24h.id;

  // A just-created "new_content" announcement falls inside the 24-hour
  // content-alert window. type MUST be "new_content" — general/event/milestone
  // posts are surfaced in-app but must not fire the new-content SMS.
  const [announcement] = await db
    .insert(announcementsTable)
    .values({
      title: `${TAG} new lesson drop`,
      body: "A fresh lesson is live",
      type: "new_content",
    })
    .returning({ id: announcementsTable.id });
  seededAnnouncementId = announcement.id;
});

afterAll(async () => {
  const callIds = [seededCallId, seeded24hCallId].filter(Boolean);
  if (callIds.length > 0) {
    await db.delete(coachingCallsTable).where(inArray(coachingCallsTable.id, callIds));
  }
  if (seededCoachId) {
    await db.delete(coachesTable).where(inArray(coachesTable.id, [seededCoachId]));
  }
  if (seededAnnouncementId) {
    await db
      .delete(announcementsTable)
      .where(inArray(announcementsTable.id, [seededAnnouncementId]));
  }
  if (seededUserIds.length > 0) {
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  if (seededProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, seededProductIds));
  }
});

beforeEach(() => {
  queueSmsMock.mockClear();
  queueEmailMock.mockClear();
  checkAndRecordSendMock.mockClear();
  sentKeys.clear();
  sentChannels.length = 0;
});

describe("processCoachingCallReminders — coaching SMS gating", () => {
  it("texts only the fully-eligible member (entitled + master SMS + coaching category + phone), with the right slug + variables", async () => {
    await processCoachingCallReminders();

    const calls = smsCallsFor("coaching_reminder", coachingEntitledOptedIn);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({
      templateSlug: "coaching_reminder",
      to: "+15555550401",
      userId: coachingEntitledOptedIn,
      variables: { call_title: `${TAG} group call` },
    });
  });

  it("skips a member who turned off coaching texts (master SMS still on)", async () => {
    await processCoachingCallReminders();
    expect(smsCallsFor("coaching_reminder", coachingCategoryOff)).toHaveLength(0);
  });

  it("skips a member with master SMS off (even though coaching category is on)", async () => {
    await processCoachingCallReminders();
    expect(smsCallsFor("coaching_reminder", coachingMasterOff)).toHaveLength(0);
  });

  it("skips a member with no phone number on file", async () => {
    await processCoachingCallReminders();
    expect(smsCallsFor("coaching_reminder", coachingNoPhone)).toHaveLength(0);
  });

  it("skips a fully-opted-in member who lacks the call's required entitlement", async () => {
    await processCoachingCallReminders();
    expect(smsCallsFor("coaching_reminder", coachingNoEntitlement)).toHaveLength(0);
  });

  it("never queues an email and leaves the 24h email reminder path intact (records its email-channel dedup key)", async () => {
    await processCoachingCallReminders();

    // The SMS senders must never reach the email queue.
    expect(queueEmailMock).not.toHaveBeenCalled();

    // The 3h-out call sits in the 24h EMAIL window but outside the 1h SMS
    // window: it records an email-channel dedup key and queues no SMS for any
    // member, proving the email reminder logic is unaffected by SMS gating.
    const emailKey = `coaching_reminder_24h_${seeded24hCallId}`;
    const recorded = sentChannels.find((c) => c.sendKey === emailKey);
    expect(recorded).toBeDefined();
    expect(recorded!.channel).toBe("email");

    for (const userId of [
      coachingEntitledOptedIn,
      coachingCategoryOff,
      coachingMasterOff,
      coachingNoPhone,
      coachingNoEntitlement,
    ]) {
      const smsForTomorrowCall = queueSmsMock.mock.calls.filter((c: unknown[]) => {
        const arg = c[0] as { templateSlug: string; userId: number; variables?: { call_title?: string } };
        return (
          arg.templateSlug === "coaching_reminder" &&
          arg.userId === userId &&
          arg.variables?.call_title === `${TAG} tomorrow call`
        );
      });
      expect(smsForTomorrowCall).toHaveLength(0);
    }
  });
});

describe("processNewContentAlerts — content SMS gating", () => {
  it("texts only the fully-eligible member (master SMS + content category + phone), with the right slug + variables", async () => {
    await processNewContentAlerts();

    const calls = smsCallsFor("new_content_alert", contentOptedIn);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({
      templateSlug: "new_content_alert",
      to: "+15555550501",
      userId: contentOptedIn,
      variables: { content_title: `${TAG} new lesson drop` },
    });
  });

  it("skips a member who turned off content texts (master SMS still on)", async () => {
    await processNewContentAlerts();
    expect(smsCallsFor("new_content_alert", contentCategoryOff)).toHaveLength(0);
  });

  it("skips a member with master SMS off (even though content category is on)", async () => {
    await processNewContentAlerts();
    expect(smsCallsFor("new_content_alert", contentMasterOff)).toHaveLength(0);
  });

  it("skips a member with no phone number on file", async () => {
    await processNewContentAlerts();
    expect(smsCallsFor("new_content_alert", contentNoPhone)).toHaveLength(0);
  });

  it("texts each eligible member at most once per announcement across repeated runs (per-member dedup)", async () => {
    // Two passes simulate the 15-minute scheduler firing twice while the
    // announcement is still inside the 24h window. The real Set-backed dedup
    // mock must suppress the second send.
    await processNewContentAlerts();
    await processNewContentAlerts();

    expect(smsCallsFor("new_content_alert", contentOptedIn)).toHaveLength(1);

    // The dedup key is per-member-per-announcement.
    const expectedKey = `content_alert_sms_${seededAnnouncementId}_${contentOptedIn}`;
    const recordedForMember = sentChannels.filter((c) => c.sendKey === expectedKey);
    expect(recordedForMember.length).toBeGreaterThanOrEqual(1);
    expect(recordedForMember[0].channel).toBe("sms");
  });

  it("never queues an email for the content alerts (SMS-only path)", async () => {
    await processNewContentAlerts();
    expect(queueEmailMock).not.toHaveBeenCalled();
  });
});
