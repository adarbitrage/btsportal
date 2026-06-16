---
name: Monorepo typecheck stale composite cache
description: Why api-server/portal typecheck spuriously reports "@workspace/db has no exported member X" and how to fix it.
---

Running two package typechecks concurrently (e.g. `pnpm --filter ./artifacts/api-server typecheck` and `pnpm --filter ./artifacts/portal typecheck` in parallel) can corrupt the shared TS project-reference build cache, after which tsc falsely reports errors like `Module '"@workspace/db"' has no exported member 'moderationQueueTable'` or `Output file '/lib/auth/dist/index.d.ts' has not been built`.

**Why:** the workspace libs (`lib/db`, `lib/api-zod`, `lib/auth`) are `composite` projects consumed via `references` + emitted `dist/*.d.ts`. Concurrent builds race on those dist artifacts. The symbol genuinely exists in source — it's a stale-artifact lie, not a real type error.

**How to apply:** rebuild the referenced libs, then re-run the single package typecheck:
`npx tsc -b lib/db lib/api-zod lib/auth` then `pnpm --filter ./artifacts/api-server run typecheck`.
Run package typechecks **sequentially**, not in parallel. Pre-existing unrelated errors live in `storage/community.ts`, `storage/dm.ts`, several `pages/admin/*.tsx`, and the integration libs — don't chase those.

**Same trap, different symptom — stale `api-client-react` dist:** the typecheck gate (`tsc -p tsconfig.json --noEmit`, per package) consumes the **gitignored prebuilt** `lib/api-client-react/dist/*.d.ts`, it does NOT rebuild references. When a feature regenerates the OpenAPI client SOURCE (`lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/*`) but nobody rebuilds the dist, portal/api-server typecheck fails with phantom `Property 'X' does not exist on type 'MemberProfile'` / `'X' does not exist in type 'PatchMemberProfileBody'` / `'recentTools' does not exist on type 'DashboardData'` for the brand-new field — even though the source clearly has it. Fix: `npx tsc -b lib/api-client-react --force` (it's slow, >90s — the agent bash tool kills it returning exit -1 with the build still completing; verify by re-grepping the dist `.d.ts` for the field, or run the `typecheck` workflow). Don't "fix" the field on the consuming side; the field is real, the dist is stale.

## api-client-react stale dist .d.ts
Portal references @workspace/api-client-react as a TS composite project (tsconfig
`references`), so `tsc -p portal/tsconfig.json` reads the EMITTED
`lib/api-client-react/dist/generated/*.d.ts`, NOT the `src` (even though
package.json `exports` points to src). If the generated `src` schemas gain a field
(e.g. `deliveryStatus` on TicketWithMessages) but the dist isn't rebuilt, portal
typecheck fails with "Property X does not exist" while src looks correct.
**Fix:** `tsc -p lib/api-client-react/tsconfig.json` (direct project compile).
`tsc -b ... --force` tends to time out in the agent env; the direct `-p` compile finishes.
