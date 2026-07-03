---
name: Transcript Cleaner auto-naming grammar
description: How cleaned-transcript titles are built deterministically by call type, and why the model no longer composes them.
---

# Transcript Cleaner auto-naming

Cleaned-transcript titles follow a deterministic, type-specific grammar assembled
in `assembleTranscriptTitle` (lib/transcript-cleaner.ts), NOT free-form by the LLM.

Grammar: `{Call Type} — {Primary Subject} ({Authority})[ — {YYYY-MM-DD}]`, where the
**primary subject flips by transcriptType**: member for `one_on_one_va` ONLY,
coach-only for `group_coaching` AND `private_coaching` (Task #1667 dropped the member
from private coaching → `Private Coaching — Coach {First}[ — date]`), topic/module for
video/doc types.

**Task #1667 (private coaching = coach-only):** `private_coaching` was REMOVED from
`MEMBER_SUBJECT_SLUGS` and added to a new `COACH_ONLY_SLUGS` set (with group_coaching);
its `TITLE_GRAMMAR_BY_SLUG` regex became the coach-only shape
(`^Private Coaching — (?:Coach|VA)(?: .+)?…$`), and the AI building-block prompt now
tells the model to return `null` primarySubject for private coaching (like group).
It STAYS in SLUGS_WITH_DATE and SLUGS_WITH_AUTHORITY_LABEL. Old member-bearing
`Private Coaching — {Member} (Coach …)` titles are now non-conforming, so the boot
backfill (`retitleCleanedHoldingDocs`) rewrites them. `one_on_one_va` is the sole
remaining member-subject type and is unchanged.

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
  never fabricated. A missing date is NOT a review flag. So the date only surfaces
  in a title once the doc has a date-bearing transcriptType set (a NULL/untagged doc
  never shows the date even if the filename carries one).
- Admin-provided ground truth: `providedAuthorityRole/Name/Subject/Date` (4 additive
  nullable cols) are collected at UPLOAD time (and editable afterwards via the intake
  edit dialog + PATCH before cleaning) and ALWAYS win over the AI's detection. The
  admin decides WHO/WHAT; the AI only decides WHICH turns.
- Authority ALWAYS renders (`renderAuthorityName`): with a name → `Coach {First}` /
  `VA {First}` (first-name-only privacy), WITHOUT a name → bare `Coach`/`VA` (never
  blank for want of a name). There is NO roster "crowning" anymore — the old
  behavior of auto-promoting a detected roster name to authority was removed.
- Blanking rule flipped accordingly: `assembleTranscriptTitle` blanks 1-on-1 titles
  ONLY when the MEMBER is unrecoverable (authority alone is never the blocker);
  group_coaching ALWAYS assembles (authority + optional date). Member prefers
  provided/model subject, falls back to `memberNameFromSourceName`.
- Date extracted from filenames incl. the `...(2026-03-24 06_52 GMT+8).txt` shape via
  `detectIsoDateInText` (`\b\d{4}-\d{2}-\d{2}\b` → `normalizeIsoDate`); precedence is
  providedDate ?? filename ?? AI.
- Post-clean sanity: SLUGS_WITH_AUTHORITY_LABEL (private/va/group) flag
  `uncertain_authority` when the expected `Coach`/`VA` turn label never appears in the
  cleaned body (`hasAuthorityLabel`). Member turns are labeled "Member" with NO
  numbers/names.
- Upload UI: TranscriptCleaner.tsx UploadDialog collects a batch call type + authority
  (one AuthoritySelect offering roster coach/VA OR bare role, encoded "roster:<name>"/
  "role:<value>") + optional per-file name/subject/date overrides; blitz-lesson* files
  leave type blank so the server autofill wins. Roster served by GET
  /admin/transcript-cleaner/roster (loadRosterList).
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
