import { db, usersTable, systemSettingsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { cancelSequence, enrollInSequence } from "./sequence-helpers";

// Internal, server-only advancement functions for the 7-step onboarding
// contract's three EVENT-ADVANCED steps (Task #1578). These are the ONLY
// legitimate way a member moves off steps 4, 5, or 7 — PATCH
// /members/me/onboarding explicitly rejects client-driven attempts to
// complete these steps (see CLIENT_ADVANCEABLE_STEPS in routes/onboarding.ts).
//
// Intended callers (not built by this task — hooks only):
//   - advanceOnboardingAfterKickoffBooked      — Tier 2 kickoff-call booking flow
//   - advanceOnboardingAfterPartnerCallBooked  — Tier 2 partner-call booking flow
//   - completeOnboardingAfterPartnerCallDone   — Tier 3 GHL webhook confirming
//                                                 the first partner call happened
//
// Each function is a no-op (returns false, does not throw) if the member isn't
// currently sitting on the exact expected step or has already completed
// onboarding. This makes them safe to call from a webhook or booking handler
// that might retry, replay, or fire out of order — they can never move a
// member backward or skip them past a step they haven't reached.

export const ONBOARDING_STEP = {
  WELCOME: 1,
  DOCUMENTS: 2,
  PROFILE: 3,
  KICKOFF_BOOKED: 4,
  PARTNER_CALL_BOOKED: 5,
  PILLARS_WATCHED: 6,
  PARTNER_CALL_COMPLETED: 7,
} as const;

async function advanceIfOnStep(
  userId: number,
  fromStep: number,
  toStep: number,
): Promise<boolean> {
  const result = await db
    .update(usersTable)
    .set({ onboardingStep: toStep })
    .where(
      and(
        eq(usersTable.id, userId),
        eq(usersTable.onboardingStep, fromStep),
        eq(usersTable.onboardingComplete, false),
      ),
    )
    .returning({ id: usersTable.id });
  return result.length > 0;
}

// Called once a member's kickoff call is booked (Tier 2). Advances step 4 -> 5.
export async function advanceOnboardingAfterKickoffBooked(userId: number): Promise<boolean> {
  const advanced = await advanceIfOnStep(userId, ONBOARDING_STEP.KICKOFF_BOOKED, ONBOARDING_STEP.PARTNER_CALL_BOOKED);
  if (advanced) {
    console.log(`[Onboarding] User ${userId} advanced to step ${ONBOARDING_STEP.PARTNER_CALL_BOOKED} (kickoff booked).`);
  }
  return advanced;
}

// Called once a member's first accountability-partner call is booked (Tier 2).
// Advances step 5 -> 6.
export async function advanceOnboardingAfterPartnerCallBooked(userId: number): Promise<boolean> {
  const advanced = await advanceIfOnStep(userId, ONBOARDING_STEP.PARTNER_CALL_BOOKED, ONBOARDING_STEP.PILLARS_WATCHED);
  if (advanced) {
    console.log(`[Onboarding] User ${userId} advanced to step ${ONBOARDING_STEP.PILLARS_WATCHED} (partner call booked).`);
  }
  return advanced;
}

// Called once GHL confirms the member's first partner call actually happened
// (Tier 3 webhook). Completes onboarding from step 7 and fires the same
// completion side effects the old 5-step flow used: cancel the onboarding
// nurture sequences, enroll the member in the post-onboarding upgrade nurture.
export async function completeOnboardingAfterPartnerCallDone(userId: number): Promise<boolean> {
  const result = await db
    .update(usersTable)
    .set({ onboardingStep: ONBOARDING_STEP.PARTNER_CALL_COMPLETED, onboardingComplete: true })
    .where(
      and(
        eq(usersTable.id, userId),
        eq(usersTable.onboardingStep, ONBOARDING_STEP.PARTNER_CALL_COMPLETED),
        eq(usersTable.onboardingComplete, false),
      ),
    )
    .returning({ id: usersTable.id });

  if (result.length === 0) return false;

  await cancelSequence(userId, "onboarding_frontend");
  await cancelSequence(userId, "onboarding_mentorship");
  await enrollInSequence(userId, "nurture_frontend_to_upgrade");

  console.log(`[Onboarding] User ${userId} completed onboarding (first partner call done).`);
  return true;
}

// One-time, idempotent mid-flight migration mapping old 5-step onboarding
// progress onto the new 7-step numbering for members who were mid-onboarding
// when the contract changed:
//   old step 1 -> 1, 2 -> 2, 3 -> 3 (identical meaning, no row changes needed)
//   old step 4 (orientation) or 5 (quick-start) -> new step 4 (book kickoff)
//
// Completed members (onboardingComplete = true) are never touched — the old
// flow always stamped onboardingStep = 5 on completion, which reads fine
// as "done" either way and completedSteps derivation doesn't run for them.
//
// Why a claim row (not a plain "already at 4" idempotency check): steps 4 and
// 5 are REUSED in the new contract with different meaning (kickoff-booked /
// partner-call-booked), so a value of 4 or 5 on a user row is ambiguous after
// the first run — it could be a genuinely new-contract member sitting on step
// 4/5 who must NOT be reset. A system_settings marker, claimed exactly once via
// an atomic insert-if-absent, makes the remap fire only for the single moment
// the contract switched over, then never again. Reaches prod the same way
// other one-time data repairs do: it runs in bootstrapCriticalPrerequisites()
// on server start, since the agent cannot write to prod directly.
const MIGRATION_MARKER_KEY = "onboarding_v2_step_migration_completed_at";

export async function migrateOnboardingStepsToSevenStepContract(): Promise<{
  migrated: boolean;
  usersUpdated: number;
}> {
  // Claim + remap run inside one transaction so a crash mid-migration can
  // never leave the marker claimed with the remap unapplied (which would
  // otherwise permanently skip the remap on every future boot).
  const result = await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(systemSettingsTable)
      .values({
        key: MIGRATION_MARKER_KEY,
        value: { startedAt: new Date().toISOString() },
        category: "onboarding",
        description:
          "One-time marker for the 5-step -> 7-step onboarding contract migration. Presence of this row means the old-step-4/5 -> new-step-4 remap has already run and must never run again.",
      })
      .onConflictDoNothing()
      .returning({ id: systemSettingsTable.id });

    if (claimed.length === 0) {
      // Marker already exists — migration already ran (or is running concurrently
      // on another instance). Never re-run.
      return { migrated: false, usersUpdated: 0 };
    }

    const updated = await tx
      .update(usersTable)
      .set({ onboardingStep: ONBOARDING_STEP.KICKOFF_BOOKED })
      .where(and(eq(usersTable.onboardingComplete, false), inArray(usersTable.onboardingStep, [4, 5])))
      .returning({ id: usersTable.id });

    await tx
      .update(systemSettingsTable)
      .set({
        value: {
          completedAt: new Date().toISOString(),
          usersUpdated: updated.length,
        },
      })
      .where(eq(systemSettingsTable.id, claimed[0].id));

    return { migrated: true, usersUpdated: updated.length };
  });

  if (result.migrated) {
    console.log(
      `[Onboarding] Migrated ${result.usersUpdated} mid-flight member(s) from the old 5-step onboarding numbering to the new 7-step contract (old step 4/5 -> new step 4).`,
    );
  }

  return result;
}
