---
name: integrations-openai-ai-react react devDeps + libs build now in typecheck gate
description: How lib/integrations-openai-ai-react was fixed so `tsc --build` / root `typecheck:libs` passes, and that the typecheck gate now runs the full libs build.
---

# `lib/integrations-openai-ai-react` is fixed; `typecheck:libs` is now in the gate

This orphaned lib (nothing imports it; only the root `tsconfig.json` references
list + `pnpm-lock.yaml` mention it) used to fail `pnpm run typecheck:libs`
(= `tsc --build`) with `TS2307: Cannot find module 'react'` in `src/audio/*`
plus a `TS7006` implicit-any in `useVoiceRecorder.ts`.

**Why it failed:** it declared `react` only as a `peerDependency`, the monorepo
has `auto-install-peers=false`, and since nothing depends on it pnpm linked no
`node_modules/react` for it. Standalone `tsc --build` resolves each lib in its
own context, so react was unresolvable.

**The fix (durable pattern for a source-only react lib):**
- Add `react` + `@types/react` as **devDependencies** (catalog: versions) to the
  lib's `package.json`, keeping `react` as a `peerDependency` for consumers. After
  `pnpm install` they link into the lib's own `node_modules` so `tsc --build`
  resolves react.
- The implicit-any was a real annotation gap (`getTracks().forEach((t) => ...)`);
  annotate the callback param explicitly (`t: MediaStreamTrack`).

**Gate change:** the `typecheck` validation now runs
`pnpm run typecheck:libs && <portal typecheck> && <api-server typecheck>`, so the
full composite libs build is covered, not just libs consumed by portal/api-server.
Change the gate via the validation skill (`setValidationCommand`), never by editing
`.replit` directly.

**Note:** `tsc` is very slow on cold cache in this env (~45-50s of pure I/O
overhead before any real work) — a clean `tsc --build` can look like a hang; give
it the full timeout. Cached rebuilds are ~2-3s.
