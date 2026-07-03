// Tier resolver for the per-variant onboarding step contracts (Task #1640),
// plus the tier-aware upgrade re-entry hook (Task #1642 / TB1).
//
// Explicitly OUT of scope here (deferred to later tasks):
//   - kickoff-coach tiering (TA2)
//   - grandfathering existing members onto a resolved variant (TB2)
import { db, usersTable, userProductsTable, productsTable } from "@workspace/db";
import { eq, and, or, isNull, gte } from "drizzle-orm";
import { PRODUCT_RANK } from "./product-rank";
import { isSteppedVariant, getStepNames, type OnboardingVariant, type SteppedOnboardingVariant } from "./onboarding-steps";
import { enrollInSequence } from "./sequence-helpers";
import { claimOnboardingEffect, ONBOARDING_EFFECT } from "./onboarding-effects";

// Resolves the onboarding variant a member should follow based on the
// highest-ranked ACTIVE (non-expired) product they currently hold:
//   rank >= 2 (3month and up)         -> "full"
//   rank === 1 (launchpad)            -> "launchpad"
//   rank === 0 (frontend-only) or none -> "none"
//
// This is a LIVE computation over current product grants — it is used at
// creation time (see applyCreationTimeOnboardingDefaults below) to set the
// persisted usersTable.onboardingVariant, which is what routes/onboarding.ts
// actually reads from thereafter. Calling this again later for an existing
// member (e.g. to check "what would their variant be today") is safe and
// side-effect-free, but does NOT retroactively change their persisted variant
// — that re-entry/upgrade behavior belongs to a later task (TB1).
export async function resolveOnboardingVariant(userId: number): Promise<OnboardingVariant> {
  const now = new Date();
  const rows = await db
    .select({ slug: productsTable.slug })
    .from(userProductsTable)
    .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
    .where(
      and(
        eq(userProductsTable.userId, userId),
        eq(userProductsTable.status, "active"),
        or(isNull(userProductsTable.expiresAt), gte(userProductsTable.expiresAt, now)),
      ),
    );

  const maxRank = rows.reduce((max, row) => Math.max(max, PRODUCT_RANK[row.slug] ?? 0), -1);

  if (maxRank >= 2) return "full";
  if (maxRank === 1) return "launchpad";
  return "none";
}

// Called exactly once, right after a brand-new member's initial product
// grant(s) have been committed (ThriveCart webhook, external grant, or an
// admin creating a member with no products yet). Resolves the member's
// variant from their now-committed products and persists the corresponding
// creation-time onboarding state:
//   "none"               -> onboarding is skipped entirely: onboardingComplete
//                            is set true immediately, and the member is
//                            enrolled in the nurture_frontend_to_upgrade
//                            sequence so they still get nudged toward a paid
//                            tier even though they never see the wizard.
//   "launchpad" / "full" -> onboardingVariant is persisted (so routes/
//                            onboarding.ts knows which step array to use);
//                            onboardingStep/onboardingComplete are left at
//                            their table defaults (step 1, not complete).
//
// Safe to call for a user who already has onboardingComplete=true (e.g. a
// staff account created elsewhere) — it will simply persist whatever variant
// resolves and, for "none", re-affirm onboardingComplete=true (a harmless
// no-op update).
export async function applyCreationTimeOnboardingDefaults(userId: number): Promise<OnboardingVariant> {
  const variant = await resolveOnboardingVariant(userId);

  if (variant === "none") {
    await db
      .update(usersTable)
      .set({ onboardingVariant: "none", onboardingComplete: true })
      .where(eq(usersTable.id, userId));

    // Idempotency (Task #1642 / TB1): this is the ONLY place
    // nurture_frontend_to_upgrade is ever enrolled — completion no longer
    // fires it (see fireOnboardingCompletionEffects in
    // onboarding-advancement.ts). Guarded by a per-(member, effect) claim so
    // a re-run of this function for the same user (e.g. a retried webhook,
    // or a none-tier member who somehow re-enters this path) can never
    // double-enroll them.
    const claimed = await claimOnboardingEffect(userId, ONBOARDING_EFFECT.CREATION_NURTURE_FRONTEND_TO_UPGRADE);
    if (claimed) {
      try {
        await enrollInSequence(userId, "nurture_frontend_to_upgrade");
      } catch (err) {
        console.error(`[Onboarding] Failed to enroll new none-tier user ${userId} in nurture_frontend_to_upgrade:`, err);
      }
    } else {
      console.log(`[Onboarding] Creation-time nurture enrollment already fired for user ${userId}; skipping.`);
    }

    return variant;
  }

  await db.update(usersTable).set({ onboardingVariant: variant }).where(eq(usersTable.id, userId));
  return variant;
}

// Relative ordering of onboarding variants for upgrade-elevation comparisons.
// Mirrors PRODUCT_RANK's ordering at the onboarding-tier-bucket level (not
// the full per-product rank scale) — "none" < "launchpad" < "full". Exported
// so the repair endpoint (onboarding-grant-repair.ts, Task #1658) can reuse
// the exact same elevation comparison this hook uses.
export const VARIANT_RANK: Record<OnboardingVariant, number> = {
  none: 0,
  launchpad: 1,
  full: 2,
};

// Computes the first onboarding step (1-indexed) in `newVariant`'s step array
// that the member has NOT already satisfied, based on their prior variant's
// progress. Satisfied step names are derived from:
//   - every step strictly before their old `oldStep` (already passed), plus
//   - every step in the old variant's array if they'd fully completed it
//     (`oldComplete`).
// A "none"-variant member (never stepped) contributes an empty satisfied
// set, so they always land on the new variant's first step (welcome) —
// any already-filled profile data is naturally carried since it's never
// cleared, they simply breeze through step 2 when they reach it.
// A completed launchpad member carries {welcome, profile, kickoff_booked,
// pillars_watched} into "full", whose first NOT-satisfied step is
// partner_call_booked — landing them directly on "Book Partner Call".
export function computeUpgradeReentryStep(
  oldVariant: OnboardingVariant,
  oldStep: number,
  oldComplete: boolean,
  newVariant: SteppedOnboardingVariant,
): number {
  const satisfied = new Set<string>();
  if (isSteppedVariant(oldVariant)) {
    const oldStepNames = getStepNames(oldVariant);
    for (let i = 1; i < oldStep && i <= oldStepNames.length; i++) {
      satisfied.add(oldStepNames[i - 1]);
    }
    if (oldComplete) {
      for (const name of oldStepNames) satisfied.add(name);
    }
  }

  const newStepNames = getStepNames(newVariant);
  for (let i = 0; i < newStepNames.length; i++) {
    if (!satisfied.has(newStepNames[i])) return i + 1;
  }
  // Every named step in the new variant was already satisfied (shouldn't
  // happen for a genuine elevation since "full" is a strict superset of
  // "launchpad" plus extra steps) — fall back to the last step rather than
  // stepping out of bounds.
  return newStepNames.length;
}

/**
 * Upgrade re-entry hook (Task #1642 / TB1). Called at the grant seam — after
 * a product grant has committed — from both `insertUserProductGrant`
 * (NMI checkout, admin/ops grants) and `handleExternalGrantProduct` (the YSE
 * external grant path), the same seam the partner round-robin hook lives at.
 *
 * Re-resolves the member's live product-driven variant and compares it
 * against their currently PERSISTED variant. If the grant elevated their
 * tier bucket (none->launchpad, none->full, launchpad->full), forces
 * re-entry: flips `onboardingComplete` false and drops them at the first
 * unsatisfied step of the new variant (satisfied steps carried over from
 * their prior progress — see computeUpgradeReentryStep).
 *
 * A same-or-lower resolved bucket is a strict no-op: adding a lower-rank
 * product to an existing higher-tier member never regresses their variant
 * (resolveOnboardingVariant takes the MAX active rank), and this function is
 * only ever wired into NEW-grant code paths — never the grant-EXTENSION path
 * (renewals) or expiry — so a downgrade/expiry can never re-open onboarding.
 *
 * Never throws: a failure here must not block a purchase or admin grant from
 * completing, mirroring the non-fatal pattern used by
 * maybeAssignPartnerForGrant elsewhere in the grant path.
 */
export async function maybeForceOnboardingReentry(userId: number): Promise<void> {
  try {
    const [user] = await db
      .select({
        onboardingVariant: usersTable.onboardingVariant,
        onboardingStep: usersTable.onboardingStep,
        onboardingComplete: usersTable.onboardingComplete,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (!user) return;

    const oldVariant = (user.onboardingVariant as OnboardingVariant) ?? "full";
    const newVariant = await resolveOnboardingVariant(userId);

    if (VARIANT_RANK[newVariant] <= VARIANT_RANK[oldVariant]) return;
    if (!isSteppedVariant(newVariant)) return; // defensive — elevation always resolves to a stepped variant

    const newStep = computeUpgradeReentryStep(oldVariant, user.onboardingStep, user.onboardingComplete, newVariant);

    const updated = await db
      .update(usersTable)
      .set({ onboardingVariant: newVariant, onboardingStep: newStep, onboardingComplete: false })
      .where(and(eq(usersTable.id, userId), eq(usersTable.onboardingVariant, oldVariant)))
      .returning({ id: usersTable.id });

    if (updated.length > 0) {
      console.log(
        `[Onboarding] User ${userId} upgraded onboarding variant "${oldVariant}" -> "${newVariant}"; forced re-entry at step ${newStep}.`,
      );
    }
  } catch (err) {
    console.error(`[Onboarding] Failed to evaluate upgrade re-entry for user ${userId}:`, err);
  }
}
