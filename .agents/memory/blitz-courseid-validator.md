---
name: Blitz course-id validator coupling
description: Mark-Complete on /blitz depends on the API validator accepting the exact course-id ids the frontend sends; the lesson count is duplicated.
---

# Blitz Mark-Complete course-id coupling

`/blitz` (BlitzHub.tsx) persists completion to the generic `course_progress` table
(no `blitz_sections` table exists) via course ids of the form `blitz-hub-step-v2-{1..N}`.
The API route `course-progress.ts` `isValidCourseId()` must accept those ids or every
POST/DELETE returns `400 Invalid courseId` and nothing persists (the UI optimistic
update silently rolls back — looks like "nothing happens on click").

**Rule:** the lesson count is duplicated in two places that must stay in lockstep:
- frontend `LESSONS` array length in `artifacts/portal/src/pages/BlitzHub.tsx`
- `BLITZ_V2_LESSON_COUNT` in `artifacts/api-server/src/routes/course-progress.ts`

**Why:** there is no shared source of truth; the DB treats `course_id` as opaque text.
Adding/removing a Blitz lesson without bumping the validator range silently breaks
marking for the new ids.

**How to apply:** when changing the number of Blitz lessons, update both. The archive
hub (`/blitz-archive`, BlitzHubArchive.tsx) uses a different prefix
`blitz-archive-hub-step-{id}`; legacy pre-v2 ids `blitz-hub-step-{1..18}` are still
accepted so old rows can be deleted. Regression coverage:
`artifacts/api-server/src/__tests__/course-progress-blitz.test.ts`.
