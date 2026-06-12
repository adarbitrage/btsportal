---
name: api-server route/lib schema drift hidden behind `as any`
description: Several api-server routes/libs reference DB columns that no longer exist; typecheck only passes because of `as any` casts that preserve the (broken) runtime.
---

When a typecheck-only task forbids runtime changes, genuine schema drift was cleared with type assertions, NOT real fixes. These call sites are runtime-broken and the casts mask it — do not treat them as working.

**Drifted areas (column names the code wants vs. what the schema has):**
- `routes/vault.ts` + `lib/seed-vault.ts`: code uses `slug` / `type` on vault resources, but `vaultResourcesTable` only has `resourceType` (no `slug`, no `type`). Download gate `resource.type !== "file"` is always true → downloads always 400. seed-vault inserts `slug`/`type` (non-columns) and keys a relations map by `r.slug` (always undefined) → relations collapse.
- `routes/admin-communications.ts` (sequences feature): inserts `sequencesTable` without required `slug`; reads/writes `sequenceStepsTable.sortOrder` (col is `stepOrder`); sets `sequencesTable.status` (no such column). All sequence create/step/pause/resume endpoints would throw at runtime.
- `lib/slot-engine.ts`: filters coach date overrides by `o.isBlocked`, but the override schema has `overrideType` (no `isBlocked`) → blocked-day logic never triggers.

**Why:** Task #803 constraint was "type-level/test-level only — NO runtime behavior changes to routes." The correct fix for these is a real schema/code reconciliation, which was out of scope.

**How to apply:** If asked to fix vault downloads, marketing sequences, or coach availability overrides, start by reconciling the route/lib code against the authoritative schema in `lib/db/src/schema/` — the `as any` casts there are deliberate drift markers, not solved problems.
