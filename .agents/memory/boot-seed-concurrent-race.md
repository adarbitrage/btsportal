---
name: Boot-seed check-then-insert race
description: Concurrent API boots duplicate insert-only boot seeds unless serialized
---
Rule: any insert-only boot seed that does check-then-insert (no unique DB constraint on its idempotency key) must serialize concurrent runs with `pg_advisory_lock` (or gain a unique index), because two API processes booting in the same instant both pass the existence check and double-seed.

**Why:** the headline-concepts staging seed double-inserted (16 rows instead of 8, identical pairs created in the same millisecond) when two server boots overlapped right after a task merge. Cleanup = soft-delete the higher-id duplicate of each pair (staging deletes are status='deleted', never row DROP).

**How to apply:** when writing or reviewing a boot seed, check for a unique constraint on the idempotency key; if none, wrap the seed body in `db.transaction` with `pg_advisory_xact_lock` and run EVERY seed query through `tx` (see seed-headline-concepts-staging.ts). A bare session-level `pg_advisory_lock` via pooled `db.execute` is WRONG — lock, work, and unlock can land on different pooled connections (no mutual exclusion + leaked lock).

Related: the staging Document Review list route excludes `status='deleted'` tombstones from unfiltered/All views and all facet counts; only an explicit `?status=deleted` shows them. Don't regress this when touching the list/aggregate scopes.
