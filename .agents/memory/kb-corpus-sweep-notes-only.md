---
name: KB corpus sweep is notes-only
description: Corpus sweep (phrase + concept) write seam, note targets, and reviewer-gated flow
---

The KB corpus sweep (phrase rename + concept-contradiction modes, kb_corpus_sweep_runs table + /sweep/* admin routes) NEVER edits doc bodies.

**Rule:** all sweep writes go through appendSweepNote — staging docs get append-only `admin_notes`, live docs get append-only `reviewer_notes`. Confirm is a separate reviewer-gated step from preview/run; concept confirm is idempotent (notes_written_at guard).

**Why:** the human review gate is absolute for KB content (see kb-content-campaign-seed-pattern.md); auto-rewriting bodies would bypass it. Definitional mentions of an old term (e.g. a glossary title explaining "cost per offer click") are deliberately surfaced in preview but left un-noted — reviewer judgment decides.

**How to apply:** any new sweep mode or bulk-annotation feature must write notes via the same seam, exclude rejected/deleted/pushed rows, and search effective text (edited_content ?? content). LLM judgment failures must produce per-doc `error` verdicts and a loud run-level error — no silent skips.

Also: the July 2026 concept run (individual-LP vs aggregate-first) flagged 4 staging drafts contradicting aggregate-first doctrine — the "aggregate first, path-level later" framing is BTS canon; expect more drafts to drift toward path-level-first language.
