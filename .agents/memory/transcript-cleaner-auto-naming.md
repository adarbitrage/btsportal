---
name: Transcript Cleaner auto-naming grammar
description: How cleaned-transcript titles are built deterministically by call type, and why the model no longer composes them.
---

# Transcript Cleaner auto-naming

Cleaned-transcript titles follow a deterministic, type-specific grammar assembled
in `assembleTranscriptTitle` (lib/transcript-cleaner.ts), NOT free-form by the LLM.

Grammar: `{Call Type} — {Primary Subject} ({Authority})[ — {YYYY-MM-DD}]`, where the
**primary subject flips by transcriptType**: member for 1-on-1 (private_coaching,
one_on_one_va), coach-only for group_coaching, topic/module for video/doc types.

**Why:** coach-first free-form titles were inconsistent and leaked member identity
ordering; a fixed grammar keeps the holding store scannable and respects the
coach-first-name privacy convention (`Coach {First}` / `VA {First}`).

**How to apply:**
- The LLM returns BUILDING BLOCKS only: `authority.detectedName`, `primarySubject`
  (string|null, meaning flips by type), `detectedDate` (ISO or null). It no longer
  returns `suggestedTitle`/`detectedDateTime`/`titleNeedsInput`. The engine composes.
- Title prefix is NOT always the folder label: reference_docs→"Reference",
  other_docs→"Doc" (see TITLE_PREFIX_BY_SLUG). Date is appended ONLY for slugs in
  SLUGS_WITH_DATE (private/va/group/other_video) and only when confidently found —
  never fabricated. A missing date is NOT a review flag.
- 1-on-1 titles REQUIRE BOTH member AND authority — `assembleTranscriptTitle`
  returns blank + `titleNeedsInput=true` if EITHER is unrecoverable; it never emits
  a partial authority-less title like "Private Coaching — {Member}". Member prefers
  model primarySubject, falls back to `memberNameFromSourceName` (strips "Meeting
  Information", "(1)", "- desc").
- Authority name prefers a deterministic roster label match (lowercased; title-cased
  for display), then model detectedName.
- `titleFollowsGrammar(title, folder?)` is SLUG-AWARE: with a folder it tests the
  full per-slug shape (TITLE_GRAMMAR_BY_SLUG regex — incl. required `(Coach|VA …)`
  for 1-on-1), not just a known prefix, so a malformed title isn't falsely skipped.
- Backfill authority detection reads `originalContent` (raw speaker labels like
  "Bruce:") FIRST — cleanedContent is often anonymized to "Coach"/"Member N" and
  loses roster names; date detection still prefers cleanedContent.
- runClean precedence is unchanged and intentional: hand-set `title` > imported
  `proposedTitle` > generated. So a bad imported proposedTitle still wins on a fresh
  clean — the backfill is the only thing that overrides it for already-cleaned docs.
- `retitleCleanedHoldingDocs()` is an idempotent boot hook (app.ts) that re-titles
  status=`cleaned` docs whose title doesn't yet follow the grammar; deterministic,
  no AI call, never blanks an existing title. Skips docs via `titleFollowsGrammar`.
