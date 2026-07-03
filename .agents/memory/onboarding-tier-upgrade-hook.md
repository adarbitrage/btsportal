---
name: Tier-aware onboarding completion + upgrade re-entry hook
description: How tier upgrades reopen onboarding, why completion effects fire idempotently, and the FK cleanup pitfall in tests that grant products.
---

Onboarding completion side-effects (cancelling `onboarding_frontend`/`onboarding_mentorship` sequences) fire exactly once per member via an `onboarding_effects` idempotency table (per-(member,effect) row). Completion for "full"/"launchpad" tiers enrolls the member in NOTHING — `nurture_frontend_to_upgrade` only fires at account-creation time for tier "none", and launchpad/YSE ("sequence 31") is never auto-enrolled at completion.

The upgrade hook lives at the single grant seam `insertUserProductGrant` (used by `handleExternalGrantProduct`, `checkout-core.ts`, and `ops.ts`). On tier elevation it flips `onboardingComplete=false` and resets the step to the first unsatisfied step, carrying forward already-satisfied steps (never restarts from step 1). `extendActiveGrantExpiry` must NEVER trigger this re-entry — it's a pure expiry extension, not a new grant.

**Why:** members who complete onboarding at a lower tier (e.g. launchpad) and then upgrade (e.g. to full) still need to complete the additional steps unique to the higher tier, without redoing steps they already satisfied.

**How to apply:** Any test that grants a product to a user via `insertUserProductGrant`/`handleExternalGrantProduct`/checkout/admin-panel/ops/GHL-webhook routes may now incidentally create `onboarding_effects`, `sequence_enrollments`, AND `partner_assignments` rows for that user (rank>=2 grants trigger the round-robin partner hook too). Test `afterAll` cleanup blocks that delete seeded users must delete all three (by `userId`/`memberId`) BEFORE deleting the `users` rows, or the delete fails with an FK violation (`onboarding_effects_user_id_fkey` / `sequence_enrollments_user_id_users_id_fk` / `partner_assignments_member_id_fkey`). This has bitten multiple pre-existing test files each time a new call site got routed through the seam — check every test file that seeds users through a grant path, not just the one you're actively editing.
