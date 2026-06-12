---
name: Post-merge timeout — conditional drizzle push
description: Why scripts/post-merge.sh gates push-force behind the drift test, and how to keep it under the timeout.
---

# Post-merge setup timeouts: drizzle push is the culprit

`scripts/post-merge.sh` used to run `pnpm --filter db push-force` on EVERY merge.
`drizzle-kit push --force` does a full "Pulling schema from database" introspection
of the entire (large, drifted) DB every time — 1-3 min, and much worse during a
burst of concurrent merges (DB/CPU contention). That unconditional push is what
blew past the post-merge timeout (seen failing at both 90s and 240s).

**Rule:** do not run `push-force` unconditionally in post-merge. Gate it on the
drift test (`@workspace/db` `src/live-schema-drift.test.ts`):
- drift test PASS → schema already in sync → skip push (common fast path).
- drift test FAIL → genuine un-applied schema change → run push-force, then
  re-run the drift test to confirm it resolved (belt-and-braces: catches a
  partial/skipped push leaving the DB out of sync).

**Why:** push and the drift test compare the same source of truth (lib/db/src/schema/).
If the DB already matches, push is a pure-overhead no-op. Skipping it removes the
biggest, most load-sensitive cost from the ~majority of merges that touch no schema.

**How to apply:** the drift test's vitest globalSetup applies the idempotent
companion `.sql` migrations (SYNC_MIGRATIONS_ONLY) before asserting, so columns
added WITH a companion file keep the test green (push skipped, already applied);
columns added WITHOUT one make it fail → push applies them. `set -e` is safe
because a command in an `if` condition does not trip it.

**Known gap (accepted):** the drift test checks tables/columns, not
indexes/constraints/enums. An index/constraint-only change with no companion
`.sql` is invisible to the gate and its push is skipped — fine for a dev DB
(perf-only; constraint changes normally ship with companion `.sql`).

**Timeout:** configured via `setPostMergeConfig({ timeoutMs })` in `.replit`.
Raising the timeout alone did NOT fix this (the push is effectively unbounded
under load) — the conditional gate is the real fix. Current value 300000ms gives
headroom for the rare push branch under contention.
