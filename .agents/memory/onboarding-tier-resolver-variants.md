---
name: Onboarding tier resolver + variant step arrays
description: How member onboarding variant (none/launchpad/full) is resolved, persisted, and consumed — and what's deliberately deferred.
---

Onboarding has three tiers, resolved from the member's highest-ranked ACTIVE
(non-expired) product grant at account-creation time only:
- rank >= 2 (3month+) -> "full" (6 steps, unchanged legacy flow)
- rank === 1 (launchpad) -> "launchpad" (4 steps: welcome, profile,
  kickoff_booked, pillars_watched — no partner call)
- rank === 0 / no active product -> "none" (onboarding is skipped entirely;
  onboardingComplete=true immediately, member enrolled in
  nurture_frontend_to_upgrade)

**Why:** frontend-only/free members shouldn't see a wizard demanding paid-tier
actions (booking coach calls); launchpad members don't get a partner call at
all, only kickoff.

**How to apply:**
- `resolveOnboardingVariant(userId)` (api-server `lib/onboarding-variant.ts`)
  is a live, side-effect-free computation — safe to call anytime, but does
  NOT retroactively change a member's persisted variant.
- `applyCreationTimeOnboardingDefaults(userId)` is the only thing that
  persists `users.onboardingVariant` and must be called exactly once, right
  after a new member's initial product grant(s) commit. Call sites: ThriveCart
  webhook handler, external-grant-product, admin-panel member creation.
- `users.onboardingVariant` defaults to `'full'` at the DB level — this is
  the deliberate fallback for every pre-existing member (predates the
  column) and any frontend render before the auth payload settles. Both
  backend (`onboarding-steps.ts`) and frontend
  (`OnboardingLayout.tsx`/`App.tsx`) independently default undefined/unknown
  variant to "full" — no shared step-contract package between portal and
  api-server, so the step-name arrays are deliberately duplicated in both
  places and must be kept in lockstep by hand.
- Deliberately NOT implemented (tracked as separate follow-on work, look for
  active tasks before redoing): tier-aware kickoff-coach routing, re-running
  the resolver on a mid-flow upgrade (variant is locked in at creation only),
  and backfilling a real variant onto members created before this feature
  existed (they all silently sit at the 'full' default).
- Route guards must resolve a step's position by NAME against the user's own
  variant array, never by a static numeric index — a step-number prop baked
  into the route table deadlocks any variant whose array is shorter/reordered
  vs. the array the numbers were written against. Pass `stepName`, look up
  `getStepNamesForVariant(variant).indexOf(stepName)+1` at render time.
- `applyCreationTimeOnboardingDefaults` must be called from EVERY member-
  creation path, including self-serve /auth/register — it's easy to wire it
  into webhook/admin-grant flows and forget the plain registration path,
  silently skipping variant resolution + 'none'-tier nurture enrollment for
  that path.
