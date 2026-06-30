# Transcript-Structure Findings & Cleaner Enhancement Spec

> **Task #1483 companion.** How the legacy `transcript`-class rows in `knowledgebase_docs` are
> *actually shaped* — measured from the real content, not assumed. These findings are the input
> that shapes the Transcript Cleaner's cleanup + authority-attribution parameters (**plan #1468**).
> Nothing here mutates data. See `triage-report.md` for the keep/exclude decisions and
> `manifest.json` for the machine-readable per-doc manifest.

## TL;DR for the cleaner (#1468)

The legacy corpus is **already remarkably clean prose** — there are **no VTT timestamps, no
numbered diarization, no whitespace cruft**. The real work for the cleaner is **not** de-crufting;
it is **(a) re-stitching the ~2,500-char chunks back into whole recordings in `Part` order,
(b) de-duplicating re-exported copies, (c) attaching the right authority role, and (d) trusting
the answer-time PII scrub rather than scrubbing at clean-time.**

## Corpus shape (measured over all 485 rows)

| Property | Finding |
|---|---|
| Row count | 485 rows, doc_class = `transcript` (295 `coaching` + 190 `curriculum` by category). |
| Logical recordings | **161** after grouping multi-part sets and folding duplicates. |
| Row length | min 54, **median ≈ 2,466**, p75 2,500, **max 3,000** chars. Tight clustering at ~2.5k. |
| **Rows are chunks, not whole transcripts** | Each row is a **~2,500-char slice** of a longer recording, titled `… (Part N)`. A 5-part call (e.g. *Adam Field Meeting Information*, ids 392–396) is five ~2,430-char rows that reassemble in order to ~12,100 chars. |
| Parts-per-recording | 1 part ×63, 2 ×28, 3 ×15, 4 ×5, **5 ×47**, 8 ×1, 9 ×1, 11 ×1. The big spike at 5 is the chunker's default cap, **not** a natural recording length. |
| Timestamps | **None.** 0 VTT `-->` arrows; only 2 incidental `H:MM` clock mentions in spoken content. Nothing to strip. |
| Speaker labels | **No numbered diarization** (`Speaker 1:` = 0 rows). **283 rows carry named `Name:` labels** (multi-speaker calls); the remainder (single-narrator curriculum videos) are unlabelled continuous prose. |
| Whitespace cruft | **None** — 0 rows with multi-space runs or triple blank lines. Diarization was already collapsed to clean paragraphs upstream. |
| PII | Inline in both **body and titles** (member names; the *named member 1:1* calls especially). Emails/phones appear as raw text in a few rows. **Handled at answer-time** by the existing scrub, not at clean-time. |
| Short non-transcripts | ~28 rows < 800 chars are **support FAQ / curriculum-overview docs mis-tagged** as `transcript` (see below). |

## Structural patterns the cleaner must handle

### 1. Re-stitch chunks in `Part` order (primary job)
Titles follow `<Recording Title> (Part N)`. The cleaner must group by the **base title** (strip the
` (Part N)` suffix), order by N, and concatenate. The manifest already does this: every recording's
`keepDocIds` are listed **in part order** — the cleaner can consume that directly instead of
re-parsing titles. Watch the seam: chunks were split mid-sentence at the ~2,500-char boundary, so
concatenation should join with a space, **not** a paragraph break, and must not insert a heading
between parts.

### 2. Apply the approved `proposedTitle` (renaming)
Each keep recording in `manifest.json` carries a **`proposedTitle`** — the clean name the import
must give the stitched single document. For most recordings this is just the de-suffixed series
title (the `… (Part N)` suffix stripped). For the **generic / misnamed** recordings it is an
explicit human-approved new title (`titleRenamed: true`), e.g. `Untitled document` →
`Live Coaching Call — Michael (session A)`, `Zoom Meeting` →
`1-on-1 VA Setup Call — Mikha (member Brenda)`. **The import (#1484) must title the combined
document from `proposedTitle`, not from any raw `(Part N)` chunk title.** Because this is a field
the import would otherwise not know to read, plan #1484's spec has been updated to require it.

### 3. De-duplicate re-exported recordings
Some recordings were exported more than once, producing `(1)` / `(2)` title variants **and** a few
per-part `[NNN]` id-tagged copies. The triage found **38 duplicate doc-parts across 8 recordings**.
Two duplicate shapes:
- **Byte-identical re-exports** (23 of 38) — caught by content hash.
- **Near-identical re-exports** (15 of 38, recordings *Donald Hayes – Mitolyn*, *Live Coaching
  Call – Michael(1)*, *Live Coaching Call – Michael*) — **same session, slightly different export**,
  so a pure hash check misses them; they were confirmed by high-overlap (5-word-shingle Jaccard)
  comparison during triage.

**Cleaner takeaway:** de-dup must run on **normalized content similarity**, not hash alone, and must
normalize the `(N)` / `[NNN]` title decorations before grouping. The manifest's
`duplicateDropDocIds` per recording is the authoritative drop-list — the cleaner should honor it
rather than re-deriving.

### 4. Distinguish whole-phrase internal markers (do not over-match)
Internal/non-member meetings were excluded by **whole-phrase** matching — `check-in` / `check in`,
`personal meeting room`, `weekly coaches`, `e-comm … check`, `TCE … weekly` — **never** the bare
substring `check` (legit titles like "Campaign Setup Checking" must survive). Generic titles
(`Untitled document`, `Zoom Meeting`, `… Meeting Information`) were **not** auto-excluded: each was
opened and read. Several "internal-looking" titles turned out to be **real member coaching**
(`Untitled document` → a Live Coaching Call with Michael; `Zoom Meeting` → a VA setup call with a
member). The cleaner must treat the manifest's `disposition` as final and **must not** re-apply a
title heuristic that would re-quarantine these.

### 5. Authority attribution from source identity
Each recording carries an `authorityRole` (`strategic_coach` / `va` / `curriculum` / `internal`)
derived by joining the call's coach/VA name to the live `coaches` roster:
- **`strategic_coach`** — Bruce, Michael, Sasha, Todd (the LIVE Coaching Call hosts + their 1:1s).
- **`va`** — John (Dela Cruz), Neil (Warren), Mikha, Aliena/support (the named member 1:1 help calls).
- **`curriculum`** — the numbered/branded training videos and the authored FAQ/overview docs.
- **`internal`** — quarantined staff meetings.

**Cleaner takeaway:** the role belongs on the *source*, so all parts of a recording inherit one
role, and mined drafts inherit their source's role. Per the remediation foundation §8.12, a
**VA-sourced *strategic* claim** must raise a review flag — VA content stays authoritative for
software/tool/setup answers but its higher-level strategy must be corroborated before it is treated
as truth. The cleaner should surface the role so the downstream review pipeline can enforce this.

### 6. Mis-tagged non-transcripts (route, don't stitch)
~28 short rows tagged `transcript` are **not transcripts**:
- **Support FAQ articles** (e.g. "How do I book my Kick-Off Call?", "When are the Thursday Live
  Coaching Calls?") — single-doc, "Overview"-style member-support answers.
- **Curriculum overview/index docs** (e.g. "BTS Training Curriculum Overview", "Training
  Curriculum: Phase 1 — Build") — authored phase indexes, recently boot-seeded.

These are classified **Reference Docs / `curriculum`** and should be imported **as-is** (no
stitching, no diarization, no de-cruft). The cleaner's stitch/dedup pipeline should skip anything
the manifest folders as `Reference Docs`.

## Enhancement spec for the Transcript Cleaner (plan #1468)

1. **Consume the manifest, don't re-derive.** Read `manifest.json`. For each `keep` recording use
   `keepDocIds` (already part-ordered) to stitch and `duplicateDropDocIds` to drop. Skip every
   `exclude` recording entirely (quarantined from cite **and** mine).
2. **Stitch with seam-awareness.** Join consecutive parts with a single space (chunks split
   mid-sentence at ~2,500 chars); never inject a heading or blank line between parts of one
   recording.
3. **De-dup on similarity, not just hash.** Normalize `(N)`/`[NNN]` title decorations; treat
   near-identical (high-overlap) exports as duplicates. The manifest's drop-list is authoritative.
4. **No timestamp / whitespace / diarization stripping needed** — the corpus has none. Don't build
   (or spend tuning budget on) a VTT/timestamp/whitespace de-cruft stage for this corpus; a light
   collapse of accidental double spaces is the most that is warranted.
5. **Speaker handling.** Preserve named `Name:` labels where present (they carry the
   coach-vs-member attribution that authority weighting depends on); do not invent labels for the
   unlabelled single-narrator curriculum videos.
6. **Carry authority role onto every output** (and onto mined drafts). Flag VA-sourced strategic
   claims for review per §8.12; keep VA content fully authoritative for software/setup answers.
7. **Defer PII to answer-time.** Do not scrub names/emails at clean-time — the existing answer-time
   privacy scrub is the enforcement point; over-scrubbing here would break coach-vs-member
   attribution.
8. **Route mis-tagged non-transcripts** (manifest folder `Reference Docs`) straight through without
   the stitch/dedup/diarization path.

## Provenance

Decisions were made by reading the actual chunk text for all 161 recordings (coaching + curriculum)
plus full-content SQL pattern scans over all 485 rows. Length/pattern figures above are measured
(`char_length`, regex scans) against `knowledgebase_docs` at triage time. No rows were modified.
