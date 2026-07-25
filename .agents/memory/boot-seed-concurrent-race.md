---
name: Boot-seed check-then-insert race
description: Concurrent API boots duplicate insert-only boot seeds unless serialized
---
Rule: any insert-only boot seed that does check-then-insert (no unique DB constraint on its idempotency key) must serialize concurrent runs with `pg_advisory_lock` (or gain a unique index), because two API processes booting in the same instant both pass the existence check and double-seed.

**Why:** the headline-concepts staging seed double-inserted (16 rows instead of 8, identical pairs created in the same millisecond) when two server boots overlapped right after a task merge. Cleanup = soft-delete the higher-id duplicate of each pair (staging deletes are status='deleted', never row DROP).

**How to apply:** when writing or reviewing a boot seed in bootstrap-critical-prerequisites, check for a unique constraint on the idempotency key; if none, wrap the seed body in a session advisory lock released in `finally` (see seed-headline-concepts-staging.ts for the pattern).
