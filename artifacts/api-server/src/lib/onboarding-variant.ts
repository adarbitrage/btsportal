// Tier resolver for the per-variant onboarding step contracts (Task #1640).
//
// Explicitly OUT of scope here (deferred to later tasks):
//   - kickoff-coach tiering (TA2)
//   - tier-aware completion side effects / idempotency / upgrade re-entry
//     hook (TB1)
//   - grandfathering existing members onto a resolved variant (TB2)
import { db, usersTable, userProductsTable, productsTable } from "@workspace/db";
import { eq, and, or, isNull, gte } from "drizzle-orm";
import { PRODUCT_RANK } from "./product-rank";
import type { OnboardingVariant } from "./onboarding-steps";
import { enrollInSequence } from "./sequence-helpers";

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

    try {
      await enrollInSequence(userId, "nurture_frontend_to_upgrade");
    } catch (err) {
      console.error(`[Onboarding] Failed to enroll new none-tier user ${userId} in nurture_frontend_to_upgrade:`, err);
    }

    return variant;
  }

  await db.update(usersTable).set({ onboardingVariant: variant }).where(eq(usersTable.id, userId));
  return variant;
}
