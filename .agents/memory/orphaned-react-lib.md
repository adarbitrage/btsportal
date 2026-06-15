---
name: orphaned integrations-openai-ai-react lib breaks full libs build
description: Why `tsc --build` / root `typecheck:libs` fails on lib/integrations-openai-ai-react and why the typecheck gate skips it.
---

# `lib/integrations-openai-ai-react` fails the composite libs build

`pnpm run typecheck:libs` (= `tsc --build`, builds every lib in the root
tsconfig references) fails with `TS2307: Cannot find module 'react'` in
`lib/integrations-openai-ai-react/src/audio/*` plus a cascaded `TS7006`
implicit-any.

**Why:** that lib declares `react` only as a `peerDependency`, the monorepo has
`auto-install-peers=false`, and its lockfile entry is empty
(`lib/integrations-openai-ai-react: {}`), so no `node_modules/react` symlink
exists for it. It is **orphaned** — nothing imports it (only the root
`tsconfig.json` references list and `pnpm-lock.yaml` mention it). It is not in
any artifact's tsconfig references and not in the portal's `vite build` deploy
path, so its type errors cannot reach users.

**How to apply:**
- Do not put `typecheck:libs` / `tsc --build` in the typecheck validation gate —
  it will go red on this orphaned lib for reasons unrelated to shipped code.
- The `typecheck` gate runs portal + api-server typechecks instead; both resolve
  `@workspace/*` deps to their TS source via package `exports`, so they already
  type-check every lib that is actually consumed.
- If this lib is ever wired into an artifact, first give it real react/@types/react
  devDeps (or rely on the consumer providing them) so the composite build resolves
  react, and fix the implicit-any in `useVoiceRecorder.ts`.
