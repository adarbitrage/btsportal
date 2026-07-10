---
name: KB ceiling advisory + self-test tag source
description: Why a per-run KB advisory that must survive the filed taxonomy-lock needs its own columns, and why retrieval self-test tags must resolve filed-first identically in every scoring path.
---

# A per-run advisory that must survive the filed lock needs its own column

In KB AI Document Review, `aiSuggestedTaxonomy` (home-root/node/doc-class/ceiling/
tags) is **suppressed once a doc is filed** (the `taxonomyLocked` gate) so
re-analysis can't churn an intentional filing. Consequence: any suggestion that
must still refresh on *filed* docs cannot live inside `aiSuggestedTaxonomy` — it
will silently never surface.

The depth ceiling is such a case (cheap to re-check, applying it doesn't cascade
into retrieval/filing), so it lives in its own dedicated columns and is written on
every run *outside* the lock.

**Why:** filed docs never showed a ceiling suggestion because it was buried in the
suppressed taxonomy blob.
**How to apply:** when adding another advisory that must survive the filed lock,
give it its own column and write it outside the `taxonomyLocked` gate — never fold
it into `aiSuggestedTaxonomy`. Surface it only when it differs from / is missing on
the doc's current value; apply via a PATCH that touches that field alone so the
locked placement stays intact. Never auto-apply.

# Retrieval self-test must score against the PUBLISHED tags (filed-first)

The self-test must score against the tags the doc would actually publish with,
resolved *identically* in the analysis path and the post-save re-score path.
Filed docs (any of home-root/node/doc-class present) use their controlled
taxonomy tags; only never-filed docs fall back to the per-run AI-suggested tags.
Never read the vestigial free-text `tags` column.

**Why:** the two paths once read different tag sources, so current-vs-suggested
title scores drifted between runs and looked untrustworthy. Filed taxonomy tags
are authoritative — publish copies them into the live doc and live retrieval's
tag-tier boost reads them.
**How to apply:** every self-test call site must resolve tags through the one
shared filed-first helper, mirroring the filed-first doc-class resolution.
