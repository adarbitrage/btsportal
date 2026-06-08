---
name: Applying data fixes/cleanups to the production DB
description: Why one-shot DB data repairs must run from server startup, not post-merge, to reach prod
---

# Reaching the production database with a data fix

Production is a **separate database**. `post-merge.sh` (the `[postMerge]` hook in
`.replit`) only ever runs against the **dev** `DATABASE_URL`. The agent cannot
write prod directly (`executeSql` prod is read-only) and cannot republish.

**So a data repair/cleanup only reaches prod if a freshly-deployed instance
applies it on boot.** The established pattern: run it as an idempotent startup
hook against whatever `DATABASE_URL` the instance comes up with.

- Critical, must-finish-before-traffic work → awaited in
  `bootstrapCriticalPrerequisites()` (artifacts/api-server/src/index.ts).
- Background cleanup that shouldn't block the HTTP listen → fire-and-forget
  after `app.listen` or inside the background chains in
  `bootstrap-critical-prerequisites.ts` (e.g. KB seed + the knowledgebase_docs
  privacy re-scrub) and `purgeSeedCommunityPosts()` / `seedBlitzDocs()`.

**Rules:** the hook MUST be idempotent (only write changed rows) so it's a safe
no-op on every autoscale cold start; log loudly so on-call sees drift in deploy
logs. Keep it duplicated in post-merge.sh too so dev stays clean between deploys.

**Bundle gotcha:** the server is esbuild-bundled to one `dist/index.cjs`, which
rewrites every module's `import.meta.url` to the entry's. A `tsx`-style CLI guard
(`if (import.meta.url === \`file://${process.argv[1]}\`) process.exit(...)`) can
therefore fire from inside the bundle and kill the server on boot. Keep the
reusable function in a side-effect-free lib module and keep the CLI runner in a
separate `scripts/*.ts` that is never imported by `index.ts`.
