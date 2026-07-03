import { db, usersTable, systemSettingsTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { cancelSequence } from "./sequence-helpers";
import { claimOnboardingEffect, ONBOARDING_EFFECT } from "./onboarding-effects";

// Internal, server-only advancement functions for the 6-step onboarding
// contract's three EVENT-ADVANCED steps (renumbered from the prior 7-step
// contract, which removed the standalone in-portal ToS-signing step). These
// are the ONLY legitimate way a member moves off steps 3, 4, or 6 — PATCH
// /members/me/onboarding explicitly rejects client-driven attempts to
// complete these steps (see CLIENT_ADVANCEABLE_STEPS in routes/onboarding.ts).
//
// Intended callers (hooks only):
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
  PROFILE: 2,
  KICKOFF_BOOKED: 3,
  PARTNER_CALL_BOOKED: 4,
  PILLARS_WATCHED: 5,
  PARTNER_CALL_COMPLETED: 6,
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

// Called once a member's kickoff call is booked (Tier 2). Advances step 3 -> 4.
export async function advanceOnboardingAfterKickoffBooked(userId: number): Promise<boolean> {
  const advanced = await advanceIfOnStep(userId, ONBOARDING_STEP.KICKOFF_BOOKED, ONBOARDING_STEP.PARTNER_CALL_BOOKED);
  if (advanced) {
    console.log(`[Onboarding] User ${userId} advanced to step ${ONBOARDING_STEP.PARTNER_CALL_BOOKED} (kickoff booked).`);
  }
  return advanced;
}

// Called once a member's first accountability-partner call is booked (Tier 2).
// Advances step 4 -> 5. NO-OP for "launchpad" variant members — LaunchPad has
// no partner-call step at all, so step 4 for them means pillars_watched (a
// client-advanceable step handled entirely by PATCH /members/me/onboarding,
// never by this function).
export async function advanceOnboardingAfterPartnerCallBooked(userId: number): Promise<boolean> {
  const [user] = await db.select({ onboardingVariant: usersTable.onboardingVariant }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user || user.onboardingVariant !== "full") return false;

  const advanced = await advanceIfOnStep(userId, ONBOARDING_STEP.PARTNER_CALL_BOOKED, ONBOARDING_STEP.PILLARS_WATCHED);
  if (advanced) {
    console.log(`[Onboarding] User ${userId} advanced to step ${ONBOARDING_STEP.PILLARS_WATCHED} (partner call booked).`);
  }
  return advanced;
}

// Shared, tier-aware onboarding-completion side effects (Task #1642 / TB1).
// Called for BOTH variants the moment a member finishes onboarding — "full"
// via completeOnboardingAfterPartnerCallDone below, and "launchpad" via the
// isLastStep branch of PATCH /members/me/onboarding (routes/onboarding.ts).
//
// Completion now ONLY cancels the onboarding nurture sequences
// (onboarding_frontend, onboarding_mentorship) — it no longer enrolls the
// member in anything. nurture_frontend_to_upgrade is fired exclusively at
// CREATION time for "none"-variant members (see
// applyCreationTimeOnboardingDefaults in onboarding-variant.ts); a member who
// actually completes launchpad/full onboarding already holds a paid tier and
// has no reason to be nudged toward one. No launchpad/YSE "sequence 31" is
// ever enrolled here or anywhere else in this flow.
//
// Guarded by a per-(member, effect) idempotency claim so calling this twice
// for the same member (e.g. a retried webhook, or the same member later
// re-completing a HIGHER variant after an upgrade re-entry) only ever fires
// the sequence cancellation once — cancelSequence itself is safe to call
// repeatedly, but this keeps the effect ledger authoritative and avoids
// redundant work.
export async function fireOnboardingCompletionEffects(userId: number): Promise<void> {
  const claimed = await claimOnboardingEffect(userId, ONBOARDING_EFFECT.COMPLETION_CANCEL_SEQUENCES);
  if (!claimed) {
    console.log(`[Onboarding] Completion effects already fired for user ${userId}; skipping.`);
    return;
  }

  await cancelSequence(userId, "onboarding_frontend");
  await cancelSequence(userId, "onboarding_mentorship");
  console.log(`[Onboarding] Fired completion effects for user ${userId} (cancelled onboarding sequences).`);
}

// Called once GHL confirms the member's first partner call actually happened
// (Tier 3 webhook). Completes onboarding from step 6 and fires the shared
// tier-aware completion effects (see fireOnboardingCompletionEffects above).
// NO-OP for "launchpad" variant members (see advanceOnboardingAfterPartnerCallBooked)
// — LaunchPad onboarding completes via a direct client PATCH instead.
export async function completeOnboardingAfterPartnerCallDone(userId: number): Promise<boolean> {
  const [existingUser] = await db.select({ onboardingVariant: usersTable.onboardingVariant }).from(usersTable).where(eq(usersTable.id, userId));
  if (!existingUser || existingUser.onboardingVariant !== "full") return false;

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

  await fireOnboardingCompletionEffects(userId);

  console.log(`[Onboarding] User ${userId} completed onboarding (first partner call done).`);
  return true;
}

// One-time, idempotent mid-flight migration mapping old 5-step onboarding
// progress onto the (now superseded) 7-step numbering, for members who were
// mid-onboarding when that contract changed (Task #1578):
//   old step 1 -> 1, 2 -> 2, 3 -> 3 (identical meaning, no row changes needed)
//   old step 4 (orientation) or 5 (quick-start) -> new step 4 (book kickoff,
//   the OLD 7-step contract's step 4 — NOT the current ONBOARDING_STEP
//   constant, whose numbering has since moved on; this function intentionally
//   uses the literal historical value so the migration keeps meaning exactly
//   what it always has).
//
// Completed members (onboardingComplete = true) are never touched.
//
// Kept even though the 7-step contract has since been superseded by the
// 6-step contract (see migrateOnboardingStepsToSixStepContract below) —
// members who never received this remap still need it BEFORE the 6-step
// remap runs, since the 6-step remap's OLD_TO_NEW map assumes 7-step
// numbering as its starting point. Boot order (see
// bootstrap-critical-prerequisites.ts) runs this one first.
const LEGACY_SEVEN_STEP_MIGRATION_MARKER_KEY = "onboarding_v2_step_migration_completed_at";
const LEGACY_SEVEN_STEP_KICKOFF_BOOKED = 4;

export async function migrateOnboardingStepsToSevenStepContract(): Promise<{
  migrated: boolean;
  usersUpdated: number;
}> {
  const result = await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(systemSettingsTable)
      .values({
        key: LEGACY_SEVEN_STEP_MIGRATION_MARKER_KEY,
        value: { startedAt: new Date().toISOString() },
        category: "onboarding",
        description:
          "One-time marker for the 5-step -> 7-step onboarding contract migration. Presence of this row means the old-step-4/5 -> new-step-4 remap has already run and must never run again.",
      })
      .onConflictDoNothing()
      .returning({ id: systemSettingsTable.id });

    if (claimed.length === 0) {
      return { migrated: false, usersUpdated: 0 };
    }

    const updated = await tx
      .update(usersTable)
      .set({ onboardingStep: LEGACY_SEVEN_STEP_KICKOFF_BOOKED })
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
      `[Onboarding] Migrated ${result.usersUpdated} mid-flight member(s) from the old 5-step onboarding numbering to the (now superseded) 7-step contract (old step 4/5 -> new step 4).`,
    );
  }

  return result;
}

// One-time, idempotent mid-flight migration mapping the old 7-step onboarding
// numbering (which included an in-portal ToS signing step at step 2) onto the
// new 6-step contract for members who were mid-onboarding when the ToS step
// was removed (Task #1624):
//   old step 1 -> 1 (welcome, identical meaning)
//   old step 2 (documents/ToS) or 3 (profile) -> new step 2 (profile)
//   old step 4 (kickoff booked) -> new step 3
//   old step 5 (partner call booked) -> new step 4
//   old step 6 (pillars watched) -> new step 5
//   old step 7 (partner call completed) -> new step 6
//
// Completed members (onboardingComplete = true) are never touched.
//
// Why a claim row (not a plain value-based check): every step number from 2
// through 7 is REUSED in the new contract with a different meaning, so a
// user's raw onboardingStep value is ambiguous after the first run — it could
// be a genuinely new-contract member sitting on that step who must NOT be
// remapped again. A system_settings marker, claimed exactly once via an
// atomic insert-if-absent, makes the remap fire only for the single moment
// the contract switched over, then never again. This is a DIFFERENT marker
// from the earlier 5-step -> 7-step migration (see
// onboarding_v2_step_migration_completed_at) since it covers a distinct
// renumbering. Reaches prod the same way other one-time data repairs do: it
// runs in bootstrapCriticalPrerequisites() on server start, since the agent
// cannot write to prod directly.
const MIGRATION_MARKER_KEY = "onboarding_v3_step_migration_completed_at";

export async function migrateOnboardingStepsToSixStepContract(): Promise<{
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
          "One-time marker for the 7-step -> 6-step onboarding contract migration (ToS signing step removed, Task #1624). Presence of this row means the old-step -> new-step remap has already run and must never run again.",
      })
      .onConflictDoNothing()
      .returning({ id: systemSettingsTable.id });

    if (claimed.length === 0) {
      // Marker already exists — migration already ran (or is running concurrently
      // on another instance). Never re-run.
      return { migrated: false, usersUpdated: 0 };
    }

    // Map old step -> new step. Step 1 is identical in both contracts and is
    // intentionally omitted (no row change needed).
    // Note: old steps 2 and 3 both collapse onto new step 2 (PROFILE).
    const OLD_TO_NEW: Record<number, number> = {
      2: ONBOARDING_STEP.PROFILE,
      3: ONBOARDING_STEP.PROFILE,
      4: ONBOARDING_STEP.KICKOFF_BOOKED,
      5: ONBOARDING_STEP.PARTNER_CALL_BOOKED,
      6: ONBOARDING_STEP.PILLARS_WATCHED,
      7: ONBOARDING_STEP.PARTNER_CALL_COMPLETED,
    };

    const updated = await tx
      .update(usersTable)
      .set({
        onboardingStep: sql`CASE ${usersTable.onboardingStep}
          WHEN 2 THEN ${ONBOARDING_STEP.PROFILE}
          WHEN 3 THEN ${ONBOARDING_STEP.PROFILE}
          WHEN 4 THEN ${ONBOARDING_STEP.KICKOFF_BOOKED}
          WHEN 5 THEN ${ONBOARDING_STEP.PARTNER_CALL_BOOKED}
          WHEN 6 THEN ${ONBOARDING_STEP.PILLARS_WATCHED}
          WHEN 7 THEN ${ONBOARDING_STEP.PARTNER_CALL_COMPLETED}
          ELSE ${usersTable.onboardingStep}
        END`,
      })
      .where(and(eq(usersTable.onboardingComplete, false), inArray(usersTable.onboardingStep, [2, 3, 4, 5, 6, 7])))
      .returning({ id: usersTable.id });
    
    let usersUpdated = updated.length;

    await tx
      .update(systemSettingsTable)
      .set({
        value: {
          completedAt: new Date().toISOString(),
          usersUpdated,
        },
      })
      .where(eq(systemSettingsTable.id, claimed[0].id));

    return { migrated: true, usersUpdated };
  });

  if (result.migrated) {
    console.log(
      `[Onboarding] Migrated ${result.usersUpdated} mid-flight member(s) from the old 7-step onboarding numbering to the new 6-step contract (ToS-signing step removed).`,
    );
  }

  return result;
}
