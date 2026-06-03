---
name: Blitz curriculum single source (@workspace/blitz-curriculum)
description: The 23-step/4-phase Blitz skeleton lives in one shared package; surface label maps stay local but must be drift-guarded.
---

# Blitz curriculum single source

The Blitz curriculum **skeleton** (phases + per-section id/courseId/phase/step/title/anchor,
plus courseId helpers) is owned by the shared workspace package `@workspace/blitz-curriculum`
(`lib/blitz-curriculum`). Both the portal and the api-server import it; the api-server's
`src/lib/blitz/sections.ts` is just a re-export shim.

**Rule — presentational label maps stay local but MUST be drift-guarded.**
Surface-specific copy (lesson-hub long descriptions/tags, guide pager short titles + chrome
labels, the BlitzContinueCard's compact card labels) intentionally lives next to the component
that renders it, keyed by the canonical section ids. Every such map is exported and asserted to
cover **exactly** `BLITZ_SECTION_IDS` by the portal drift test
`artifacts/portal/src/pages/__tests__/blitz-curriculum-drift.test.tsx`.

**Why:** Without the guard, adding/removing a section in the shared source would let a lesson
render with a blank description/label/title — a silent member-visible break. The guard fails
loudly instead. When you add a new presentational map for a Blitz surface, export it and add it
to that drift test.

**Why labels are NOT derived from the shared titles:** the card/pager use deliberately shortened
text; deriving from the canonical full titles would change what members see. Keep them local.

**courseId prefix is single-sourced too.** Raw-SQL filters that match v2 rows
(`continue-resolver.ts`, `coach-dashboard.ts`) use `BLITZ_V2_COURSE_ID_SQL_PATTERN`
(`^blitz-hub-step-v2-[0-9]+$`) via `sql.raw`, not a hardcoded literal. Note the SQL match is
prefix+`[0-9]+` (NOT bounded to 1..23) — left as-is to avoid a behavior change; `isValidBlitzCourseId`
is the bounded (1..count) check for app logic.
