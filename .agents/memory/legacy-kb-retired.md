---
name: Legacy knowledge base retired
description: The old knowledgebase_docs/knowledgebase_bookmarks stack is fully removed — what replaced each consumer.
---
The legacy KB stack (admin CRUD page + member search/browse/bookmark API + seed/ingest/boot-repair code + `knowledgebase_docs` / `knowledgebase_bookmarks` tables) is fully retired and must stay retired.

**Why:** old corpus was outdated and contained raw coaching transcripts with member names; owner confirmed it will never be imported from again. The modern pipeline (ai_source_documents → kb_staging_docs → ai_live_documents) was verified decoupled first.

**How to apply:**
- Never reintroduce a `knowledgebase_docs` reference; retrieval, privacy-scrub tests, leak guards, and voice fixtures all target `ai_live_documents` now.
- Retrieval tests seed ai_live_documents directly via `src/__tests__/fixtures/` (concepts docs + refund/glossary parsers preserved there as TEST-ONLY fixtures).
- `kb-legacy-crosswalk.ts` was intentionally KEPT — it is a pure terminology map used by modern nav grounding, not a DB bridge.
- Assistant Card Library's KB-topic card derivation + question-generator loadKbDocs are stubbed (feature dormant); a future re-tie targets ai_live_documents.
- Table drops land via the idempotent post-merge drop pattern (bookmarks first — FK onto docs); prod completes on Publish. Any replayed migration that ALTERs/reads the legacy tables must be guarded on `to_regclass('public.knowledgebase_docs')` or post-merge replay breaks after the drop.
- Post-merge must never invoke legacy rescrub/seed scripts — they are deleted; the modern tables have their own scrub/rebrand passes.
