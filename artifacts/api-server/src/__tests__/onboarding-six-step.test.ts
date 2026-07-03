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
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import onboardingRouter from "../routes/onboarding";
import {
  advanceOnboardingAfterKickoffBooked,
  advanceOnboardingAfterPartnerCallBooked,
  completeOnboardingAfterPartnerCallDone,
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
    await db.delete(sequenceEnrollmentsTable).where(inArray(sequenceEnrollmentsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("6-step onboarding contract — full walk (Task #1624/#1625: ToS-signing step removed)", () => {
  it("walks a member who never signed anything from step 1 through completion at step 6", async () => {
    const { id, cookie } = await seedMember({ onboardingStep: 1 });

    // Step 1: welcome — client-advanceable, no prerequisites.
    let res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 1 });
    expect(res.status).toBe(200);
    expect(res.body.currentStep).toBe(2);
    expect(res.body.onboardingComplete).toBe(false);

    // Step 2: profile — blocked until name/experienceLevel/primaryGoal are set.
    // Notably NOT a ToS/documents gate anymore.
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

    // Step 4 (partner call booked) is event-advanced too.
    advanced = await advanceOnboardingAfterPartnerCallBooked(id);
    expect(advanced).toBe(true);
    expect((await getUser(id)).onboardingStep).toBe(5);

    // Step 5: watch 7 Pillars — client-advanceable, click-to-confirm.
    res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 5 });
    expect(res.status).toBe(200);
    expect(res.body.currentStep).toBe(6);
    expect(res.body.onboardingComplete).toBe(false);

    // Step 6 (first partner call done) completes onboarding via the internal
    // function only, firing the completion side effects.
    const before = await getUser(id);
    expect(before.onboardingComplete).toBe(false);

    const completed = await completeOnboardingAfterPartnerCallDone(id);
    expect(completed).toBe(true);

    const after = await getUser(id);
    expect(after.onboardingComplete).toBe(true);
    expect(after.onboardingStep).toBe(6);
  });
});

describe("6-step onboarding contract — blocked skip attempts", () => {
  it("rejects a PATCH that tries to complete step 3 (kickoff booked) directly", async () => {
    const { id, cookie } = await seedMember({ onboardingStep: 3 });
    const res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/advances automatically/i);
    expect((await getUser(id)).onboardingStep).toBe(3);
  });

  it("rejects a PATCH that tries to complete step 4 (partner call booked) directly", async () => {
    const { id, cookie } = await seedMember({ onboardingStep: 4 });
    const res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 4 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/advances automatically/i);
    expect((await getUser(id)).onboardingStep).toBe(4);
  });

  it("rejects a PATCH that tries to complete step 6 (partner call completed) directly", async () => {
    const { id, cookie } = await seedMember({ onboardingStep: 6 });
    const res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 6 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/advances automatically/i);
    const user = await getUser(id);
    expect(user.onboardingStep).toBe(6);
    expect(user.onboardingComplete).toBe(false);
  });

  it("rejects a PATCH that tries to jump ahead of the member's current step", async () => {
    const { id, cookie } = await seedMember({ onboardingStep: 1 });
    const res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 2 });
    expect(res.status).toBe(400);
    expect((await getUser(id)).onboardingStep).toBe(1);
  });

  it("rejects a step number outside the 1-6 range", async () => {
    const { cookie } = await seedMember({ onboardingStep: 1 });
    const res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 7 });
    expect(res.status).toBe(400);
  });

  it("rejects any PATCH once onboarding is already complete", async () => {
    const { id, cookie } = await seedMember({ onboardingStep: 6, onboardingComplete: true });
    const res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 6 });
    expect(res.status).toBe(400);
    expect((await getUser(id)).onboardingComplete).toBe(true);
  });
});

describe("Internal event-advancement functions — idempotency and guards", () => {
  it("advanceOnboardingAfterKickoffBooked is a no-op if the member isn't on step 3", async () => {
    const { id } = await seedMember({ onboardingStep: 2 });
    const advanced = await advanceOnboardingAfterKickoffBooked(id);
    expect(advanced).toBe(false);
    expect((await getUser(id)).onboardingStep).toBe(2);
  });

  it("advanceOnboardingAfterKickoffBooked is safe to call twice (replay-safe)", async () => {
    const { id } = await seedMember({ onboardingStep: 3 });
    const first = await advanceOnboardingAfterKickoffBooked(id);
    const second = await advanceOnboardingAfterKickoffBooked(id);
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect((await getUser(id)).onboardingStep).toBe(4);
  });

  it("advanceOnboardingAfterPartnerCallBooked is a no-op if the member isn't on step 4", async () => {
    const { id } = await seedMember({ onboardingStep: 5 });
    const advanced = await advanceOnboardingAfterPartnerCallBooked(id);
    expect(advanced).toBe(false);
    expect((await getUser(id)).onboardingStep).toBe(5);
  });

  it("completeOnboardingAfterPartnerCallDone is a no-op if the member isn't on step 6", async () => {
    const { id } = await seedMember({ onboardingStep: 5 });
    const completed = await completeOnboardingAfterPartnerCallDone(id);
    expect(completed).toBe(false);
    const user = await getUser(id);
    expect(user.onboardingComplete).toBe(false);
    expect(user.onboardingStep).toBe(5);
  });

  it("completeOnboardingAfterPartnerCallDone is a no-op once already complete (replay-safe)", async () => {
    const { id } = await seedMember({ onboardingStep: 6 });
    const first = await completeOnboardingAfterPartnerCallDone(id);
    const second = await completeOnboardingAfterPartnerCallDone(id);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});

describe("Onboarding completion side effects", () => {
  it("cancels both onboarding nurture sequences and enrolls the member in the upgrade nurture", async () => {
    const { id } = await seedMember({ onboardingStep: 6 });

    const [frontendSeq] = await db.select().from(sequencesTable).where(eq(sequencesTable.slug, "onboarding_frontend"));
    const [mentorshipSeq] = await db.select().from(sequencesTable).where(eq(sequencesTable.slug, "onboarding_mentorship"));
    expect(frontendSeq).toBeTruthy();
    expect(mentorshipSeq).toBeTruthy();

    await db.insert(sequenceEnrollmentsTable).values([
      { userId: id, sequenceId: frontendSeq.id, status: "active", currentStepOrder: 1 },
      { userId: id, sequenceId: mentorshipSeq.id, status: "active", currentStepOrder: 1 },
    ]);

    const completed = await completeOnboardingAfterPartnerCallDone(id);
    expect(completed).toBe(true);

    const frontendCancelled = await anyEnrollment(id, "onboarding_frontend", "cancelled");
    const mentorshipCancelled = await anyEnrollment(id, "onboarding_mentorship", "cancelled");
    expect(frontendCancelled).toBeTruthy();
    expect(mentorshipCancelled).toBeTruthy();

    const upgradeEnrollment = await activeEnrollment(id, "nurture_frontend_to_upgrade");
    expect(upgradeEnrollment).toBeTruthy();
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
    expect((await getUser(memberOnSix.id)).onboardingStep).toBe(ONBOARDING_STEP.PILLARS_WATCHED);
    expect((await getUser(memberOnSeven.id)).onboardingStep).toBe(ONBOARDING_STEP.PARTNER_CALL_COMPLETED);
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
