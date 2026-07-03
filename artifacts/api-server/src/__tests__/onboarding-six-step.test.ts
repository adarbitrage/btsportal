import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  sequencesTable,
  sequenceEnrollmentsTable,
  systemSettingsTable,
  onboardingEffectsTable,
  callBookingsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import onboardingRouter from "../routes/onboarding";
import {
  advanceOnboardingAfterKickoffBooked,
  advanceOnboardingAfterPartnerCallBooked,
  fireOnboardingCompletionEffects,
  migrateOnboardingStepsToSixStepContract,
  ONBOARDING_STEP,
} from "../lib/onboarding-advancement";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `onboarding6-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];
const MIGRATION_MARKER_KEY = "onboarding_v3_step_migration_completed_at";

let app: ReturnType<typeof buildTestAppWithRouters>;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function seedMember(opts: {
  onboardingStep?: number;
  onboardingComplete?: boolean;
  onboardingVariant?: string;
  name?: string;
  experienceLevel?: string | null;
  primaryGoal?: string | null;
}): Promise<{ id: number; email: string; cookie: string }> {
  const email = `${TEST_TAG}-${randomUUID().slice(0, 6)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: opts.name ?? "Onboarding Test",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingStep: opts.onboardingStep ?? 1,
      onboardingComplete: opts.onboardingComplete ?? false,
      onboardingVariant: opts.onboardingVariant ?? "full",
      experienceLevel: opts.experienceLevel ?? null,
      primaryGoal: opts.primaryGoal ?? null,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email, cookie: signCookie(row.id, email) };
}

async function getUser(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user;
}

async function activeEnrollment(userId: number, slug: string) {
  const [sequence] = await db.select().from(sequencesTable).where(eq(sequencesTable.slug, slug));
  if (!sequence) return undefined;
  const [enrollment] = await db
    .select()
    .from(sequenceEnrollmentsTable)
    .where(
      and(
        eq(sequenceEnrollmentsTable.userId, userId),
        eq(sequenceEnrollmentsTable.sequenceId, sequence.id),
        eq(sequenceEnrollmentsTable.status, "active"),
      ),
    );
  return enrollment;
}

async function anyEnrollment(userId: number, slug: string, status: string) {
  const [sequence] = await db.select().from(sequencesTable).where(eq(sequencesTable.slug, slug));
  if (!sequence) return undefined;
  const [enrollment] = await db
    .select()
    .from(sequenceEnrollmentsTable)
    .where(
      and(
        eq(sequenceEnrollmentsTable.userId, userId),
        eq(sequenceEnrollmentsTable.sequenceId, sequence.id),
        eq(sequenceEnrollmentsTable.status, status),
      ),
    );
  return enrollment;
}

beforeAll(() => {
  app = buildTestAppWithRouters([onboardingRouter]);
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(callBookingsTable).where(inArray(callBookingsTable.memberId, seededUserIds));
    await db.delete(sequenceEnrollmentsTable).where(inArray(sequenceEnrollmentsTable.userId, seededUserIds));
    await db.delete(onboardingEffectsTable).where(inArray(onboardingEffectsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("5-step (full) onboarding contract — full walk (Task #1666: send_off replaces pillars_watched/partner_call_completed)", () => {
  it("walks a member who never signed anything from step 1 through completion at step 5 (send_off)", async () => {
    const { id, cookie } = await seedMember({ onboardingStep: 1, onboardingVariant: "full" });

    // Step 1: welcome — client-advanceable, no prerequisites.
    let res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 1 });
    expect(res.status).toBe(200);
    expect(res.body.currentStep).toBe(2);
    expect(res.body.onboardingComplete).toBe(false);

    // Step 2: profile — blocked until name/experienceLevel/primaryGoal are set.
    res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 2 });
    expect(res.status).toBe(400);
    expect((await getUser(id)).onboardingStep).toBe(2);

    await db
      .update(usersTable)
      .set({ name: "Test Member", experienceLevel: "complete_beginner", primaryGoal: "first_sale" })
      .where(eq(usersTable.id, id));

    res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 2 });
    expect(res.status).toBe(200);
    expect(res.body.currentStep).toBe(3);
    expect((await getUser(id)).onboardingComplete).toBe(false);

    // Step 3 (kickoff booked) is event-advanced — only the internal function moves it.
    let advanced = await advanceOnboardingAfterKickoffBooked(id);
    expect(advanced).toBe(true);
    expect((await getUser(id)).onboardingStep).toBe(4);

    // Step 4 (partner call booked) is event-advanced too — advances to send_off (5).
    advanced = await advanceOnboardingAfterPartnerCallBooked(id);
    expect(advanced).toBe(true);
    expect((await getUser(id)).onboardingStep).toBe(5);

    // send_off's prerequisite guard requires real kickoff + partner call
    // bookings on file — seed both directly since the internal advancement
    // functions above only move the step counter, not the booking rows.
    await db.insert(callBookingsTable).values([
      {
        memberId: id,
        staffType: "kickoff_coach",
        staffId: 1,
        type: "kickoff",
        ghlCalendarId: `test-cal-${TEST_TAG}-kickoff`,
        scheduledAt: new Date(),
        endAt: new Date(Date.now() + 30 * 60000),
        status: "booked",
      },
      {
        memberId: id,
        staffType: "partner",
        staffId: 1,
        type: "partner",
        ghlCalendarId: `test-cal-${TEST_TAG}-partner`,
        scheduledAt: new Date(),
        endAt: new Date(Date.now() + 30 * 60000),
        status: "booked",
      },
    ]);

    // Step 5: send_off — client-advanceable, and it's the LAST step, so
    // completing it completes onboarding directly (no more webhook-driven
    // completion for either variant).
    const before = await getUser(id);
    expect(before.onboardingComplete).toBe(false);

    res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 5 });
    expect(res.status).toBe(200);
    expect(res.body.currentStep).toBe(5);
    expect(res.body.onboardingComplete).toBe(true);

    const after = await getUser(id);
    expect(after.onboardingComplete).toBe(true);
    expect(after.onboardingStep).toBe(5);
  });
});

describe("5-step (full) onboarding contract — blocked skip attempts", () => {
  it("rejects a PATCH that tries to complete step 3 (kickoff booked) directly", async () => {
    const { id, cookie } = await seedMember({ onboardingStep: 3, onboardingVariant: "full" });
    const res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/advances automatically/i);
    expect((await getUser(id)).onboardingStep).toBe(3);
  });

  it("rejects a PATCH that tries to complete step 4 (partner call booked) directly", async () => {
    const { id, cookie } = await seedMember({ onboardingStep: 4, onboardingVariant: "full" });
    const res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 4 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/advances automatically/i);
    expect((await getUser(id)).onboardingStep).toBe(4);
  });

  it("rejects a PATCH that tries to jump ahead of the member's current step", async () => {
    const { id, cookie } = await seedMember({ onboardingStep: 1, onboardingVariant: "full" });
    const res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 2 });
    expect(res.status).toBe(400);
    expect((await getUser(id)).onboardingStep).toBe(1);
  });

  it("rejects a step number outside the 1-5 range", async () => {
    const { cookie } = await seedMember({ onboardingStep: 1, onboardingVariant: "full" });
    const res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 6 });
    expect(res.status).toBe(400);
  });

  it("rejects any PATCH once onboarding is already complete", async () => {
    const { id, cookie } = await seedMember({ onboardingStep: 5, onboardingComplete: true, onboardingVariant: "full" });
    const res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 5 });
    expect(res.status).toBe(400);
    expect((await getUser(id)).onboardingComplete).toBe(true);
  });

  it("rejects send_off completion until a kickoff call is on file (prerequisite guard)", async () => {
    const { id, cookie } = await seedMember({ onboardingStep: 5, onboardingVariant: "full" });
    const res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 5 });
    expect(res.status).toBe(400);
    expect((await getUser(id)).onboardingComplete).toBe(false);
  });
});

describe("Internal event-advancement functions — idempotency and guards", () => {
  it("advanceOnboardingAfterKickoffBooked is a no-op if the member isn't on step 3", async () => {
    const { id } = await seedMember({ onboardingStep: 2, onboardingVariant: "full" });
    const advanced = await advanceOnboardingAfterKickoffBooked(id);
    expect(advanced).toBe(false);
    expect((await getUser(id)).onboardingStep).toBe(2);
  });

  it("advanceOnboardingAfterKickoffBooked is safe to call twice (replay-safe)", async () => {
    const { id } = await seedMember({ onboardingStep: 3, onboardingVariant: "full" });
    const first = await advanceOnboardingAfterKickoffBooked(id);
    const second = await advanceOnboardingAfterKickoffBooked(id);
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect((await getUser(id)).onboardingStep).toBe(4);
  });

  it("advanceOnboardingAfterPartnerCallBooked is a no-op if the member isn't on step 4", async () => {
    const { id } = await seedMember({ onboardingStep: 5, onboardingVariant: "full" });
    const advanced = await advanceOnboardingAfterPartnerCallBooked(id);
    expect(advanced).toBe(false);
    expect((await getUser(id)).onboardingStep).toBe(5);
  });

  it("advanceOnboardingAfterPartnerCallBooked is a no-op for launchpad-variant members", async () => {
    const { id } = await seedMember({ onboardingStep: 4, onboardingVariant: "launchpad" });
    const advanced = await advanceOnboardingAfterPartnerCallBooked(id);
    expect(advanced).toBe(false);
    expect((await getUser(id)).onboardingStep).toBe(4);
  });
});

describe("Onboarding completion side effects", () => {
  // Task #1642 (TB1) / Task #1666: completion now ONLY cancels the onboarding
  // nurture sequences — it no longer enrolls the member in anything, and it
  // fires exclusively from the generic isLastStep branch of PATCH
  // /members/me/onboarding (send_off), never from a webhook.
  // nurture_frontend_to_upgrade is fired exclusively at CREATION time for
  // "none"-variant members (see onboarding-effects.test.ts), never here.
  it("cancels both onboarding nurture sequences and enrolls the member in NOTHING", async () => {
    const { id } = await seedMember({ onboardingStep: 5, onboardingVariant: "full" });

    const [frontendSeq] = await db.select().from(sequencesTable).where(eq(sequencesTable.slug, "onboarding_frontend"));
    const [mentorshipSeq] = await db.select().from(sequencesTable).where(eq(sequencesTable.slug, "onboarding_mentorship"));
    expect(frontendSeq).toBeTruthy();
    expect(mentorshipSeq).toBeTruthy();

    await db.insert(sequenceEnrollmentsTable).values([
      { userId: id, sequenceId: frontendSeq.id, status: "active", currentStepOrder: 1 },
      { userId: id, sequenceId: mentorshipSeq.id, status: "active", currentStepOrder: 1 },
    ]);

    await fireOnboardingCompletionEffects(id);

    const frontendCancelled = await anyEnrollment(id, "onboarding_frontend", "cancelled");
    const mentorshipCancelled = await anyEnrollment(id, "onboarding_mentorship", "cancelled");
    expect(frontendCancelled).toBeTruthy();
    expect(mentorshipCancelled).toBeTruthy();

    const upgradeEnrollment = await activeEnrollment(id, "nurture_frontend_to_upgrade");
    expect(upgradeEnrollment).toBeFalsy();
  });

  it("is idempotent: calling it again does not double-cancel or throw", async () => {
    const { id } = await seedMember({ onboardingStep: 5, onboardingVariant: "full" });
    await expect(fireOnboardingCompletionEffects(id)).resolves.toBeUndefined();
    await expect(fireOnboardingCompletionEffects(id)).resolves.toBeUndefined();
  });
});

describe("Mid-flight onboarding migration: 7-step -> 6-step (Task #1624/#1625, ToS-signing step removed)", () => {
  // Clean up both before AND after each test: the real app boot process
  // (bootstrapCriticalPrerequisites) shares this same dev DB and may have
  // already claimed the migration marker outside of this test run, so we
  // can't assume the marker starts absent.
  beforeEach(async () => {
    await db.delete(systemSettingsTable).where(eq(systemSettingsTable.key, MIGRATION_MARKER_KEY));
    await db.delete(systemSettingsTable).where(eq(systemSettingsTable.key, "onboarding_v3_six_step_migration_completed_at"));
  });

  afterEach(async () => {
    await db.delete(systemSettingsTable).where(eq(systemSettingsTable.key, MIGRATION_MARKER_KEY));
    await db.delete(systemSettingsTable).where(eq(systemSettingsTable.key, "onboarding_v3_six_step_migration_completed_at"));
  });

  // These historical step values (5=PILLARS_WATCHED, 6=PARTNER_CALL_COMPLETED)
  // no longer exist on ONBOARDING_STEP after Task #1666 collapsed them into
  // `send_off` — the migration function itself still targets the frozen
  // literal values 5/6 internally (see SIX_STEP_CONTRACT in
  // onboarding-advancement.ts), so these tests assert against those literals
  // directly rather than the (now-removed) named constants.
  it("remaps every old step value to the correct new step", async () => {
    const memberOnOne = await seedMember({ onboardingStep: 1, onboardingComplete: false });
    const memberOnTwo = await seedMember({ onboardingStep: 2, onboardingComplete: false });
    const memberOnThree = await seedMember({ onboardingStep: 3, onboardingComplete: false });
    const memberOnFour = await seedMember({ onboardingStep: 4, onboardingComplete: false });
    const memberOnFive = await seedMember({ onboardingStep: 5, onboardingComplete: false });
    const memberOnSix = await seedMember({ onboardingStep: 6, onboardingComplete: false });
    const memberOnSeven = await seedMember({ onboardingStep: 7, onboardingComplete: false });

    const result = await migrateOnboardingStepsToSixStepContract();
    expect(result.migrated).toBe(true);
    expect(result.usersUpdated).toBeGreaterThanOrEqual(6);

    expect((await getUser(memberOnOne.id)).onboardingStep).toBe(1);
    expect((await getUser(memberOnTwo.id)).onboardingStep).toBe(ONBOARDING_STEP.PROFILE);
    expect((await getUser(memberOnThree.id)).onboardingStep).toBe(ONBOARDING_STEP.PROFILE);
    expect((await getUser(memberOnFour.id)).onboardingStep).toBe(ONBOARDING_STEP.KICKOFF_BOOKED);
    expect((await getUser(memberOnFive.id)).onboardingStep).toBe(ONBOARDING_STEP.PARTNER_CALL_BOOKED);
    expect((await getUser(memberOnSix.id)).onboardingStep).toBe(5);
    expect((await getUser(memberOnSeven.id)).onboardingStep).toBe(6);
  });

  it("never touches completed members, even if they were stamped at an old step value", async () => {
    const completedAtFour = await seedMember({ onboardingStep: 4, onboardingComplete: true });
    const completedAtSix = await seedMember({ onboardingStep: 6, onboardingComplete: true });
    const completedAtSeven = await seedMember({ onboardingStep: 7, onboardingComplete: true });

    await migrateOnboardingStepsToSixStepContract();

    const userFour = await getUser(completedAtFour.id);
    const userSix = await getUser(completedAtSix.id);
    const userSeven = await getUser(completedAtSeven.id);
    expect(userFour.onboardingComplete).toBe(true);
    expect(userFour.onboardingStep).toBe(4);
    expect(userSix.onboardingComplete).toBe(true);
    expect(userSix.onboardingStep).toBe(6);
    expect(userSeven.onboardingComplete).toBe(true);
    expect(userSeven.onboardingStep).toBe(7);
  });

  it("is idempotent — running it a second time does not re-touch anything (claim marker)", async () => {
    const memberOnOldKickoff = await seedMember({ onboardingStep: 4, onboardingComplete: false });

    const first = await migrateOnboardingStepsToSixStepContract();
    expect(first.migrated).toBe(true);
    expect((await getUser(memberOnOldKickoff.id)).onboardingStep).toBe(ONBOARDING_STEP.KICKOFF_BOOKED);

    // Simulate a genuinely new-contract member now legitimately sitting on
    // step 4 (partner call booked, new meaning) after the first migration
    // ran — a second run must NOT touch them.
    const newContractMember = await seedMember({ onboardingStep: 4, onboardingComplete: false });

    const second = await migrateOnboardingStepsToSixStepContract();
    expect(second.migrated).toBe(false);
    expect(second.usersUpdated).toBe(0);

    expect((await getUser(newContractMember.id)).onboardingStep).toBe(4);
    // The already-migrated member should have landed on step 3 (kickoff
    // booked, per the old-4 -> new-3 map) and stayed there.
    expect((await getUser(memberOnOldKickoff.id)).onboardingStep).toBe(ONBOARDING_STEP.KICKOFF_BOOKED);
  });
});
