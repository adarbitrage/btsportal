---
name: VIP pure-status product mechanics
description: How the VIP status product is sold and excluded from mentorship/partner logic
---

VIP is a pure status product: it carries only a status entitlement (a badge/level upgrade) and confers no
coaching, partner, or onboarding access on its own. It ranks above lifetime in the product-rank ordering purely
for level-badge/content-access display purposes.

There is no standalone VIP checkout path. An admin always grants VIP together with the annual mentorship product
via the same shared grant seam used by every other purchase path, as two separate grant rows with independent
expiry clocks — they are not linked, and one can outlive the other.

**Why:** VIP needed to slot in as a level/badge above the top mentorship tier without accidentally granting
mentorship/partner access on its own, and without a second checkout implementation. Reusing the existing
multi-call admin grant flow and per-row expiry model meant no new sales code path was needed.

**How to apply:**
- Any rank-based mentorship/partner-eligibility check must exclude the status product's rank via a single shared
  exclusion list reused everywhere such a check happens. Do not gate by "rank >= N" alone — a badge-only product
  ranked above real tiers will wrongly look like the top tier under a naive threshold check. Exclude the slug
  entirely from the max-rank calculation instead, and repair/backfill tooling that recomputes rank must use the
  exact same exclusion, not a separate maxRank field.
- If the accompanying mentorship grant expires while the status grant is still active, the member keeps the
  status entitlement but loses partner assignment and onboarding tier, since the status product alone never
  counts toward those checks.
- Granting a strictly higher-tier product later as an upsell onto an existing status+mentorship member must not
  re-open onboarding or duplicate the partner assignment — both hooks are already no-ops once a member is at/above
  the resolved tier or already has an active assignment.
- When a badge surfaces the "accompanying grant's expiry" and a member could hold more than one active row for
  that product (e.g. a manual re-grant before the prior one expired), take the max/latest expiry deterministically
  — never whichever row a query happens to return last.
- Any new entitlement key added for a product like this also needs a matching seed metadata row (see
  entitlement-key-exhaustive-metadata.md) — easy to forget since only typechecking catches the omission.
