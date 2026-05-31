---
name: Blitz guide — live is hand-maintained, archive is generated/frozen
description: The canonical /blitz guide is now a hand-maintained page; the old generated guide is archived and frozen. Critical constraint for any guide edit or restyle.
---

**Current state (the Blitz promotion):** The canonical live guide at `/blitz` is `artifacts/portal/src/pages/Blitz.tsx` (promoted from the former Blitz v2). It is **hand-maintained** — edit it directly. The old generated guide was retired to admin-only `/blitz-archive` (`BlitzArchive.tsx`), and its lesson library is **frozen** to a static JSON snapshot (`components/blitz/blitz-archive-lessons.json`) so live DB edits never touch the backup.

**Regenerator is disabled:** `artifacts/api-server/src/scripts/build-blitz-from-html.ts` still writes its output to `Blitz.tsx` (now the live guide), so running it would clobber hand-maintained content. It is gated behind `ALLOW_BLITZ_REGEN`; it hard-throws by default. Do **not** re-enable it to make guide edits — edit `Blitz.tsx` directly.
**Why:** the HTML-from-attached_assets workflow was the original authoring path; the v2 redesign moved authoring into the .tsx itself, so the generator is now a foot-gun, not a tool.

**Legacy note (applies only to the archived generated guide `BlitzArchive.tsx`):** its body is a large raw HTML string injected via `dangerouslySetInnerHTML`, scoped by a `blitzCSS` constant, and was produced by the generator from `attached_assets/`. Runtime hooks it relies on: `data-section` (deep-link filtering), `id="sN"` anchor spans, `.module`/`.mod-badge`/`.path-tag` classes, `MODULE1_OVERRIDES`/`LESSON_LOOKUP`. The archive is admin-only and slated for deletion before launch, so generally leave it alone.

**Lesson Library removed by design:** the live `/blitz` guide has **no Lesson Library** (no `LessonLibrary` import/mount in `Blitz.tsx`) — the user deleted it on purpose. Do not add it back or treat its absence as a bug. All Blitz content edits go into the live `/blitz` only; do not touch or mention `/blitz-archive` unless the user specifically asks.
