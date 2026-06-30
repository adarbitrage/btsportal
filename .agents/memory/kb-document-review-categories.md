---
name: AI Document Review categories aligned to data model
description: KnowledgeBaseReview.tsx + knowledgebase-staging.ts categories/facets must mirror the kb-staging schema enums, not legacy columns.
---

# AI Document Review (KnowledgeBaseReview) category contract

The admin AI Document Review page and its staging backend (`/admin/knowledgebase/staging`) categorize docs by the kb-staging schema, NOT the legacy `source` column.

**Canonical enums (source of truth = `lib/db/src/schema/kb-staging.ts` + `artifacts/api-server/src/lib/kb-taxonomy.ts`):**
- status: `pending_review` (schema default; uploads) | `needs_review` (mined/triaged/merged/import) | `approved` | `published` | `rejected` | `merged`. UI labels: pending_review→"New/Untriaged", approved→"Ready to Publish", published→"Live"; Merged is demoted (only shown when count>0).
- origin_type (6): strategy_coaching_call | va_call | training_video | curated_upload | ai_synthesized | manual_entry. The origin facet MUST key off `origin_type`, never the legacy `source` col.
- authority_role: strategic_coach | va | curriculum | internal.
- docType: truth_draft | existing_doc (study_material is dead — never written; render only if present).
- doc_class canonical: curated, overview, transcript; citable = curated + overview. There is NO "reference" class (was UI-only drift, removed).
- home roots / "Shelf" (3): process / concepts / operations.

**Why:** the page predated the schema and filtered on legacy `source`, had a UI-only "reference" doc class, and labeled the home root inconsistently (Shelf/home root/Home).

**Gotchas:**
- The PATCH `/:id` route previously DROPPED homeRoot/node/docClassTarget/ceiling/handoff/needsExpert — editor edits were silently lost. It now persists them.
- runTriage default `includeStatuses` must include BOTH `pending_review` and `needs_review` or freshly-uploaded docs never get triaged.
- Frontend cannot import `kb-taxonomy.ts` (server-only); the HOME_ROOTS / ORIGIN_OPTIONS / AUTHORITY_LABEL / DOC_TYPE_LABEL constants in the .tsx are hand-mirrored copies — keep them in lockstep with the backend enums.
- "Confirm Safe on Page" uses client-side `isBlocking(doc)` to compute safe/blocked counts; server re-enforces on bulk-approve.
