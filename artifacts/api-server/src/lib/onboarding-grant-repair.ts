/**
 * Repair mechanism for members whose product grant bypassed the shared grant
 * seam (Task #1658) — the admin member-detail grant route and the GHL
 * `manual_upgrade_<slug>` webhook path both used to raw-insert into
 * `user_products`, silently skipping `maybeForceOnboardingReentry` (TB1
 * variant re-resolve + onboarding re-entry) and `maybeAssignPartnerForGrant`
 * (round-robin accountability partner). Both call sites are now routed
 * through `insertUserProductGrant`; this module lets an operator repair the
 * historical members those bypasses left behind.
 *
 * A "repair candidate" is any member whose LIVE resolved onboarding variant
 * (from their current active grants) outranks their PERSISTED variant — the
 * exact same elevation check `maybeForceOnboardingReentry` already performs
 * per-user at the grant seam. Re-running that hook here is what actually
 * fixes the state; this module's job is to find who needs it, without ever
 * touching `grandfathered=true` members (their onboarding fields are
 * deliberately frozen — see the separate partner-backfill effort for their
 * missing partner assignments).
 */
import { db, usersTable, userProductsTable, productsTable } from "@workspace/db";
import { eq, and, or, isNull, gte } from "drizzle-orm";
import { PRODUCT_RANK } from "./product-rank";
import { VARIANT_RANK, maybeForceOnboardingReentry } from "./onboarding-variant";
import type { OnboardingVariant } from "./onboarding-steps";
import { assignRoundRobin, getActiveAssignment, isPartnerEligibleRank } from "./partner-assignment";

export interface OnboardingRepairCandidate {
  userId: number;
  email: string;
  grandfathered: boolean;
  persistedVariant: OnboardingVariant;
  resolvedVariant: OnboardingVariant;
  onboardingCompleteBefore: boolean;
  maxActiveProductRank: number;
  /** True if resolving this candidate would also fire partner assignment. */
  wouldAssignPartner: boolean;
}

function resolveVariantFromRank(maxRank: number): OnboardingVariant {
  if (maxRank >= 2) return "full";
  if (maxRank === 1) return "launchpad";
  return "none";
}

/**
 * Scans every member holding at least one active (non-expired) product grant
 * and returns those whose persisted `onboardingVariant` is BEHIND what their
 * current grants resolve to — i.e. exactly the members `maybeForceOnboardingReentry`
 * would elevate if it were run for them today. Read-only; makes no writes.
 */
export async function findOnboardingRepairCandidates(): Promise<OnboardingRepairCandidate[]> {
  const now = new Date();
  const rows = await db
    .select({
      userId: usersTable.id,
      email: usersTable.email,
      grandfathered: usersTable.grandfathered,
      onboardingVariant: usersTable.onboardingVariant,
      onboardingComplete: usersTable.onboardingComplete,
      slug: productsTable.slug,
    })
    .from(userProductsTable)
    .innerJoin(usersTable, eq(userProductsTable.userId, usersTable.id))
    .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
    .where(
      and(
        eq(userProductsTable.status, "active"),
        or(isNull(userProductsTable.expiresAt), gte(userProductsTable.expiresAt, now)),
      ),
    );

  interface Agg {
    email: string;
    grandfathered: boolean;
    onboardingVariant: string | null;
    onboardingComplete: boolean;
    maxRank: number;
  }
  const byUser = new Map<number, Agg>();
  for (const row of rows) {
    const rank = PRODUCT_RANK[row.slug] ?? 0;
    const existing = byUser.get(row.userId);
    if (!existing) {
      byUser.set(row.userId, {
        email: row.email,
        grandfathered: row.grandfathered,
        onboardingVariant: row.onboardingVariant,
        onboardingComplete: row.onboardingComplete,
        maxRank: rank,
      });
    } else {
      existing.maxRank = Math.max(existing.maxRank, rank);
    }
  }

  const candidates: OnboardingRepairCandidate[] = [];
  for (const [userId, info] of byUser) {
    const persisted = (info.onboardingVariant as OnboardingVariant) ?? "full";
    const resolved = resolveVariantFromRank(info.maxRank);
    if (VARIANT_RANK[resolved] <= VARIANT_RANK[persisted]) continue;

    const partnerEligible = isPartnerEligibleRank(info.maxRank);
    const existingAssignment = partnerEligible ? await getActiveAssignment(userId) : null;

    candidates.push({
      userId,
      email: info.email,
      grandfathered: info.grandfathered,
      persistedVariant: persisted,
      resolvedVariant: resolved,
      onboardingCompleteBefore: info.onboardingComplete,
      maxActiveProductRank: info.maxRank,
      wouldAssignPartner: partnerEligible && !existingAssignment,
    });
  }

  return candidates;
}

export interface OnboardingRepairOutcome {
  userId: number;
  email: string;
  persistedVariantBefore: OnboardingVariant;
  resolvedVariant: OnboardingVariant;
  onboardingVariantAfter: OnboardingVariant;
  partnerAssigned: boolean;
}

/**
 * Confirmed-mode repair: for each non-grandfathered candidate, re-runs
 * `maybeForceOnboardingReentry` (the exact hook the bypassed grants missed)
 * and, when the candidate's grant rank warrants it, `assignRoundRobin`
 * (idempotent — a no-op if the member already holds an active assignment).
 * Never touches `grandfathered=true` rows.
 */
export async function repairOnboardingCandidates(
  candidates: OnboardingRepairCandidate[],
): Promise<OnboardingRepairOutcome[]> {
  const outcomes: OnboardingRepairOutcome[] = [];
  for (const candidate of candidates) {
    if (candidate.grandfathered) continue;

    await maybeForceOnboardingReentry(candidate.userId);

    let partnerAssigned = false;
    if (isPartnerEligibleRank(candidate.maxActiveProductRank)) {
      const result = await assignRoundRobin(candidate.userId);
      partnerAssigned = result.assigned;
    }

    const [after] = await db
      .select({ onboardingVariant: usersTable.onboardingVariant })
      .from(usersTable)
      .where(eq(usersTable.id, candidate.userId))
      .limit(1);

    outcomes.push({
      userId: candidate.userId,
      email: candidate.email,
      persistedVariantBefore: candidate.persistedVariant,
      resolvedVariant: candidate.resolvedVariant,
      onboardingVariantAfter: (after?.onboardingVariant as OnboardingVariant) ?? candidate.persistedVariant,
      partnerAssigned,
    });
  }
  return outcomes;
}
