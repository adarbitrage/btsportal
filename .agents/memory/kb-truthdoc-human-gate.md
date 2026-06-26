---
name: KB truth-doc authoring/review human gate
description: The staging→review→publish pipeline for member-facing KB docs is hard-gated on human approval; no machine auto-publish.
---

# KB truth-doc review pipeline (Task #2 layer)

The transcript-mining + triage + review infra feeds `kb_staging_docs` and is the
authoring path for member-facing knowledgebase docs. It deliberately has **no
machine auto-publish** of member-facing content.

**Rule:** AI may draft, taxonomy-tag, flag, and redraft — but a human must
approve before anything becomes citable. Triage is "analyze only": it computes
risk flags + suggested title/taxonomy and sets `needs_review`; it never
auto-approves or auto-rejects member-facing docs, and there are no
confidence-threshold auto-action knobs.

**Why:** member-facing KB answers drive chat/voice responses; an AI mistake that
auto-publishes is a trust/liability risk. The gate is the whole point of the task.

**How to apply:**
- Canonical staging statuses: `needs_review / approved / published / rejected / merged`
  (legacy `pending_review`/`auto_*` were removed). Don't reintroduce auto statuses.
- Citable gate is unchanged: `doc_class IN (curated, overview) AND last_verified NOT NULL`.
  `push-approved` is the ONLY place that writes taxonomy + `lastVerified=NOW()` +
  provenance rows and flips status to `published`.
- Risk flags (`lib/kb-flags.ts`, structural `{type,severity,message,detail?}[]`)
  drive review, NOT a single score. `blocksBulkConfirm()` + `needsExpert` gate
  bulk-approve; conflict/high-stakes docs must be adjudicated individually.
- Mining (`lib/kb-mining.ts`) skips quarantined/unreviewed `kb_transcript_sources`
  and records a durable processed marker so clearing the review queue doesn't
  reprocess. Source screening lib classifies internal-only transcripts → quarantine.
- Guided/rapid confirm UI is restricted to the `docType=existing_doc` re-verify
  track (imported curated docs), never the AI truth-draft track.
