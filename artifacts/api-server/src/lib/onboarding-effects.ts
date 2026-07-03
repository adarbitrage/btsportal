// Per-(member, effect) idempotency ledger for one-time onboarding side
// effects (Task #1642 / TB1) — e.g. the creation-time
// nurture_frontend_to_upgrade enrollment and the completion-time sequence
// cancellation. Backed by onboarding_effects, which has a UNIQUE(user_id,
// effect) constraint; claiming is a plain insert with onConflictDoNothing,
// so concurrent/retried callers race safely and only one ever "wins".
import { db, onboardingEffectsTable } from "@workspace/db";

export const ONBOARDING_EFFECT = {
  CREATION_NURTURE_FRONTEND_TO_UPGRADE: "creation_nurture_frontend_to_upgrade",
  COMPLETION_CANCEL_SEQUENCES: "completion_cancel_sequences",
} as const;

export type OnboardingEffectName = (typeof ONBOARDING_EFFECT)[keyof typeof ONBOARDING_EFFECT];

/**
 * Attempts to claim a one-time effect for a given member. Returns `true` if
 * this call is the one that claimed it (the caller should proceed to fire
 * the effect), or `false` if it was already claimed previously (the caller
 * should skip firing it again).
 */
export async function claimOnboardingEffect(userId: number, effect: OnboardingEffectName): Promise<boolean> {
  const inserted = await db
    .insert(onboardingEffectsTable)
    .values({ userId, effect })
    .onConflictDoNothing()
    .returning({ id: onboardingEffectsTable.id });
  return inserted.length > 0;
}
