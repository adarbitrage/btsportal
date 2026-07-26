---
name: KB near-miss retrieval band (chat only)
description: Three-state retrieval outcome for chat — calibrated 0.40–0.50 semantic band, operations-root exclusion, checklist≠Blitz guardrail.
---

# Chat near-miss band + checklist/Blitz namespace guardrail

- Retrieval is now three-state (`outcome: confident | near_miss | no_match`) from `retrieveSurfaceAware`; the band [`SEMANTIC_NEAR_MISS_FLOOR` 0.40, 0.50) is **opt-in per caller** via `nearMissBand: true` — ONLY the chat route sets it. Voice and all other callers stay binary; a source-level guard test (kb-near-miss-band.test.ts) enforces no other caller opts in.
- **Why:** vague in-scope questions ("i dont understand angles", sem 0.4547) retrieved the right docs but got pointer-only deflection; 47-query sweep set 0.40 = max(out-of-scope 0.384) + margin. Calibration was chat-phrasing only — extending to voice requires recalibration on voice queries.
- High-stakes exclusion: `home_root='operations'` docs never enter the band (band-eligible score computed excluding them). No hedged policy/refund/pricing answers, ever.
- Semantic-layer-down (score 0) → band never fires; NO lexical near-miss rescue by design.
- Chat near-miss emits a distinct "Close match" note (NEAR_MISS_NOTE in routes/chat.ts) — never the byte-identical NO_MATCH_NOTE. Rule 8 clause (c) + pointer tiers; hedged answer counts as a consumed ladder step. Sentinels NEAR_MISS_CLOSE_MATCH_SENTINEL + CHECKLIST_NOT_BLITZ_SENTINEL ride the 3-place lockstep.
- Content-gap capture still fires on near-miss, tagged via `near_miss_rescued` column — NEVER by altering normalized_question (the dedup key; forking it splits demand counts).
- Checklist ≠ Blitz: roadmap spine has CAMPAIGN_SPINE_NAMESPACE_GUARDRAIL preamble (step titles are chronology markers, never Blitz sections/pages/locations); Rule 17 carries the matching clause. Blitz section names may only come from Blitz Guide Locations blocks.
- **How to apply:** any band/floor change must update kb-near-miss-calibration.test.ts (labeled classes) + kb-semantic-calibration.test.ts (in-scope now asserts outcome != no_match under the band). Corpus drift breaking these suites is the intended alarm.
