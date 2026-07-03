// Per-tier onboarding step-contract arrays (Task #1640).
//
// A member's onboarding "variant" determines which step-name array (and
// therefore total step count / client-advanceable set) applies to them. The
// variant is resolved once at creation time (see resolveOnboardingVariant in
// onboarding-variant.ts) and persisted on usersTable.onboardingVariant — it is
// NOT recomputed live on every request, so an in-flight member's step array
// never silently reshuffles mid-onboarding.
//
//   "full"      — the original 6-step contract. Numbering is UNCHANGED from
//                 before this task so the frozen historical migration
//                 functions in onboarding-advancement.ts (which are pinned to
//                 literal step numbers) remain correct without modification.
//   "launchpad" — a 4-step contract for LaunchPad-tier members: welcome,
//                 profile, kickoff_booked, pillars_watched. There is no
//                 accountability-partner-call step at all for this tier —
//                 finishing pillars_watched (a client-advanceable step, unlike
//                 its full-tier counterpart) completes onboarding directly.
//   "none"      — no guided onboarding at all. Members with this variant have
//                 onboardingComplete set true at creation and never enter the
//                 routes below (see applyCreationTimeOnboardingDefaults).
export type OnboardingVariant = "none" | "launchpad" | "full";

// Variants that actually walk a step array. "none" deliberately has no entry
// here — callers must branch on it before touching STEP_NAMES.
export type SteppedOnboardingVariant = "launchpad" | "full";

export const FULL_STEP_NAMES = [
  "welcome",
  "profile",
  "kickoff_booked",
  "partner_call_booked",
  "pillars_watched",
  "partner_call_completed",
] as const;

export const LAUNCHPAD_STEP_NAMES = ["welcome", "profile", "kickoff_booked", "pillars_watched"] as const;

export const VARIANT_STEP_NAMES: Record<SteppedOnboardingVariant, readonly string[]> = {
  full: FULL_STEP_NAMES,
  launchpad: LAUNCHPAD_STEP_NAMES,
};

// 1-indexed step numbers a member may complete themselves via
// PATCH /members/me/onboarding. Every step NOT in this set only ever advances
// via an internal event-advancement function (a real booking or webhook).
//   full:      3 (kickoff_booked) and 4 (partner_call_booked) are event-only;
//              6 (partner_call_completed) is event-only.
//   launchpad: 3 (kickoff_booked) is event-only. Step 4 (pillars_watched) is
//              the LAST step and IS client-advanceable — completing it
//              completes onboarding directly (no partner-call tier exists).
export const VARIANT_CLIENT_ADVANCEABLE_STEPS: Record<SteppedOnboardingVariant, ReadonlySet<number>> = {
  full: new Set([1, 2, 5]),
  launchpad: new Set([1, 2, 4]),
};

export function isSteppedVariant(variant: OnboardingVariant): variant is SteppedOnboardingVariant {
  return variant === "full" || variant === "launchpad";
}

export function getStepNames(variant: SteppedOnboardingVariant): readonly string[] {
  return VARIANT_STEP_NAMES[variant];
}

export function getTotalSteps(variant: SteppedOnboardingVariant): number {
  return VARIANT_STEP_NAMES[variant].length;
}

export function isClientAdvanceableStep(variant: SteppedOnboardingVariant, step: number): boolean {
  return VARIANT_CLIENT_ADVANCEABLE_STEPS[variant].has(step);
}

export function getStepNameAt(variant: SteppedOnboardingVariant, step: number): string | undefined {
  return VARIANT_STEP_NAMES[variant][step - 1];
}
