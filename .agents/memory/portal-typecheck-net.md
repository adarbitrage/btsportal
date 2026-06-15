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

## How to verify the portal typecheck
- Full tsc run exceeds the 120s bash limit and tsc only emits output at the end.
- Use the `portal-typecheck` workflow: it writes to `/tmp/ptc.log` and appends
  `TYPECHECK_EXIT=$?`. Restart the workflow, wait ~150s, then
  `grep -c "error TS" /tmp/ptc.log` and check `TYPECHECK_EXIT=0`.
- Referenced libs must be built/cached; run lib typechecks before/sequentially
  to avoid the composite-ref cache corruption (see monorepo-typecheck-cache).

## Known generated-type vs backend drift
- `useGetDashboard` returns the generated `DashboardData`
  (`lib/api-zod` / `lib/api-client-react`, source `lib/api-spec/openapi.yaml`).
- The dashboard handler (`artifacts/api-server/src/routes/dashboard.ts`)
  returns a `recentTools` array that is NOT in the OpenAPI/Zod schema.
- Portal currently patches this with a local typed cast in `Dashboard.tsx`.
  The real fix is to add `recentTools` (optional array of
  {id,slug,name,shortDescription,icon,isFeatured}) to the spec and regenerate.
