---
name: KB value screener = recall-biased de-noiser
description: Design contract for the coaching-transcript value screener (its job, its statuses, what it must NOT do).
---

# KB value screener is a recall-biased de-noiser, NOT a gold-picker

The value screener sits at the FRONT of the KB pipeline: it segments coaching-call
transcripts (topic-threaded), classifies each segment, and writes a screened-output
store that the synthesis engine + human review gate consume downstream.

## The rules (design decisions — keep future work consistent)
- **Recall-biased / keep-by-default.** The rubric errs toward KEEPING borderline
  content and FLAGGING doubt, never dropping to hit a quality bar. It is a de-noiser
  + flagger, not a "gold-picker". Dropping should be reserved for clear noise.
- **`error` is a reliability status, distinct from the keep/drop/flag verdicts.**
  Per-segment classification runs in isolation with retries; a whole-chunk failure
  becomes an explicit `error` disposition (surfaced + counted), never a silent drop.
  The model must NOT be able to self-assign `error` as a verdict.
- **Dedup is narrow.** Only near-identical WHOLE calls are deduped (length-ratio gate
  + shingle Jaccard threshold). Do not dedup at the segment level — that destroys recall.
- **No PII step here.** PII scrubbing is the downstream review gate's job, not the
  screener's. Don't reintroduce a screener PII module.
- **No calibration.** Calibration was removed ENTIRELY (table, schema field, routes,
  admin page). Do not reintroduce a calibration/teach/feedback loop.
- **The admin page is a run-and-audit console only** — trigger a run, watch progress,
  audit dispositions (incl. an error filter/badge). Not a curation/teaching surface.
- **Segment shape = one role-labeled `passage` (+ optional `anchorQuestion`), NOT
  member-prompt/coach-response pairs.** Real transcripts use bare labels (Coach/Member
  alone on a line) as often as `Name:` colons; parsing needs both a bare-label pass and
  MAJORITY-RULE colon detection (a few `word:` lines in prose must not trigger dialogue
  mode, or a whole call collapses into one giant segment → LLM token-budget exhaustion
  → all-error screening). Enforce a hard max-chars cap with sentence-boundary splits;
  fold orphan member questions into the following kept coach segment (Q/A pairing);
  mark screen-share walkthroughs `contextBound`. An EMPTY LLM completion is its own
  distinct error reason (token budget), not a generic parse failure.

**Why:** the screener's value is high recall so nothing citable is lost before humans
review; a strict picker would silently discard usable coaching content, and a
self-reported `error` verdict would let LLM failures masquerade as editorial drops.

**How to apply:** any change to screener classification/rubric/dedup must preserve
keep-by-default bias and the isolated-per-segment `error` path. Synthesis (#1703) and
review gate (#1704) own quality + PII; don't push those responsibilities upstream.

## Reviewer fold display + oversized flag (2026-07)
- Fold-dropped member questions carry an exported structured marker constant as dropReason; the reviewer surface derives `foldedIntoNext`/`foldTruncated` from exact marker match (deriveFoldSignals) — NEVER detect folds by passage string-matching.
- Anchor cap is 2,000 chars; truncation warning derives from original member text length vs cap.
- `oversized_segment` anomaly fires only above 2× SEGMENT_MAX_CHARS (trivial overshoots are harmless to synthesis); when it fires, payload lists offending segments with overBy.
- **How to apply:** if the fold marker string ever changes, keep it exported from the lib and matched exactly in results route + tests in lockstep.
