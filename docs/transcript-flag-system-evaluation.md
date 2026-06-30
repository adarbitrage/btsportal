# Transcript Cleaner — Flag System Evaluation

_Evaluation only. No production behavior was changed by this task. This is a written
recommendation the team can use to decide whether to commission a follow-up build._

## Bottom line

**The current two-flag set (`garbled_content` + `uncertain_authority`) plus the
deterministic `titleNeedsInput` signal is sufficient to begin bulk cleaning.** Do
**not** add new flag types as a prerequisite. The corpus about to be cleaned is
overwhelmingly clean, named-speaker prose; the dominant real risks are already
covered by the existing signals or by cheap deterministic guards that are better
handled outside the LLM flag contract.

One thing is worth doing *before* bulk cleaning, and it is **not a new flag**: add a
deterministic strip for raw transcription artifact tokens (e.g.
`<|vq_lbr_audio_…|>`, `<|end_of_task|>`) — see "Defer/Reject" notes. Everything else
is keep-as-is or defer.

## 1. What the cleaner flags today

Source: `artifacts/api-server/src/lib/transcript-cleaner.ts`,
`lib/db/src/schema/transcript-cleaner.ts`,
`artifacts/portal/src/pages/admin/TranscriptCleaner.tsx`.

### Emitted review flags (exactly two; enforced by an allowlist)
- **`garbled_content`** — a *substantive* passage (real teaching/answer content) is
  so garbled its meaning cannot be recovered. The prompt explicitly tells the model
  to ignore filler/greetings/back-channel.
- **`uncertain_authority`** — the model genuinely cannot tell who the teaching
  authority is.

The contract is hard-enforced in code, not just by the prompt: `normalizeFlagType`
maps near-misses onto the two allowed types (`garbl*` → garbled_content;
`auth*`/`attribut*`/`speaker*` → uncertain_authority) and **drops anything else**
(`mapModelFlags`). So if the model invents `uncertain_term`, `title_date`,
`low_confidence_spelling`, etc., those are silently discarded as noise. This is the
intended "flag sparingly" behavior.

`uncertain_authority` is **also raised deterministically** (not only by the model):
when roster-name speaker labels resolve to conflicting authority roles, or when
neither a roster label match nor a strong AI inference is available, the resolver
falls back to the folder default and pushes a low-confidence `uncertain_authority`
flag (`cleanTranscript`, ~lines 893–930).

### Deliberately NOT flagged (treated as routine, fixed or left silently)
- Unfamiliar proper nouns / member brand / product / campaign / traffic-source names.
- Spelling already normalized against the canonical glossary.
- Short/trivial utterances, greetings, back-channel.
- Routine same-speaker label merges, punctuation, formatting, cosmetic cleanup.
- Stripped cruft: standalone timestamps, transcription-tool artefacts, blank space.

### The separate `titleNeedsInput` signal (NOT a flag)
Computed deterministically in `assembleTranscriptTitle`, persisted to its own boolean
column, and surfaced in the UI as an amber "Title needs a date"/"needs input" hint —
**independent of the flags array**. It fires when the type-specific title grammar
cannot be completed:
- 1-on-1 (private coaching / 1-on-1 VA): member name **or** authority name missing.
- Group coaching: authority (coach) name missing.
- Video / doc: primary subject (topic) missing.

A missing **date** is explicitly *not* a flag and not (by itself) `titleNeedsInput`
unless the grammar requires it.

### How flags surface to the reviewer
`TranscriptCleaner.tsx` (Holding tab): an amber outline badge `"{n} flag(s)"` next to
the status badge, an amber warning icon next to a low-confidence authority role, and
the amber title hint. The flag detail (`reason`/`text`) is shown in the per-document
Review dialog. Flags are advisory only — they never block filing.

## 2. Sample review of real cleaned output + the raw queue

The holding store currently has only **6 cleaned documents** (2 `cleaned`, 4 `filed`).
All 6 are the known clean legacy batch: ~12k-char named-speaker prose, **0 flags
each, all authority high-confidence, `titleNeedsInput=false`**. Spot-checking
original-vs-cleaned (e.g. id 2, "Cheryl L Rodriguez / Coach Bruce") confirms the
cleaner correctly merged a split label (`"Cheryl L Rodriguez Bruce:"` → proper
`Bruce:` / `Cheryl Blair:` turns), dropped filler, and preserved teaching content.
Nothing in these 6 was wrongly passed through clean. They are not a stress test,
though — they are the easy case.

To evaluate what *will* slip through during bulk cleaning, the more informative sample
is the **130 raw `uploaded` docs queued for cleaning**. Corpus profile:

- **Length:** min 589, avg ~6.1k, max ~30.6k chars. 10 docs < 1500 chars; **0 truly
  near-empty** — the short ones are legitimate short how-to videos (e.g. "Metric
  Mover 2 — Creating a New Campaign", 589 chars).
- **Type mix:** other_video 71, blitz_video 26, group_coaching 26, one_on_one_va 6,
  reference_docs 1. **0 untagged** (type is set at intake, not derived by the cleaner).
- **Speakers:** 0 docs use numbered speakers, 0 use timestamps in this batch — these
  are clean `Name:`-labelled exports, which is why authority resolution is easy here.
- **PII:** **0 emails, 0 phone numbers** detected across all 130 raw docs.
- **Artifact tokens:** **1 doc** (id 83) ends in a run of `<|vq_lbr_audio_…|>` …
  `<|end_of_task|>` transcription-tool tokens.
- **Mid-sentence endings:** 29 docs don't end in terminal punctuation, **but 33 docs
  are named as multi-part splits** (`…(1)`, `…(2)`, `…(3)`) — an individual part
  legitimately ending mid-sentence is *expected*, not truncation.

## 3. Candidate flags — scored

Scoring = (frequency in this corpus) × (cost of a miss when mining) × (false-positive
risk of detecting it). Recommendation per candidate:

| Candidate | Freq here | Miss cost | FP risk | Recommendation |
|---|---|---|---|---|
| Truncated / cut-off transcript | Low (multi-part splits dominate) | Low–Med | **High** | **Defer** |
| Very-low-substance / near-empty | ~0 | Low | Med | **Defer** |
| Suspected wrong call-type / folder | Unknown (0 untagged) | Med | High | **Defer** |
| Low-confidence / conflicting date | Low | Low | Med | **Keep as-is** (titleNeedsInput already covers the cases that matter) |
| Possible PII / contact-info leak | ~0 | Low (scrub is answer-time by design) | Med | **Defer / Reject** |
| Member vs coach mis-attribution | Low | **High** | Low–Med | **Keep as-is** (already = `uncertain_authority`) |
| Off-topic / non-coaching content | Low | Low | High | **Defer** |
| Raw transcription artifact tokens left in | 1/130 | Med | **Very low** | **Add — but as a deterministic strip, NOT a flag** |

### Reasoning

- **Truncated / cut-off → Defer.** The honest signal (mid-sentence ending) is
  swamped by *legitimate* multi-part splits — 33 of 130 files are one part of a larger
  call and end mid-sentence by design. A flag here would be mostly false positives and
  would train reviewers to ignore it. Revisit only if a future batch arrives as
  single-file recordings.

- **Near-empty → Defer.** Zero genuinely empty docs; the short ones are valid. A
  byte-length floor could be a cheap deterministic guard later, but it is not needed
  to start and risks flagging legitimate 1–2 minute how-to clips.

- **Wrong folder → Defer.** Type is human-assigned at intake (0 untagged), and the
  downstream miner is folder-aware. Asking an LLM to second-guess the human's folder
  choice is high false-positive and low value pre-launch. If misfiling shows up in
  practice, a *deterministic* mismatch check (e.g. group-coaching folder but the
  cleaner detected a single member subject) beats an LLM flag.

- **Date → Keep as-is.** Date is intentionally never fabricated; where a date is
  *required* for the title, `titleNeedsInput` already forces a human. A standalone
  "low-confidence date" flag adds noise for a field the team can fix in one edit.

- **PII → Defer/Reject.** Architecturally, PII is scrubbed at **answer time**, and
  cleaned transcripts are non-citable raw source that never enter a member-facing
  retrieval path (documented in the cleaner header and the privacy-scrub memory).
  The corpus shows no emails/phones anyway. A PII flag here would duplicate a control
  that lives correctly elsewhere.

- **Mis-attribution → Keep as-is.** This is exactly what `uncertain_authority`
  covers, and the deterministic conflicting-roster-role path already forces the flag.
  The miss cost is high, so it's good this is covered — but it needs no new flag type.

- **Off-topic → Defer.** Low frequency, very high false-positive risk (a tangent in a
  real coaching call is still legitimate source material), and the downstream miner is
  the right place to judge relevance, not the cleaner.

- **Artifact tokens → Add as a deterministic strip (not a flag).** This is the one
  concrete gap: id 83 carries `<|vq_lbr_audio_…|>`/`<|end_of_task|>` tooling tokens.
  The prompt already says "strip transcription-tool artefacts", but a regex strip is
  cheaper and 100% reliable for these fixed token shapes and shouldn't depend on the
  LLM. This is a cleanup improvement, not a reviewer-facing flag, so it stays out of
  the two-flag contract. Frequency is low (1/130) so it is **not** a launch blocker —
  worth a small follow-up.

## 4. Recommendation

1. **Proceed with bulk cleaning on the current two-flag set.** No new flag types are
   required first.
2. **Optional, low-priority follow-up (not a flag):** add a deterministic regex strip
   for `<|…|>` transcription-tool tokens so the rare artifact-laden file (id 83) is
   cleaned without relying on the model.
3. **Re-evaluate truncation / near-empty / wrong-folder flags only if a future
   intake batch differs structurally** (single-file long recordings, untagged
   uploads, or numbered/timestamped exports). For those, prefer cheap deterministic
   guards over new LLM flag types, to protect the "flag sparingly" property that keeps
   the reviewer signal trustworthy.
