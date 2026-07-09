---
name: ai_live_documents fully decoupled from legacy KB + drift baseline regen trap
description: The legacy->ai_live mirror is RETIRED (guard test enforces it); and never regen the drift baseline against a broken DB
---

Durable lessons from cutting the AI assistant onto `ai_live_documents`.

## The legacy→live mirror is RETIRED (fully decoupled)
`ai_live_documents` (assistant retrieval corpus) and legacy `knowledgebase_docs`
(member-facing KB) are now fully decoupled: no boot mirror, no lazy re-sync after
admin legacy-KB writes. The corpus is written ONLY by the review pipeline
(staging push-approved) and the Live AI Documents admin CRUD.

**Why:** the corpus is human-curated with its own lifecycle (supersede,
soft-delete/restore, versions); any automatic legacy→live copy re-couples the
tables and can resurrect deleted/superseded docs or inject unreviewed legacy
content.

**How to apply:** never add SQL that INSERTs into ai_live_documents FROM
knowledgebase_docs in src (a guard test scans for the retired function name and
that SQL shape, excluding __tests__). Tests needing a populated corpus seed it
via the `kb-live-docs-test-seed` fixture helper or the push-approved route —
NOT by re-adding a sync. An admin legacy-KB edit is invisible to the assistant
by design; fix assistant content through the Live AI Documents editor/pipeline.

## Retrieval excludes soft-deleted via the shared citable filter
`citableDocFilter()` (kb-citable-filter.ts) now appends `deleted_at IS NULL`.
It is used ONLY against `ai_live_documents` (kb-retrieval nav/primary/fallback +
rag-retriever), the sole table with `deleted_at`. Don't apply it to another table
without splitting the soft-delete predicate out.

## Never regenerate expected-drift.json against a broken/empty DB
`lib/db/src/__fixtures__/expected-drift.json` records EXPECTED schema-vs-migration
drift. Running `UPDATE_DRIFT_BASELINE=1` when the schema-pull side is empty/broken
produces an INVERTED baseline (nearly every table under `onlyInMigrations`,
`onlyInPush` empty) — a ~2000-line garbage rewrite that then fails
`@workspace/db test` on the next real run.

**Why:** the baseline diffs a drizzle-kit push DB vs a raw-.sql-migrated DB; if the
push side didn't populate, everything looks migration-only.
**How to apply:** for an additive change whose columns/indexes/FK are mirrored on
BOTH the schema and a companion .sql (e.g. ai_live_documents 0087), NO baseline
change is needed — the diff is unchanged. If you see a huge baseline rewrite,
revert it to the prior committed version and re-run the drift test; only regen when
you can confirm the diff is small and intentional.
