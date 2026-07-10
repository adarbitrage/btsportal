---
name: AI Document Review is citeable-only
description: The kb_staging_docs review pipeline must never treat `transcript` as a valid class; only curated/overview/navigation.
---

# AI Document Review is citeable-only

Every doc in AI Document Review (`kb_staging_docs`) exists to be approved and
promoted into the live, citeable KB. The non-citeable `transcript` class belongs
to AI Source Knowledge (`ai_source_documents` / Transcript Cleaner) and is NEVER
valid in the review pipeline.

**Why:** an unfiled review doc used to fall back to the AI's `transcript`
suggestion, which made retrieval refuse to surface it and the self-test score
0/5 regardless of title/content quality (the "MetricMover looked broken" bug).

**How to apply:**
- Triage may only ever PROPOSE a citeable class; the parse step must coerce any
  non-citeable/invalid suggested class to the citeable default ("curated") —
  never null, never transcript.
- Self-test scoring must score against the class coerced to citeable, so a doc's
  score reflects title/content, not a non-citeable fallback. There are TWO such
  paths — the initial analysis pass AND the title re-score path — and they must
  stay in lockstep; fixing one and not the other silently reintroduces the bug.
- A doc still FILED under a non-citeable class raises a high-severity warning
  flag prompting a re-file, while still scoring as citeable.
- Every place in the review editor that sets the doc-class field (initial open
  AND "Apply AI taxonomy") must filter through the citeable-only helper and fall
  back to the citeable default, never to empty (which can save a null class); a
  raw AI suggestion can carry a non-citeable class on legacy docs.

**Do NOT** remove `transcript` from the shared `DOC_CLASSES` enum — it stays
valid for the source corpus, and the reviewer SOP doc-class catalog still lists
all classes. Synthesis already only files review drafts as overview/curated.
