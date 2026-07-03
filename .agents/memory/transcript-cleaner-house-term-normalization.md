---
name: Transcript Cleaner BTS house-term normalization
description: How near-miss BTS proprietary tool names are auto-corrected deterministically without clobbering member terms
---

BTS proprietary tools are a CLOSED, BTS-owned set (DIYTrax, MetricMover, Flexy, PixelPress, NoEscape, CropBot, ScrapeBot, Gifster, MediaMavens). Because members never coin brands that collide with these, a near-miss of one ("Flexi"→"Flexy") is safe to correct aggressively — the opposite of a member's own niche proper noun (tidy typos only, never force onto a house spelling).

**The set is derived, not hardcoded:** `loadBtsHouseTerms()` scans glossary.txt rows whose notes/definition cells contain "bts proprietary". Single source of truth; add `EXTRA_BTS_HOUSE_TERMS` only for house apps NOT in the glossary.

**Two mechanisms, prompt-first + deterministic backstop:**
- Prompt tier: `BTS_HOUSE_TERM_GUIDANCE` (built from the live set) is injected into the clean system prompt (item 3), the per-chunk user message, and BOTH refine prompts, teaching the house-vs-member tier.
- Deterministic backstop: `normalizeBtsHouseTerms(text)` runs AFTER the LLM on the assembled clean body (wrapped inside `scrubPrivateContent(normalizeBtsHouseTerms(...))`) and in `buildRefineResult` (covers patch + full refine). Pure + idempotent.

**normalizeBtsHouseTerms passes:**
1. `BTS_TERM_ALIASES` — explicit editable misspelling→canonical map, whole-word/phrase, case-insensitive, longest-key-first. This is the self-healing hook (add one line per observed miss). NEVER add an ordinary English word/phrase as a key ("no escape" was deliberately excluded — it would clobber prose). Aliases may map to non-house canonicals too (e.g. Catapiller→Caterpillar, a traffic source).
2. Near-miss single-token: only against the closed house set. Guards that prevent false positives: same first letter; short term (≤8) accepts EQUAL-LENGTH substitution only (so "flex" is never coerced to "Flexy"); longer coined term allows one indel (dist≤2); house terms <5 chars never near-missed; token <4 chars skipped.

**Why the guards matter:** the whole point is aggressive correction of the closed set WITHOUT touching member niche terms or ordinary words. The equal-length-substitution rule for short terms is what blocks pure-deletion collisions with common words.

Tests: `src/__tests__/transcript-cleaner-house-terms.test.ts` (pure-function, no DB). Run with `SKIP_DEV_DB_SYNC=1 npx vitest run <file> --pool=threads --no-file-parallelism` (the api-server globalSetup DB push otherwise hangs in the agent shell).
