import { db, usersTable, systemSettingsTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { cancelSequence } from "./sequence-helpers";
import { claimOnboardingEffect, ONBOARDING_EFFECT } from "./onboarding-effects";

// Internal, server-only advancement functions for the onboarding contract's
// EVENT-ADVANCED steps (Task #1666: the old trailing pillars_watched +
// partner_call_completed steps were collapsed into a single client-advanceable
// `send_off` step — see onboarding-steps.ts for the full per-variant step
// name arrays). These are the ONLY legitimate way a member moves off steps 3
// or 4 — PATCH /members/me/onboarding explicitly rejects client-driven
// attempts to complete these steps (see CLIENT_ADVANCEABLE_STEPS in
// routes/onboarding.ts).
//
// Intended callers (hooks only):
//   - advanceOnboardingAfterKickoffBooked      — Tier 2 kickoff-call booking flow
//   - advanceOnboardingAfterPartnerCallBooked  — Tier 2 partner-call booking flow
//
// Onboarding COMPLETION itself is no longer triggered by any webhook or
// internal event function for either variant — `send_off` is the final step
// for both "full" and "launchpad" and is completed the same way any other
// client-advanceable step is: a direct member PATCH, handled generically by
// the isLastStep branch of PATCH /members/me/onboarding, which calls
// fireOnboardingCompletionEffects() below. The GHL "first partner call
// completed" webhook (webhooks-ghl.ts) still flows through
// partner-call-completion.ts to flip the booking's own status, but it no
// longer completes or advances onboarding at all (Task #1666).
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
  SEND_OFF: 5,
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
// Advances step 4 -> 5 (send_off). NO-OP for "launchpad" variant members —
// LaunchPad has no partner-call step at all, so step 4 for them means
// send_off (a client-advanceable step handled entirely by PATCH
// /members/me/onboarding, never by this function).
export async function advanceOnboardingAfterPartnerCallBooked(userId: number): Promise<boolean> {
  const [user] = await db.select({ onboardingVariant: usersTable.onboardingVariant }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user || user.onboardingVariant !== "full") return false;

  const advanced = await advanceIfOnStep(userId, ONBOARDING_STEP.PARTNER_CALL_BOOKED, ONBOARDING_STEP.SEND_OFF);
  if (advanced) {
    console.log(`[Onboarding] User ${userId} advanced to step ${ONBOARDING_STEP.SEND_OFF} (partner call booked).`);
  }
  return advanced;
}

// Shared, tier-aware onboarding-completion side effects (Task #1642 / TB1).
// Called for BOTH variants the moment a member finishes onboarding — since
// Task #1666, `send_off` is the final, client-advanceable step for both
// "full" and "launchpad", so completion for both now flows exclusively
// through the generic isLastStep branch of PATCH /members/me/onboarding
// (routes/onboarding.ts). No webhook or internal event function completes
// onboarding anymore.
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
// for the same member (e.g. the same member later re-completing a HIGHER
// variant after an upgrade re-entry) only ever fires the sequence
// cancellation once — cancelSequence itself is safe to call repeatedly, but
// this keeps the effect ledger authoritative and avoids redundant work.
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
// 6-step contract, and then the current 5-step (full) / 4-step (launchpad)
// send_off contract — members who never received this remap still need it
// BEFORE the later remaps run, since each remap's OLD_TO_NEW map assumes the
// immediately-preceding contract's numbering as its starting point. Boot
// order (see bootstrap-critical-prerequisites.ts) runs these in historical
// order.
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
// (now superseded) 6-step contract for members who were mid-onboarding when
// the ToS step was removed (Task #1624):
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
// through 7 is REUSED in a later contract with a different meaning, so a
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
//
// Kept (even though the 6-step contract has itself since been superseded by
// the current send_off contract — see migrateOnboardingStepsToSendOffContract
// below) for the same reason migrateOnboardingStepsToSevenStepContract is
// kept: members who never received THIS remap still need it before the
// send_off remap runs, since that remap's map assumes 6-step numbering as its
// starting point.
const MIGRATION_MARKER_KEY = "onboarding_v3_step_migration_completed_at";

// Literal historical step-name constants used only by the migration below.
// These intentionally do NOT reference ONBOARDING_STEP, whose numbering has
// since moved on — the migration must keep meaning exactly what it always
// has, frozen to the 6-step contract's numbering.
const SIX_STEP_CONTRACT = {
  PROFILE: 2,
  KICKOFF_BOOKED: 3,
  PARTNER_CALL_BOOKED: 4,
  PILLARS_WATCHED: 5,
  PARTNER_CALL_COMPLETED: 6,
} as const;

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
    const updated = await tx
      .update(usersTable)
      .set({
        onboardingStep: sql`CASE ${usersTable.onboardingStep}
          WHEN 2 THEN ${SIX_STEP_CONTRACT.PROFILE}
          WHEN 3 THEN ${SIX_STEP_CONTRACT.PROFILE}
          WHEN 4 THEN ${SIX_STEP_CONTRACT.KICKOFF_BOOKED}
          WHEN 5 THEN ${SIX_STEP_CONTRACT.PARTNER_CALL_BOOKED}
          WHEN 6 THEN ${SIX_STEP_CONTRACT.PILLARS_WATCHED}
          WHEN 7 THEN ${SIX_STEP_CONTRACT.PARTNER_CALL_COMPLETED}
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
      `[Onboarding] Migrated ${result.usersUpdated} mid-flight member(s) from the old 7-step onboarding numbering to the (now superseded) 6-step contract (ToS-signing step removed).`,
    );
  }

  return result;
}

// One-time, idempotent mid-flight migration collapsing the old 6-step
// contract's two trailing steps — pillars_watched (5) and
// partner_call_completed (6) — onto the current single `send_off` step
// (Task #1666: "Onboarding send-off video ending"). LAUNCHPAD is NOT
// affected: its old step 4 (pillars_watched) and the new step 4 (send_off)
// share the same numeric value, so a launchpad member sitting on step 4
// simply sees the new send_off page in place of the old pillars page with no
// row change required — only FULL-variant rows at old step 5 or 6 need a
// remap.
//
// Members who complete their booked-call summary click through send_off
// exactly like any other client-advanceable step (see the isLastStep branch
// of PATCH /members/me/onboarding) — this migration only repositions
// mid-flight members onto the new step number, it does not complete anyone's
// onboarding.
//
// Completed members (onboardingComplete = true) are never touched — a
// full-tier member already stamped onboardingComplete=true at old step 6
// keeps that historical step value forever, exactly like every earlier
// migration in this file.
const SEND_OFF_MIGRATION_MARKER_KEY = "onboarding_v4_send_off_step_migration_completed_at";
const OLD_SIX_STEP_PILLARS_WATCHED = 5;
const OLD_SIX_STEP_PARTNER_CALL_COMPLETED = 6;

export async function migrateOnboardingStepsToSendOffContract(): Promise<{
  migrated: boolean;
  usersUpdated: number;
}> {
  const result = await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(systemSettingsTable)
      .values({
        key: SEND_OFF_MIGRATION_MARKER_KEY,
        value: { startedAt: new Date().toISOString() },
        category: "onboarding",
        description:
          "One-time marker for the 6-step -> send_off onboarding contract migration (Task #1666: pillars_watched + partner_call_completed collapsed into a single send_off step). Presence of this row means the old-step -> new-step remap has already run and must never run again.",
      })
      .onConflictDoNothing()
      .returning({ id: systemSettingsTable.id });

    if (claimed.length === 0) {
      return { migrated: false, usersUpdated: 0 };
    }

    const updated = await tx
      .update(usersTable)
      .set({ onboardingStep: ONBOARDING_STEP.SEND_OFF })
      .where(
        and(
          eq(usersTable.onboardingComplete, false),
          eq(usersTable.onboardingVariant, "full"),
          inArray(usersTable.onboardingStep, [OLD_SIX_STEP_PILLARS_WATCHED, OLD_SIX_STEP_PARTNER_CALL_COMPLETED]),
        ),
      )
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
      `[Onboarding] Migrated ${result.usersUpdated} mid-flight full-tier member(s) from the old pillars_watched/partner_call_completed steps to the new send_off step.`,
    );
  }

  return result;
}
