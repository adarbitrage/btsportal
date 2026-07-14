---
name: Email pitch resolver seam
description: How the tier-based upgrade pitch stack gets injected into lifecycle emails, and the gotchas around it.
---

The `{{pitch_block_html}}` slot (in the branded email layout) is filled at
send time, not template-author time, via a single seam in
`communication-service.ts`: a `resolvePitchBlockHtmlForSend` helper called
from both `queueEmail` and `sendEmailNow`, right before `getCommonVariables`.

**Why a single seam (not per-caller):** queueEmail and sendEmailNow are the
only two entry points that actually render and dispatch an email — wiring the
resolver anywhere else risks a lifecycle send skipping the pitch or a
marketing send accidentally getting one.

**Skip conditions (in order), all evaluated in the helper itself:**
- `pitch_block_html` already present in the caller-supplied `variables` (lets
  a caller override/suppress explicitly).
- no `userId` on the send (can't rank an anonymous recipient).
- `category === "marketing"` (pitches are lifecycle-only by design).
- resolver throws → treated as empty string (never blocks a send).

**Rank resolution is DB-fresh per send** (no caching of the member's rank —
only the *content* of each pitch block is cached, via
`pitch-content-settings.ts`, admin-editable through `system_settings` rows so
copy changes need no deploy).

**Both membership flags are real DB checks** on active, non-expired product
grants: `isVipArbitrageMember` reads `vip_arbitrage` grants (see
vip-arbitrage-compliance-gate.md) and `isMachineMember` reads `machine`
grants (a rank-0, zero-entitlement membership product boot-seeded by
seed-machine-membership-product.ts, granted via the `machine`/`the_machine`
Machine-pipeline keys or an admin grant). Owning a Machine BRAND front-end
(backroad, offmarket, etc.) is deliberately NOT Machine membership — those
buyers stay in the Machine pitch audience.

**Testing gotcha:** integration tests that seed a user + send an email via
`CommunicationService` must delete `communication_log` rows for that user
BEFORE deleting the user row in teardown, or cleanup fails on the
`communication_log_user_id_users_id_fk` constraint.
