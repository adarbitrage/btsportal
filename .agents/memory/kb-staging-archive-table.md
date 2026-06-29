---
name: KB staging archive backup
description: The kb_staging_archive table (out-of-Drizzle-schema) holding the quarantined old review-queue drafts, and why a raw-SQL table dodges the drift gate.
---

# kb_staging_archive — the quarantined old review queue

The admin "Archive Backup" page (`/admin/chat/knowledgebase/archivebackup`,
component `KnowledgeBaseArchive.tsx`, route `GET /admin/knowledgebase/archive`)
is a **read-only** browser over a table called `kb_staging_archive`. That table
holds a frozen snapshot of the old `kb_staging_docs` review queue (the abandoned
pre-new-taxonomy drafts) that was deliberately wiped to 0 rows so the live
Document Review page starts clean. The user wanted to look back later and reuse
anything worthwhile — nothing here feeds the live KB/pipeline/AI.

**You will NOT find `kb_staging_archive` in `lib/db/src/schema/`.** It is created
by raw SQL (`CREATE TABLE kb_staging_archive (LIKE kb_staging_docs INCLUDING
DEFAULTS)` + an `archived_at` column, no FKs, id default dropped). It exists only
in the dev DB it was seeded in; on prod it is absent and the route degrades to an
empty list via a `to_regclass('public.kb_staging_archive')` guard.

**Why out-of-schema:** the drift tests only check schema⊆DB —
`live-schema-drift.test.ts` flags tables/columns declared in the Drizzle schema
but missing from the live DB, and never flags extra DB tables. So a raw-SQL table
kept out of the Drizzle schema has **zero drift-test impact** and needs no
migration / baseline refresh. This is the clean pattern for a temporary,
fully-decoupled table.

**How to apply:** if asked to remove this temporary feature, tear down all four
pieces — the page + App route, the sidebar "Archive Backup" leaf, the
`knowledgebase-archive` router + its mount in `routes/index.ts`, the
`fetchKbArchiveDocs` helper — and `DROP TABLE kb_staging_archive`. To reproduce
the archive in another environment, re-run the LIKE/INSERT snapshot SQL there.
