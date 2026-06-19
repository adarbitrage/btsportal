---
name: support-config dist goes stale (composite ref not in root build)
description: Editing lib/support-config source can break the portal/api typecheck because its committed dist .d.ts is stale; root typecheck:libs never rebuilds it.
---

`lib/support-config` is a `composite` + `emitDeclarationOnly` TS project consumed by
the portal/api-server through its generated declarations in `lib/support-config/dist`.

**The trap:** the root `tsconfig.json` `references` list (built by `typecheck:libs` =
`tsc --build`) does NOT include support-config (nor `lib/auth`,
`lib/moderation-shared`, `lib/blitz-curriculum`). So editing support-config source
(new export, re-export) does NOT regenerate its committed dist. Consumers then
typecheck against stale declarations and fail with `"@workspace/support-config" has
no exported member named X`.

Incremental builds make it worse: a stale `lib/support-config/tsconfig.tsbuildinfo`
can leave a re-exported file (e.g. `upload-limits.d.ts`) un-emitted while `index.d.ts`
contains `export * from "./upload-limits"` pointing at a missing file.

**Fix when you hit it:**
```
rm -f lib/support-config/tsconfig.tsbuildinfo
rm -rf lib/support-config/dist
pnpm exec tsc --build lib/support-config --force
```
then re-run `pnpm run typecheck`. Commit the regenerated dist.

**Why:** the validation gate runs `typecheck:libs && portal/api typecheck`; a stale
committed dist fails it even when your own change is unrelated/correct.
