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
// (smsOptIn && coachingSmsOptIn / contentSmsOptIn && phone) and never touches
// Redis. checkAndRecordSend is forced to always report "new" so dedup never
// suppresses a send the gating would otherwise allow.
const { queueSmsMock, checkAndRecordSendMock } = vi.hoisted(() => ({
  queueSmsMock: vi.fn(async (..._args: any[]) => ({ result: "queued" as const })),
  checkAndRecordSendMock: vi.fn(async (..._args: any[]) => true),
}));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    queueEmail: vi.fn(async () => ({ result: "queued" as const })),
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
// seeded product, isolating it from any other coaching data in the shared DB.
const ENTITLEMENT = `coaching:test-${TAG}`;

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
let seededCoachId = 0;
let seededCallId = 0;
let seededAnnouncementId = 0;

interface SmsPrefs {
  smsOptIn: boolean;
  coachingSmsOptIn: boolean;
  contentSmsOptIn: boolean;
  phone: string | null;
}

async function seedMember(suffix: string, prefs: SmsPrefs): Promise<number> {
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

  // Every member gets an active product carrying the coaching entitlement so
  // the coaching recipient JOIN matches them; the content query ignores
  // entitlements entirely.
  const [product] = await db
    .insert(productsTable)
    .values({
      slug: `${TAG}-product-${suffix}`,
      name: `${suffix} test product`,
      type: "backend",
      entitlementKeys: [ENTITLEMENT] as unknown as string[],
      sortOrder: 99,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(product.id);

  await db.insert(userProductsTable).values({
    userId: user.id,
    productId: product.id,
    status: "active",
  });

  return user.id;
}

function smsCallsFor(templateSlug: string, userId: number) {
  return queueSmsMock.mock.calls.filter((c: unknown[]) => {
    const arg = c[0] as { templateSlug: string; userId: number };
    return arg.templateSlug === templateSlug && arg.userId === userId;
  });
}

let coachingOff = 0;
let coachingOn = 0;
let contentOff = 0;
let contentOn = 0;

beforeAll(async () => {
  // Coaching members: master SMS on, coaching category off vs on.
  coachingOff = await seedMember("coaching-off", {
    smsOptIn: true,
    coachingSmsOptIn: false,
    contentSmsOptIn: false,
    phone: "+15555550401",
  });
  coachingOn = await seedMember("coaching-on", {
    smsOptIn: true,
    coachingSmsOptIn: true,
    contentSmsOptIn: false,
    phone: "+15555550402",
  });
  // Content members: master SMS on, content category off vs on.
  contentOff = await seedMember("content-off", {
    smsOptIn: true,
    coachingSmsOptIn: false,
    contentSmsOptIn: false,
    phone: "+15555550403",
  });
  contentOn = await seedMember("content-on", {
    smsOptIn: true,
    coachingSmsOptIn: false,
    contentSmsOptIn: true,
    phone: "+15555550404",
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

  // A just-created announcement falls inside the 24-hour content-alert window.
  const [announcement] = await db
    .insert(announcementsTable)
    .values({
      title: `${TAG} new lesson drop`,
      body: "A fresh lesson is live",
    })
    .returning({ id: announcementsTable.id });
  seededAnnouncementId = announcement.id;
});

afterAll(async () => {
  if (seededCallId) {
    await db.delete(coachingCallsTable).where(inArray(coachingCallsTable.id, [seededCallId]));
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
  checkAndRecordSendMock.mockClear();
});

describe("scheduled coaching-reminder SMS — coaching category gating", () => {
  it("does NOT queue the coaching reminder when the member turned off coaching texts (master SMS still on)", async () => {
    await processCoachingCallReminders();
    expect(smsCallsFor("coaching_reminder", coachingOff)).toHaveLength(0);
  });

  it("queues the coaching reminder when both master SMS and coaching texts are on", async () => {
    await processCoachingCallReminders();
    const calls = smsCallsFor("coaching_reminder", coachingOn);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({
      templateSlug: "coaching_reminder",
      to: "+15555550402",
      userId: coachingOn,
    });
  });
});

describe("scheduled new-content SMS — content category gating", () => {
  it("does NOT queue the content alert when the member turned off content texts (master SMS still on)", async () => {
    await processNewContentAlerts();
    expect(smsCallsFor("new_content_alert", contentOff)).toHaveLength(0);
  });

  it("queues the content alert when both master SMS and content texts are on", async () => {
    await processNewContentAlerts();
    const calls = smsCallsFor("new_content_alert", contentOn);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const mine = calls.find(
      (c: unknown[]) =>
        (c[0] as { variables?: { content_title?: string } }).variables?.content_title ===
        `${TAG} new lesson drop`,
    );
    expect(mine).toBeDefined();
    expect(mine![0]).toMatchObject({
      templateSlug: "new_content_alert",
      to: "+15555550404",
      userId: contentOn,
    });
  });
});
