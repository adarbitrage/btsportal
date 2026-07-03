---
name: Onboarding step contract (now 6 steps)
description: How the BTS Member Portal onboarding flow enforces event-advanced steps and mid-flight migration when the step count/contract changes.
---

**Current contract (6 steps, as of the ToS-signing-step removal):** 1 welcome, 2 profile, 3 kickoff_booked, 4 partner_call_booked, 5 pillars_watched, 6 partner_call_completed. The Documents/ToS-signing step was removed entirely (profile-fields gate now guards step 2); the platform ToS is reached via a portal footer browsewrap link instead, no signature required. `CLIENT_ADVANCEABLE_STEPS = {1, 2, 5}`. A second claim-row migration (distinct key from the original 7-step one) remaps mid-flight members from the old 7-step numbering: 1→1, 2→2, 3→2, 4→3, 5→4, 6→5, 7→6.

Client-driven step advancement (PATCH /members/me/onboarding) only covers a subset of steps (welcome/ToS/profile/click-through); steps that represent something happening elsewhere (booking a call, a call actually occurring) are advanced ONLY by internal server functions, never by the client PATCH — the route explicitly rejects attempts to skip to those step numbers.

**Why:** onboarding progress must reflect real-world events (a call was booked, a call happened), not just "the member clicked next" — otherwise a member could self-report completion of things that didn't happen. The internal advancement functions are also written as no-ops (return false, never throw) unless the member is exactly on the expected prior step and not already complete, so they're safe for webhook retries/replays/out-of-order delivery.

**How to apply:** when adding a new onboarding step that represents an external event, add it to a "server-only advancement" module (not the client-facing PATCH allowlist), and make the advancement function idempotent/no-op on unexpected state rather than throwing.

Renumbering the step contract (e.g. changing how many steps exist, or what a given step number means) requires a one-time idempotent migration for mid-flight members, guarded by a claim-row (e.g. in a settings/marker table via an atomic insert-if-absent), not a "value already looks migrated" check — because old and new contracts can reuse the same step numbers with different meanings, making a plain value-based idempotency check ambiguous after the first run. Completed members should be left untouched entirely. Wire the migration into the server boot sequence (not a manual script) since prod can only be reached via code that runs on deploy/boot.

Content pages gated by an onboarding-completion route guard (e.g. redirect-to-onboarding while incomplete) can create a dead-end loop if a mid-onboarding step links out to that same gated content as a "preview" CTA — check the guard's exact condition before wiring such a link.
