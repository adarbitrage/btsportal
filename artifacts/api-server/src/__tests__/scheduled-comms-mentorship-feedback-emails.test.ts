import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  coachesTable,
  coachingCallsTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

// These two handlers were stubbed (`[STUB:EMAIL] Would send ...`) and are now
// wired to CommunicationService.queueEmail. We mock the email sender + the
// Postgres-backed dedup helper so the test exercises ONLY the recipient
// selection, template/variable wiring, and per-key dedup decisions — never
// Redis. checkAndRecordSend is backed by a real in-memory Set keyed on the
// sendKey so repeated scheduler runs exercise dedup for real.
const { queueEmailMock, sentKeys, sentChannels, checkAndRecordSendMock } =
  vi.hoisted(() => {
    const sentKeys = new Set<string>();
    const sentChannels: Array<{ sendKey: string; channel: string }> = [];
    return {
      sentKeys,
      sentChannels,
      queueEmailMock: vi.fn(async (..._args: any[]) => ({ result: "queued" as const })),
      checkAndRecordSendMock: vi.fn(
        async (
          sendKey: string,
          channel: string,
        ): Promise<"recorded" | "duplicate" | "error"> => {
          sentChannels.push({ sendKey, channel });
          if (sentKeys.has(sendKey)) return "duplicate";
          sentKeys.add(sendKey);
          return "recorded";
        },
      ),
    };
  });

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    queueEmail: queueEmailMock,
    queueSms: vi.fn(async () => ({ result: "queued" as const })),
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
  processMentorshipExpirationWarnings,
  processSessionFeedbackPrompts,
} from "../lib/scheduled-comms";

// Session-feedback prompts are paused by default behind an env flag
// (Task #1770); enable it so this suite can exercise recipient selection.
let prevFeedbackFlag: string | undefined;

beforeAll(() => {
  prevFeedbackFlag = process.env.SESSION_FEEDBACK_PROMPTS_ENABLED;
  process.env.SESSION_FEEDBACK_PROMPTS_ENABLED = "true";
});

afterAll(() => {
  if (prevFeedbackFlag === undefined) delete process.env.SESSION_FEEDBACK_PROMPTS_ENABLED;
  else process.env.SESSION_FEEDBACK_PROMPTS_ENABLED = prevFeedbackFlag;
});

const TAG = `sched-email-${randomUUID().slice(0, 8)}`;
// Unique entitlement so the session-feedback recipient query matches ONLY this
// test's seeded products, isolating it from other coaching data in the shared DB.
const ENTITLEMENT = `coaching:test-${TAG}`;
const OTHER_ENTITLEMENT = `coaching:other-${TAG}`;

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
const seededUserProductIds: number[] = [];
let seededCoachId = 0;
let seededCompletedCallId = 0;

// Mentorship cohort (each maps to one user + one backend product).
let mentorship30dUserId = 0;
let mentorship30dUserProductId = 0;
let mentorship7dUserId = 0;
let mentorship7dUserProductId = 0;
let mentorshipExpiredUserId = 0;
let mentorshipExpiredUserProductId = 0;

// Session-feedback cohort.
let feedbackEntitledUserId = 0;
let feedbackNoEntitlementUserId = 0;

async function seedUser(suffix: string): Promise<number> {
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
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(user.id);
  return user.id;
}

async function seedBackendProduct(
  suffix: string,
  entitlement: string,
): Promise<number> {
  const [product] = await db
    .insert(productsTable)
    .values({
      slug: `${TAG}-product-${suffix}`,
      name: `${suffix} Mentorship`,
      type: "backend",
      entitlementKeys: [entitlement] as unknown as string[],
      sortOrder: 99,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(product.id);
  return product.id;
}

async function grantProduct(
  userId: number,
  productId: number,
  opts: { status: string; expiresAt: Date | null },
): Promise<number> {
  const [up] = await db
    .insert(userProductsTable)
    .values({
      userId,
      productId,
      status: opts.status,
      expiresAt: opts.expiresAt,
    })
    .returning({ id: userProductsTable.id });
  seededUserProductIds.push(up.id);
  return up.id;
}

function emailCallsFor(templateSlug: string, userId: number) {
  return queueEmailMock.mock.calls.filter((c: unknown[]) => {
    const arg = c[0] as { templateSlug: string; userId: number };
    return arg.templateSlug === templateSlug && arg.userId === userId;
  });
}

beforeAll(async () => {
  const now = Date.now();

  // --- Mentorship: 30-day warning (expires ~20 days out, outside 7d window) ---
  mentorship30dUserId = await seedUser("ment-30d");
  const product30d = await seedBackendProduct("30d", `${ENTITLEMENT}-30d`);
  mentorship30dUserProductId = await grantProduct(mentorship30dUserId, product30d, {
    status: "active",
    expiresAt: new Date(now + 20 * 24 * 60 * 60 * 1000),
  });

  // --- Mentorship: 7-day urgent (expires ~3 days out, inside 7d window) ---
  mentorship7dUserId = await seedUser("ment-7d");
  const product7d = await seedBackendProduct("7d", `${ENTITLEMENT}-7d`);
  mentorship7dUserProductId = await grantProduct(mentorship7dUserId, product7d, {
    status: "active",
    expiresAt: new Date(now + 3 * 24 * 60 * 60 * 1000),
  });

  // --- Mentorship: EXPIRED (expired ~2 hours ago, inside the 24h lookback) ---
  mentorshipExpiredUserId = await seedUser("ment-expired");
  const productExpired = await seedBackendProduct("expired", `${ENTITLEMENT}-exp`);
  mentorshipExpiredUserProductId = await grantProduct(
    mentorshipExpiredUserId,
    productExpired,
    {
      status: "expired",
      expiresAt: new Date(now - 2 * 60 * 60 * 1000),
    },
  );

  // --- Session feedback: an entitled member + a member with an unrelated
  // entitlement (must be excluded) ---
  feedbackEntitledUserId = await seedUser("fb-yes");
  const fbProduct = await seedBackendProduct("fb", ENTITLEMENT);
  await grantProduct(feedbackEntitledUserId, fbProduct, {
    status: "active",
    expiresAt: null,
  });

  feedbackNoEntitlementUserId = await seedUser("fb-no");
  const fbOtherProduct = await seedBackendProduct("fb-other", OTHER_ENTITLEMENT);
  await grantProduct(feedbackNoEntitlementUserId, fbOtherProduct, {
    status: "active",
    expiresAt: null,
  });

  const [coach] = await db
    .insert(coachesTable)
    .values({
      name: `${TAG} coach`,
      bio: "Test coach",
      specialties: "test",
    })
    .returning({ id: coachesTable.id });
  seededCoachId = coach.id;

  // A call ~24.5h ago WITH a recording sits in the session-feedback window.
  const [completedCall] = await db
    .insert(coachingCallsTable)
    .values({
      title: `${TAG} finished call`,
      description: "Open Q&A",
      callType: "weekly_qa",
      coachId: coach.id,
      scheduledAt: new Date(Date.now() - 24.5 * 60 * 60 * 1000),
      durationMinutes: 60,
      requiredEntitlement: ENTITLEMENT,
      recordingUrl: "https://example.test/recording.mp4",
    })
    .returning({ id: coachingCallsTable.id });
  seededCompletedCallId = completedCall.id;
});

afterAll(async () => {
  if (seededCompletedCallId) {
    await db.delete(coachingCallsTable).where(inArray(coachingCallsTable.id, [seededCompletedCallId]));
  }
  if (seededCoachId) {
    await db.delete(coachesTable).where(inArray(coachesTable.id, [seededCoachId]));
  }
  if (seededUserProductIds.length > 0) {
    await db.delete(userProductsTable).where(inArray(userProductsTable.id, seededUserProductIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  if (seededProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, seededProductIds));
  }
});

beforeEach(() => {
  queueEmailMock.mockClear();
  checkAndRecordSendMock.mockClear();
  sentKeys.clear();
  sentChannels.length = 0;
});

describe("processMentorshipExpirationWarnings — expiration emails", () => {
  it("queues the 30-day warning email with the right slug + variables", async () => {
    await processMentorshipExpirationWarnings();

    const calls = emailCallsFor("mentorship_expiring_warning", mentorship30dUserId);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({
      templateSlug: "mentorship_expiring_warning",
      to: `${TAG}-ment-30d@example.test`,
      userId: mentorship30dUserId,
      variables: { product_name: "30d Mentorship" },
    });
    expect((calls[0][0] as { variables: { expiration_date: string } }).variables.expiration_date).toBeTruthy();

    // Records a per-userProduct email dedup key.
    const key = `mentorship_expiration_30d_${mentorship30dUserProductId}`;
    const recorded = sentChannels.find((c) => c.sendKey === key);
    expect(recorded).toBeDefined();
    expect(recorded!.channel).toBe("email");
  });

  it("queues the 7-day URGENT email (not the 30-day) for a member inside the 7d window", async () => {
    await processMentorshipExpirationWarnings();

    const urgent = emailCallsFor("mentorship_expiring_urgent", mentorship7dUserId);
    expect(urgent).toHaveLength(1);
    expect(urgent[0][0]).toMatchObject({
      templateSlug: "mentorship_expiring_urgent",
      to: `${TAG}-ment-7d@example.test`,
      userId: mentorship7dUserId,
    });

    // The same member must NOT also get the 30-day warning on this run.
    expect(emailCallsFor("mentorship_expiring_warning", mentorship7dUserId)).toHaveLength(0);
  });

  it("queues the EXPIRED notice for a recently-expired backend product", async () => {
    await processMentorshipExpirationWarnings();

    const calls = emailCallsFor("mentorship_expired", mentorshipExpiredUserId);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({
      templateSlug: "mentorship_expired",
      to: `${TAG}-ment-expired@example.test`,
      userId: mentorshipExpiredUserId,
    });

    const key = `mentorship_expired_${mentorshipExpiredUserProductId}`;
    const recorded = sentChannels.find((c) => c.sendKey === key);
    expect(recorded).toBeDefined();
    expect(recorded!.channel).toBe("email");
  });

  it("dedups each expiration email across repeated scheduler runs", async () => {
    await processMentorshipExpirationWarnings();
    await processMentorshipExpirationWarnings();

    expect(emailCallsFor("mentorship_expiring_warning", mentorship30dUserId)).toHaveLength(1);
    expect(emailCallsFor("mentorship_expiring_urgent", mentorship7dUserId)).toHaveLength(1);
    expect(emailCallsFor("mentorship_expired", mentorshipExpiredUserId)).toHaveLength(1);
  });
});

describe("processSessionFeedbackPrompts — feedback emails", () => {
  it("queues the feedback email to an entitled member with the right slug + variables", async () => {
    await processSessionFeedbackPrompts();

    const calls = emailCallsFor("session_feedback", feedbackEntitledUserId);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({
      templateSlug: "session_feedback",
      to: `${TAG}-fb-yes@example.test`,
      userId: feedbackEntitledUserId,
      variables: { call_title: `${TAG} finished call` },
    });

    // Per-member dedup key (not the old per-call key).
    const key = `session_feedback_email_${seededCompletedCallId}_${feedbackEntitledUserId}`;
    const recorded = sentChannels.find((c) => c.sendKey === key);
    expect(recorded).toBeDefined();
    expect(recorded!.channel).toBe("email");
  });

  it("does not email a member lacking the call's required entitlement", async () => {
    await processSessionFeedbackPrompts();
    expect(emailCallsFor("session_feedback", feedbackNoEntitlementUserId)).toHaveLength(0);
  });

  it("dedups the feedback email per member across repeated scheduler runs", async () => {
    await processSessionFeedbackPrompts();
    await processSessionFeedbackPrompts();

    expect(emailCallsFor("session_feedback", feedbackEntitledUserId)).toHaveLength(1);
  });
});

// End-to-end coverage of the scheduler's dedup-store-FAILURE branch. The path
// tests above mock checkAndRecordSend to always succeed, so the "error" outcome
// (reserveSend returns false and logs loudly) was previously exercised only at
// the helper level (comms-dedup-failure.test.ts). Here we drive a REAL
// scheduler pass with eligible recipients seeded and the dedup store reporting
// "error", asserting the scheduler (a) queues NO email and (b) logs the loud
// "[Scheduled Comms] Dedup store unavailable ..." message — and crucially that
// this differs from the silent "duplicate -> skip" behavior.
describe("scheduled comms — dedup store unavailable (returns \"error\")", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  // Restore the default in-memory dedup behavior (matches the vi.hoisted impl)
  // so a failing run here can't leak into other suites.
  function restoreDefaultDedup() {
    checkAndRecordSendMock.mockImplementation(async (sendKey: string, channel: string) => {
      sentChannels.push({ sendKey, channel });
      if (sentKeys.has(sendKey)) return "duplicate";
      sentKeys.add(sendKey);
      return "recorded";
    });
  }

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Simulate a broken/unreachable comms_send_log: every reservation fails.
    checkAndRecordSendMock.mockImplementation(
      async (sendKey: string, channel: string): Promise<"recorded" | "duplicate" | "error"> => {
        sentChannels.push({ sendKey, channel });
        return "error";
      },
    );
  });

  afterEach(() => {
    errorSpy.mockRestore();
    restoreDefaultDedup();
  });

  it("queues NO mentorship email and logs the dedup-store-unavailable error", async () => {
    await processMentorshipExpirationWarnings();

    // The dedup store failed for every reservation, so nothing is sent.
    expect(emailCallsFor("mentorship_expiring_warning", mentorship30dUserId)).toHaveLength(0);
    expect(emailCallsFor("mentorship_expiring_urgent", mentorship7dUserId)).toHaveLength(0);
    expect(emailCallsFor("mentorship_expired", mentorshipExpiredUserId)).toHaveLength(0);
    expect(queueEmailMock).not.toHaveBeenCalled();

    // The reservation was attempted (not skipped before checking the store).
    expect(checkAndRecordSendMock).toHaveBeenCalled();

    // ...and the failure surfaced LOUDLY rather than being swallowed.
    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("[Scheduled Comms] Dedup store unavailable");
  });

  it("queues NO session-feedback email and logs the dedup-store-unavailable error", async () => {
    await processSessionFeedbackPrompts();

    expect(emailCallsFor("session_feedback", feedbackEntitledUserId)).toHaveLength(0);
    expect(queueEmailMock).not.toHaveBeenCalled();
    expect(checkAndRecordSendMock).toHaveBeenCalled();

    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("[Scheduled Comms] Dedup store unavailable");
  });

  it("distinguishes a store ERROR (loud skip) from a DUPLICATE (silent skip)", async () => {
    // Re-point the store at the "duplicate" outcome: the scheduler must still
    // queue nothing, but this time WITHOUT the loud unavailable error — that
    // message is reserved for genuine store failures, not already-sent mail.
    checkAndRecordSendMock.mockImplementation(async (sendKey: string, channel: string) => {
      sentChannels.push({ sendKey, channel });
      return "duplicate";
    });

    await processMentorshipExpirationWarnings();

    expect(queueEmailMock).not.toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain("Dedup store unavailable");
  });
});
