---
name: portal typecheck not in deploy build
description: Why portal type errors never block deploy, how to verify typecheck, and a known generated-type-vs-backend drift.
---

# Portal typecheck is not part of the deploy build

The portal deploy build runs plain `vite build` (esbuild transpile, no type
checking). That is why type errors can accumulate without ever blocking a
deploy. A dedicated `pnpm --filter @workspace/portal typecheck`
(= `tsc -p artifacts/portal/tsconfig.json --noEmit`) is the only net.

**Why:** the build never type-checks; only an explicit tsc run does.

## The net: `typecheck` validation gate
- A registered validation command named `typecheck` is the CI net:
  `pnpm --filter @workspace/portal run typecheck && pnpm --filter @workspace/api-server run typecheck`
  (sequential to avoid the composite-ref cache corruption, see
  monorepo-typecheck-cache). It gates merges (isValidation) and is also wired
  into the `Project` run button. The old console-only `portal-typecheck`
  workflow was removed (it never gated anything).
- Full tsc run exceeds the 120s bash limit; the validation runner has no such
  limit (~77s for both). Don't try to run it through the bash tool directly.
- Do NOT add the root `typecheck:libs` (`tsc --build`) to the gate: the orphaned
  `lib/integrations-openai-ai-react` fails the composite build (react is only a
  peerDep, auto-install-peers=false, nothing imports it). Portal+api-server
  typechecks resolve workspace deps to their TS source via package `exports`, so
  they already cover every lib that actually reaches users. See
  orphaned-react-lib for detail.

## Regenerating types must also rebuild lib dist .d.ts
- The portal consumes `@workspace/api-client-react` via TS project references,
  which read the package's emitted `dist/**/*.d.ts` — NOT its `src`.
- So after editing `lib/api-spec/openapi.yaml` + running api-spec `codegen`,
  the portal typecheck still fails (e.g. TS2339 "X does not exist on
  DashboardData") until you rebuild the lib declarations:
  `tsc -b lib/api-client-react --force`. Then restart `portal-typecheck`.
- **Why:** codegen only updates the lib's source; the stale dist .d.ts is what
  the portal actually sees.
- codegen (orval) and the lib declaration build each exceed the 120s bash
  limit; run them detached (setsid + poll) — detached jobs DO survive here.

## (resolved) DashboardData recentTools drift
- `recentTools` is now declared in the spec (`RecentTool` schema) and the
  Dashboard.tsx local cast was removed. Field is optional array of
  {id,slug,name,shortDescription,icon(nullable),isFeatured}.
