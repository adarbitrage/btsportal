---
name: support-config composite dist goes stale
description: Why portal/api typecheck fails with "no exported member" / TS6305 from @workspace/support-config and how to fix
---
Symptom: portal typecheck fails with `@workspace/support-config has no exported member 'formatTicketCategory'/'validateTicketAttachment'/'TICKET_CATEGORY_LABELS'` even though they ARE in `lib/support-config/src/index.ts`.

Cause: support-config is a `composite` + `emitDeclarationOnly` project that emits `dist/index.d.ts`. Although package.json `exports` points at `./src/index.ts`, TS project-reference resolution consumes the emitted `dist/*.d.ts`. When a new export is added to src but the dist is never regenerated (tsbuildinfo thinks it's up-to-date), consumers see the OLD declaration. Plain `pnpm run typecheck:libs` (`tsc --build`) may NOT regenerate it.

**Why:** stale composite build output, not a real code error.
**How to apply:** force-rebuild the single project: `npx tsc -b lib/support-config --force` (regenerates dist/index.d.ts), then re-run portal/api typecheck. Do NOT just delete dist+tsbuildinfo and rerun `tsc --build` — that left dist missing entirely and produced TS6305 "Output file has not been built from source file". The `--force` on the specific project is the reliable fix.
