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

## Refine chat is patch-based, not full-rewrite

**Why:** LLM latency is dominated by OUTPUT token count, not instruction difficulty. The
refine chat used to re-emit the ENTIRE cleaned transcript as `cleanedTranscript` on every
call, so even "delete the garbled line" cost a full-document regeneration → slow.

**How it works:** `refineTranscript` first asks the model for a tiny set of literal
find/replace edits (`edits: [{find, replace, all?}]`) and applies them server-side via the
exported `applyRefineEdits()`. `find` must be a verbatim substring matching EXACTLY once
(or `all:true` to replace every occurrence); matching is literal split/join (no regex, so
`$` in `replace` is safe). It falls back to the old full-rewrite prompt
(`REFINE_FULL_SYSTEM_PROMPT`) ONLY when an edit can't be applied unambiguously (0 / >1
matches, malformed) — worst case = previous behaviour, never partial corruption. An empty
`edits: []` is a valid no-op (returns transcript unchanged, no fallback). The doc's active
flags (each carrying the verbatim flagged snippet) are passed into the prompt as find
anchors, since refine is mostly flag resolution. **How to apply:** if you change the refine
result shape, keep `buildRefineResult()` (shared by both paths) in lockstep; don't reintroduce
a single full-transcript refine prompt.
