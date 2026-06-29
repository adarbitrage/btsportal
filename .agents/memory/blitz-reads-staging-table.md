---
name: /blitz live page reads the KB review staging table
description: Why the admin Document Review queue and the member /blitz page are coupled, and the trap of wiping the staging table.
---

The member-facing `/blitz` guide gets its lesson list from the SAME table that powers the admin "Document Review" queue: `kb_staging_docs`. The `/blitz/lessons` API (`artifacts/api-server/src/routes/blitz-lessons.ts`) selects rows WHERE `source = 'blitz'` AND `status <> 'rejected'`, and the portal's `blitz-api.ts` fetches it. So that one table does double duty — editorial review queue **and** live datastore for `/blitz`.

**Why:** Blitz lessons were originally produced through the KB content pipeline (transcripts mined into staging "drafts"); when `/blitz` was built it was wired to read those staging rows directly rather than getting its own table. This is the exact review-queue↔live-page overlap a clean DB restructure should separate.

**How to apply:** NEVER blanket-delete `kb_staging_docs` to "zero out" Document Review — deleting the `source='blitz'` rows blanks the live `/blitz` page. The boot reseeder (`blitz-seed.ts`, called from `index.ts`) re-seeds them idempotently ("N docs already exist, skipping"), which is why a wipe appears to self-heal on restart. To clear the Review queue without breaking `/blitz`, exclude/hide the `blitz` (and seeded `coaching_call`) sources from the review listing instead of deleting their rows.

**Unrelated crash note:** a half-saved edit leaving a stray `AdminLayout` reference in an admin page triggers a React "Invalid hook call" that crashes the WHOLE dev SPA (every route blanks, including `/blitz`). Fix = clean the file + restart the portal workflow to clear the stale HMR module graph.
