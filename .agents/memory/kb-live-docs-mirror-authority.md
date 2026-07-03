---
name: ai_live_documents mirror authority + drift baseline regen trap
description: The legacy->ai_live citable mirror must reconcile removals; and never regen the drift baseline against a broken DB
---

Two durable lessons from cutting the AI assistant onto `ai_live_documents`.

## The boot mirror is now FILL-IF-EMPTY, not authoritative (REVERSED)
Once `ai_live_documents` became directly editable (send-to-review supersede,
soft-delete/restore, direct-edit escape hatch, source-change flags — the
"Live AI Documents Lifecycle" work), the boot mirror can no longer be
authoritative: an authoritative upsert+prune would clobber human edits and
un-delete restored docs on every restart.

**Now:** `syncCitableDocsToLiveDocuments()` is a single `INSERT ... ON CONFLICT
(title) DO NOTHING` (no transaction wrapper, NO prune, NO content overwrite). It
only seeds MISSING titles from the citable legacy set — a fill-if-empty backstop,
not a source of truth. The doc comment says so explicitly.

**Why:** durability of admin edits across restart/deploy is the whole point of the
lifecycle work; overwriting/pruning at boot silently reverts them.

**How to apply:** never reintroduce prune or `ON CONFLICT DO UPDATE` here. If you
need the corpus to reflect a legacy demotion/removal, do it through the doc's own
lifecycle (soft-delete / send-to-review supersede), not the mirror. Historical
note: the mirror USED to be authoritative (upsert+prune in one tx, provenance-row
protected direct-published docs) — that design is gone by design.

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
