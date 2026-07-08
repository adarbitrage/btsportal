---
name: KB review-gate risk analyzer
description: Review gate highlights risky passages; analyzer mirrors synthesis marker contract locally and must move in lockstep.
---

The review-and-publish gate (KnowledgeBaseReview detail dialog) shows a "Review focus" panel driven by a pure analyzer (`kb-review-risk.ts`) plus a `GET /:id/review-insights` route.

**Rule:** the analyzer locally mirrors the synthesis output contract — `SOURCE_CONFLICT_PREFIX` and the `[SITUATIONAL]` / `[CONTEXT-BOUND]` / `[ANOMALY]` bullet tags. Any change to kb-synthesis marker wording or tag set must update kb-review-risk (patterns + HIGHLIGHT_META) and its unit tests in the same change.

**Why:** a drift-guard test asserts the synthesis marker contains the prefix mirror, but new/renamed tags would silently pass review unhighlighted — the gate would look healthy while missing risks.

**How to apply:** touching SOURCE_CONFLICT_MARKER, FLAG_PRESERVATION_GUARD, or synthesis tag vocabulary → also update kb-review-risk.ts + kb-review-risk.test.ts. Also note: the 4 review-gate risk flags (source_conflict/situational_content/time_sensitive/privacy_residue) are computed at triage time in kb-flags; `source_conflict` blocks bulk confirm. Soften routes through the existing refine path; Cut is an exact-line removal via the editedContent PATCH (stale-line mismatch → refetch, no write).
