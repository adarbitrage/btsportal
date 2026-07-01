---
name: ai_live_documents mirror authority + drift baseline regen trap
description: The legacy->ai_live citable mirror must reconcile removals; and never regen the drift baseline against a broken DB
---

Two durable lessons from cutting the AI assistant onto `ai_live_documents`.

## The citable mirror must be authoritative, not append-only
`syncCitableDocsToLiveDocuments()` mirrors the human-verified citable set
(doc_class IN curated/overview AND last_verified NOT NULL) from legacy
`knowledgebase_docs` into `ai_live_documents` (what the assistant retrieves).
An append-only upsert silently leaves revoked/demoted/deleted docs citable
forever. It MUST also prune.

**Why:** several writers stay on legacy (seeders, admin-chat CRUD, kb-flags), so
legacy citability changes at runtime; without a prune the assistant corpus
diverges from "current citable legacy set" and cites stale docs.

**How to apply:** run upsert + prune in ONE transaction. Distinguish the two
origins in `ai_live_documents`: push-approved (staging publish) docs each get a
`kb_doc_provenance` row (relation='source'); the mirror never writes provenance.
So prune = delete ai_live rows that have NO provenance row AND no
currently-citable legacy twin (same title). That preserves direct-published docs
while removing dead mirror rows.

A boot-only sync is NOT enough: any RUNTIME writer to legacy citable docs (admin
KB CRUD is the live one; kb-flags is read-only, seeders run at boot) must call the
reconcile after its write, or the assistant lags legacy until the next restart.
Wire it best-effort (legacy write already committed; boot sync is the backstop) so
a mirror hiccup never fails the admin request.

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
