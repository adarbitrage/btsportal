---
name: KB doc_class citable gate
description: How the AI assistant decides which knowledgebase_docs are citable, and how transcripts are excluded.
---

# KB doc_class citable gate

The AI assistant (chat, voice, rag-retriever) only retrieves docs matching the
**citable filter**: `doc_class IN ('curated','overview') AND last_verified IS NOT
NULL AND audience <> 'admin'`. Single source: `citableDocFilter()` in
`artifacts/api-server/src/lib/kb-citable-filter.ts`, applied right after each
`audience <> 'admin'` clause in chat.ts (2), voice.ts (2), rag-retriever.ts (3).

**Gotcha:** voice.ts has TWO queries — a primary AND a low-result fallback.
BOTH need the filter. A regression once left it only on the fallback, so the
common primary-result case leaked transcripts. Any KB query you add must carry
`citableDocFilter()` on EVERY branch.

**Why:** pre-launch clean slate — the citable set must start empty and be rebuilt
only from human-verified docs. `last_verified IS NOT NULL` is the verification
gate; reclassify/seed leave it NULL so nothing is citable until a human verifies.

**doc_class values & assignment:**
- `transcript` = coaching/curriculum docs (call recordings) — training data, NEVER
  citable. Reclassified by category via `reclassifyKnowledgebaseDocClasses()` in
  seed-kb.ts (idempotent, only touches NULL doc_class; coaching/curriculum ->
  transcript, else curated). Wired as a boot step so it reaches prod.
- `curated` / `overview` = citable IF verified.
- seed-kb.ts insert sites set doc_class via `docClassForCategory()`.

**Taxonomy is code, not DB tables.** Registry = `kb-taxonomy.ts` (home roots,
tag vocabularies, doc-class/disposition/authority-role constants, Blitz section ->
process node map + drift-guard test). Schema added only plain nullable columns
(doc_class, slug, home_root, node, tags, blitz_section, ceiling, handoff,
last_verified) + tables kb_transcript_sources, kb_doc_provenance. No enums so the
vocabulary evolves without migrations.

**How to apply:** any new retrieval path MUST add `citableDocFilter()` or it will
surface transcripts/unverified drafts. Tests that need results must first
`UPDATE ... SET last_verified=NOW()` on the curated docs they expect (see
kb-refund-retrieval.test.ts beforeAll). Negative-probe queries must be lexically
disjoint from the citable corpus — "how do I reset my password" is verified zero
-overlap with the 15 refund/agreement/glossary docs.
