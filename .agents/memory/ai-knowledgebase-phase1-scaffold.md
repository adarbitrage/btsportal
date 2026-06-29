---
name: AI Knowledgebase vs member Knowledge Base separation (phase 1)
description: Why there are now two parallel KB systems in admin, which one is actually live, and what phase 2 still owes.
---

# AI Knowledgebase scaffold — two parallel systems, only one is wired

Phase 1 created a NEW, EMPTY, additive corpus (`ai_live_documents` table + standalone
`/admin/ai-live-documents` CRUD router + `/admin/ai-knowledgebase/live-documents` page)
that is deliberately **NOT** wired into any retrieval/seed path. The legacy
`knowledgebase_docs` table (admin page at `/admin/chat/knowledgebase`, routes under
`/admin/chat/knowledgebase`) is STILL the only thing that feeds the AI assistant + voice.

**Naming trap (intentional):**
- Sidebar top-level leaf **"Knowledge Base"** → `/admin/chat/knowledgebase` = the LEGACY page (still AI-feeding, unchanged wiring).
- Sidebar dropdown **"AI Knowledgebase"** contains **"Live AI Documents"** → the NEW empty `ai_live_documents` table that nothing reads yet.
So the label "AI Knowledgebase" currently points at the *non-live* system, and the plain "Knowledge Base" leaf is the *live* one. Don't assume the new table is in use.

**Why:** user wanted a clean, scaffold-first separation of the member-facing Knowledge
Base from the AI assistant's live-document system, additive-only, with zero risk to the
working retrieval flow. Migration of content + repointing retrieval is explicitly **phase 2**.

**How to apply:** if asked to make the new AI Knowledgebase actually power the assistant,
that is phase 2: migrate/curate rows into `ai_live_documents` and repoint the retrieval
path (currently `knowledgebase_docs`). The new CRUD reuses the existing blended search
(OR-tsquery + pg_trgm) and `scrubPrivateContent`; slug is unique-with-nulls and create/update
map a 23505 conflict to HTTP 409.
