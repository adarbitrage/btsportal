---
name: Grant-repair candidate finder must not reuse partner-eligibility gates for variant resolution
description: a rank-floored eligibility helper meant for partner assignment silently excluded valid low-rank variant-resolution candidates; fixed by computing two separate ranks.
---

Onboarding-variant resolution and accountability-partner-assignment
eligibility are two *different* concepts that happen to both be phrased as
"is this product rank eligible?" — variant resolution has no minimum rank
(only an explicit exclusion list for pure-status products), while partner
assignment requires a minimum rank floor. Reusing the narrower,
floor-gated helper for the broader resolution decision silently drops any
member whose only active grant sits below that floor, even though the
live real-time re-entry hook would correctly elevate them.

**Why:** the two checks read as interchangeable ("is this rank eligible?")
but encode different business rules; borrowing one for the other's job
passes typecheck and looks reasonable in review, but produces wrong
results only for the specific low-rank case that never gets exercised by
higher-rank test fixtures.

**How to apply:** when writing any "recompute what state this member
should be in from their product ranks" logic, compute variant/state
resolution from raw rank + explicit-exclusion-list only, and keep a
separate, independently-computed rank for any partner-assignment (or
other narrower) eligibility decision. Never share one rank variable
between the two.
