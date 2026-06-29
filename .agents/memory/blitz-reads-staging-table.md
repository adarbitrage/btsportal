---
name: Blitz is fully decoupled from the KB staging table
description: Blitz lessons now live in their own blitz_lessons table, NOT in kb_staging_docs; history of the old coupling and why a wipe used to blank /blitz.
---

**CURRENT STATE (decoupled):** Blitz curriculum lessons live in their OWN dedicated `blitz_lessons` table. They are NO LONGER in `kb_staging_docs`. The `/blitz/lessons` API, the admin Blitz video pipeline (`knowledgebase-pipeline.ts`), and the snapshot script all read/write `blitz_lessons`. Blitz was removed from the AI "Document Review" surface (`knowledgebase-staging.ts` source filter + portal `KnowledgeBaseReview.tsx` facet) so the pipeline can never re-pollute staging. The 119 `coaching_call` rows still live in `kb_staging_docs` (intentionally not decoupled).

The data move is an idempotent, data-safe boot hook `migrateBlitzLessons()` in `artifacts/api-server/src/lib/blitz-seed.ts`: it copies any legacy `source='blitz'` staging rows (dedup by title, normalizing the staging default `pending_review`→`published`, preserving `rejected`) into `blitz_lessons` BEFORE deleting them from staging — copy-before-delete so an interrupted boot loses nothing. On a fresh env it seeds from `blitz-seed.json`. Reaches prod on server boot (already wired into the boot path).

**Why:** Blitz lessons were originally produced through the KB content pipeline and `/blitz/lessons` was wired to read the staging rows directly — an implementation shortcut that coupled the editorial review queue to the live datastore. The full decouple separated them so the admin Document Review queue only shows real AI-review content.

**How to apply:** To change Blitz lesson content/data, touch `blitz_lessons` (or the boot seed / `blitz-seed.json`), never `kb_staging_docs`. Do NOT reintroduce a `source='blitz'` branch into the staging routes or pipeline. NOTE: the live member `/blitz` and `/blitz/guide` pages render from `@workspace/blitz-curriculum` + inline copy and do NOT call `/blitz/lessons` at all — that endpoint feeds only the (dead) `LessonLibrary.tsx` and the archive snapshot script.

**Historical (pre-decouple) trap — no longer applies:** deleting `source='blitz'` rows from `kb_staging_docs` used to blank the live `/blitz` page; the boot reseeder self-healed it on restart. That coupling is gone.

**Unrelated crash note:** a half-saved edit leaving a stray `AdminLayout` reference in an admin page triggers a React "Invalid hook call" that crashes the WHOLE dev SPA (every route blanks). Fix = clean the file + restart the portal workflow to clear the stale HMR module graph.
