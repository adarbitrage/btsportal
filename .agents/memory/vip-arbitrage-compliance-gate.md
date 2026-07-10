---
name: VIP Arbitrage pitch slot compliance gate
description: How the 3rd email pitch slot (VIP Arbitrage, a Reg D 506(c) securities offering) is fail-closed gated separately from the tier/rank matrix.
---

Slot 3 (`VIP_ARBITRAGE_PITCH`, redefined from the retired BTS VIP tier pitch) is independent of BTS VIP tier rank — it renders
at every member rank (0 through 6+), gated only by two orthogonal things:
1. `isVipArbitrageMember` stub (mirrors `isMachineMember`, always false).
2. A `reviewed` compliance flag on the pitch content itself.

**Why:** securities marketing copy must never reach a member's inbox before
securities counsel explicitly signs off. Any ambiguous state — missing field,
stored `false`, a malformed non-boolean value, or a DB read failure that falls
back to shipped defaults — must resolve to "not reviewed" (fail closed), never
"reviewed" by accident.

**How to apply:** all rendering of this (or any future similarly-gated) pitch
block must go through one seam — `isPitchBlockReviewed()` /
`renderGatedPitchBlock()` in `pitch-resolver.ts` — never call the raw
`renderPitchBlock` directly for a gated key. Every blast/preview script must
be updated to use the same seam; a script that renders pitch content on its
own bypass path is a compliance hole.

**Visibility (compliance ask):** the gate's live-vs-suppressed state is a
compliance status, NOT a health problem — surfaces that show it (System Health
`vipArbitragePitch` block, the dedicated `vip_arbitrage_pitch_review_gate`
audit action written only when the flag actually flips) must never degrade
overall health status for "suppressed", and a status read failure must report
"suppressed" (mirror the send path's fail-closed behavior) so no surface ever
claims "live" while sends would suppress.
