---
name: KB retrieval tests vs shared dev DB
description: Isolation patterns for DB-backed KB retrieval tests running against the shared, ever-growing ai_live_documents corpus.
---
Rule: DB-backed retrieval tests must never assume ai_live_documents is sparse or fresh.
**Why:** the shared dev DB accumulates real live docs (with fresh embeddings) and retired-mirror leftovers, so fixed top-N assertions and title-conflict-only seeds break over time (~0.028 phantom semantic scores; slug unique violations on seed).
**How to apply:**
- Semantic tests: scope fixtures + retrieval to a unique fixture-only category (category is free text), never a real category like "operations".
- Positive ranking assertions: scope categories to the corpus the test seeds; keep negative guards at full chat scope.
- seedLiveDocsFromCitableLegacyForTest handles BOTH title and slug conflicts (deletes same-slug/different-title leftovers, guarded by title-absence); keep that guard if editing.
- Live concepts docs legitimately diverge from legacy seeds (reviewer/synthesis enrich them) — never "fix" by overwriting live content.
