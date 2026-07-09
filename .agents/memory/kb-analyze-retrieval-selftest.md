---
name: KB Analyze retrieval self-test
description: How "Analyze with AI" self-tests staging drafts against live retrieval + synonym-gap proposal queue semantics.
---

# Retrieval self-test in KB Document Review

- "Analyze with AI" (triage) now generates 3-5 member-phrased questions and runs each
  through the REAL `retrieveSurfaceAware` (chat surface, operations/process/concepts,
  limit 6) against live docs, scoring the DRAFT ad-hoc: SQL `ts_rank` with the same
  `websearch_to_tsquery` as the live path + per-run cosine of ad-hoc embeddings.
- **Rule: staging docs NEVER store embeddings** — draft/question embeddings are
  computed per run and discarded. Result JSON lives in `kb_staging_docs.retrieval_self_test`.
- Pass = clears CONFIDENCE_FLOOR (lex) OR SEMANTIC_CONFIDENCE_FLOOR (sem) AND would
  surface within the limit vs live blend (0.5/0.5). Failures produce a NON-critical
  `retrieval_gap` flag (medium; never blocks bulk confirm / needsExpert).
- **Why:** the flag guides the human editor to add member vocabulary; analysis must
  never fail or block on retrieval health, and never write title/content (always
  needs_review).
- Self-test deps are injectable (`SelfTestDeps`) so unit tests mock retrieval fully.
- Synonym-gap queue: `kb_proposed_synonyms` mirrors the tool-tag AI-proposes/human-
  approves pattern, but **approval is a marker only** — the live alias layer is the
  CODE map in voice-synonyms.ts; a dev must fold approved aliases in. Gap detection =
  `expandVoiceQuerySynonyms(phrase).length === 0`.
- **How to apply:** any change to kb-retrieval.ts's query shape/floors/blend must be
  mirrored in kb-retrieval-selftest.ts or the panel lies to reviewers.
