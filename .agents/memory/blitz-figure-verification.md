---
name: Blitz written-guide figure verification
description: Why "Unverified figure" review flags are suppressed on Blitz section docs only when the written guide corroborates the figure IN CONTEXT, and the fail-closed rules around it.
---

Figures in the 29 Blitz section staging docs come from two ingredients:
the curated WRITTEN guide (trusted) and video transcripts (enrichment,
still reviewable). A doc-level "skip figures on Blitz docs" switch is
wrong — it would silence video-derived figures too.

**Rule:** a `situational_number` highlight is suppressed only when the
normalized figure appears in a written-guide sentence AND the doc line's
significant-token context overlaps that sentence (≥2 shared tokens, ≥50%
of the smaller set). Same number in a different claim (e.g. $50 daily
budget vs $50 kill threshold) stays flagged.

**Why:** the user's explicit requirement — a figure must be interpreted
in the context of why it's mentioned; curated written guidance needs no
review, video figures may.

**How to apply:** the verifier lives in one pure lib built lazily from
the same section extractor the doc generator uses (tracks the current
guide automatically). It is threaded as an optional param into the
review analyzer and enabled ONLY for docs with the blitz-section import
source. Fail-closed: extraction errors or non-Blitz docs suppress
nothing. The source constant is mirrored locally (avoid importing the
LLM-seam docgen module) with an fs-based lockstep test; the figure
patterns are also lockstep-tested against the analyzer's patterns.
Flags are computed live, so no stored data needed removal.
