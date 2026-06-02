---
name: Monorepo typecheck stale composite cache
description: Why api-server/portal typecheck spuriously reports "@workspace/db has no exported member X" and how to fix it.
---

Running two package typechecks concurrently (e.g. `pnpm --filter ./artifacts/api-server typecheck` and `pnpm --filter ./artifacts/portal typecheck` in parallel) can corrupt the shared TS project-reference build cache, after which tsc falsely reports errors like `Module '"@workspace/db"' has no exported member 'moderationQueueTable'` or `Output file '/lib/auth/dist/index.d.ts' has not been built`.

**Why:** the workspace libs (`lib/db`, `lib/api-zod`, `lib/auth`) are `composite` projects consumed via `references` + emitted `dist/*.d.ts`. Concurrent builds race on those dist artifacts. The symbol genuinely exists in source — it's a stale-artifact lie, not a real type error.

**How to apply:** rebuild the referenced libs, then re-run the single package typecheck:
`npx tsc -b lib/db lib/api-zod lib/auth` then `pnpm --filter ./artifacts/api-server run typecheck`.
Run package typechecks **sequentially**, not in parallel. Pre-existing unrelated errors live in `storage/community.ts`, `storage/dm.ts`, several `pages/admin/*.tsx`, and the integration libs — don't chase those.
