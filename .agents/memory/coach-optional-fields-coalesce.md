---
name: Coach specialty/bio optional → coalesce at API
description: How nullable coach profile fields stay a string contract for the admin editor
---
coaches.specialties and coaches.bio are nullable text columns with NO default, so an empty/omitted create stores NULL and a raw select returns null.

**Rule:** the admin coach API (admin-coaches.ts COACH_COLUMNS) coalesces both to `''` via `sql<string>\`coalesce(...)\`.as(...)`. COACH_COLUMNS is the single projection shared by list/get/create/update/reorder, so one coalesce keeps every endpoint returning a plain string.

**Why:** the portal admin editor (CoachProfiles.tsx) types these as `string` and calls `.trim()` on save; a null from the API would throw when editing a coach created without specialty/bio. Normalizing at the API boundary preserves the `string` frontend contract instead of scattering null-guards.

**How to apply:** if you add another optional/nullable coach text column that the editor edits, coalesce it in COACH_COLUMNS too, or the trim-on-save path breaks for null rows.
