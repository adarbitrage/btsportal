---
name: Transcript triage import (manifest → cleaner)
description: How keeper transcripts get loaded from legacy knowledgebase_docs into the Transcript Cleaner holding store, and why idempotency rides on a provenance note (no schema column).
---

# Gated transcript triage import

Loads approved keeper transcripts from the triage manifest
(`docs/transcript-triage/manifest.json`) out of legacy `knowledgebase_docs`
(doc_class='transcript') into the Transcript Cleaner holding store
(`transcript_cleaner_documents`, status 'uploaded'). It only LOADS — cleaning
and filing remain the cleaner's job.

Core logic: `artifacts/api-server/src/lib/transcript-import.ts`
(buildImportPlan = read-only classify, executeImport = gated insert). Routes in
`artifacts/api-server/src/routes/admin/transcript-cleaner.ts`.

## Idempotency rides on a provenance note, NOT a schema column
**Rule:** re-import safety is detected by stamping each imported row's
`provenanceNote` with a fixed marker (`IMPORT_PROVENANCE_PREFIX` + ` — group G\d+`)
and parsing the group id back out on the next run. There is deliberately NO new
DB column / migration / drift-baseline churn for this.

**Why:** a one-off admin import did not justify a schema change + companion .sql
+ post-merge + drift-baseline refresh. The manifest group ids (G\d+) are stable,
so the marker is a reliable dedupe key.

**How to apply:** if you extend the import (e.g. re-import a corrected group),
either change the marker or delete the matching holding-store rows first — there
is no UNIQUE constraint enforcing one-row-per-group, only the marker scan.

## Stitching contract
Multi-part keepers are joined in `partOrder` with a SINGLE SPACE, each part
trimmed, empties dropped — no headings/blank lines (per triage: parts are one
continuous recording). Single-part keepers pass through as-is. Title comes from
manifest `proposedTitle` (applied to BOTH `title` and `proposedTitle`), never the
raw "(Part N)" chunk titles. transcriptType = folder slug via
`resolveSourceFolderByLabel` (kb-taxonomy); authorityRole from manifest.

## Gate
Preview (GET .../import/preview, chat:view) is read-only. The actual import
(POST .../import, chat:manage) requires `{ confirm: true }` in the body or 400s.
