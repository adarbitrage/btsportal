---
name: Transcript Cleaner flag contract
description: Why the transcript cleaner emits only two flag types and auto-corrects proper nouns instead of flagging them.
---

The Transcript Cleaner (AI cleaning of stitched call transcripts) exists ONLY to make a
transcript "good enough to mine" as AI source-knowledge for the downstream Live AI Document
pipeline. It is not a proofreader. Two consequences, both intentional:

1. **It auto-corrects ALL proper-noun spelling silently and NEVER flags an unfamiliar one.**
   Members work in many niches and constantly use their own brand / product / campaign /
   traffic-source names (e.g. "Caterpillar" traffic source, "Barkchester" Media Mavens
   product). The cleaner is fed a canonical-terms list (glossary + live Media Mavens product
   names + a known-traffic-sources constant) to normalise toward; any OTHER proper noun is a
   member's own term → fix obvious typos, keep consistent, do not flag.

2. **It emits EXACTLY two review-flag types: `garbled_content` and `uncertain_authority`.**
   **Why:** earlier it over-flagged — the model invented an `uncertain_term` type for every
   niche proper noun, plus title-date and cosmetic flags, drowning real issues. The prompt
   alone does not hold the line (models drift), so enforcement is at RUNTIME.

**How to apply:** the allowlist + coercion lives in `mapModelFlags()` in
`transcript-cleaner.ts` (used by BOTH clean + refine). It coerces near-miss names (garbl* →
garbled_content; auth/attribut/speaker → uncertain_authority) and DROPS anything else. The
deterministic low-confidence authority push also uses `uncertain_authority` (was
`low_confidence_attribution`). Missing-date is NOT a flag — it stays as the `titleNeedsInput`
field, which the admin UI surfaces independently. If you add a genuinely new flag reason,
add it to the allowlist in lockstep or it will be silently dropped.
