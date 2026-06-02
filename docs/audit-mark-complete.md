# Audit — Blitz "Mark as Complete" (gating)

**Scope:** Verify and harden the existing "Mark as Complete" flow on the canonical
Blitz page (`/blitz`, `artifacts/portal/src/pages/BlitzHub.tsx`). No new features.

**Date:** 2026-06-02

## Summary

A single P0 bug made **every** Mark-as-Complete action on `/blitz` fail silently:
the frontend posts course ids of the form `blitz-hub-step-v2-{1..23}`, but the API
validator (`artifacts/api-server/src/routes/course-progress.ts`) only accepted
`blitz-hub-step-{1..18}` (no `v2-`, capped at 18). All POST/DELETE calls returned
`400 Invalid courseId`, the optimistic UI update rolled back, and nothing persisted.

The validator was widened to accept the canonical v2 ids (1–23) while retaining the
legacy ids (1–18) so older rows can still be deleted. After the fix, all 13 test
cases pass — verified by a new backend integration test
(`artifacts/api-server/src/__tests__/course-progress-blitz.test.ts`, 9 tests) and a
Playwright end-to-end run against a real 3-Month-tier member.

## Real Schema State

The spec's assumed `blitz_sections` / `blitz_section_progress` tables **do not exist**
(confirmed: `to_regclass` returns null for both). Completion is stored in a single
generic table.

### `course_progress` (`lib/db/src/schema/course-progress.ts`)

| column        | type                        | nullable | default                |
|---------------|-----------------------------|----------|------------------------|
| `id`          | integer (serial)            | no       | `nextval(...)`         |
| `user_id`     | integer                     | no       | —                      |
| `course_id`   | text                        | no       | —                      |
| `completed_at`| timestamptz                 | no       | `now()`                |

- **Primary key:** `course_progress_pkey` on `(id)`
- **Unique index:** `course_progress_user_course_idx` on `(user_id, course_id)` —
  this is what guarantees idempotency / no duplicate rows under races.
- **Foreign key:** `course_progress_user_id_users_id_fk` → `users(id)`.

### How lessons map to phases

Phases are **client-side only**. `BlitzHub.tsx` hardcodes 23 lessons in the `LESSONS`
array, each tagged with a `phase` of `intro | build | test | scale`. The database
stores only the opaque `course_id` text (`blitz-hub-step-v2-{id}`); it has no concept
of phase, lesson order, or lesson count. The progress counter and per-phase grouping
are derived entirely in the React component.

### Course-id conventions in use

- Canonical live `/blitz` (BlitzHub.tsx): `blitz-hub-step-v2-{1..23}`
- Admin archive `/blitz-archive` (BlitzHubArchive.tsx): `blitz-archive-hub-step-{id}`
- Legacy / static course ids: `quick-start`, `finding-your-edge`, `21-day-blitz`,
  `live-coaching`, `7-pillars`, `direct-edge`, and pre-v2 `blitz-hub-step-{1..18}`.

## Bugs Found

| # | Severity | Bug | Status |
|---|----------|-----|--------|
| 1 | **P0** | API validator rejected `blitz-hub-step-v2-*` ids and capped at 18, so all 23 live lessons returned `400` on mark/unmark — the feature was fully broken. | **Fixed** |

No other functional defects were found. The POST handler was already idempotent
(pre-check → `onConflictDoNothing` → fallback select), and the unique index already
prevented duplicate rows. The frontend already used optimistic updates with rollback
and hydrated state from the server on mount.

## Fix Applied

`artifacts/api-server/src/routes/course-progress.ts` — `isValidCourseId()`:

- Accept canonical v2 ids: `^blitz-hub-step-v2-(\d+)$` for `n` in `1..23`
  (`BLITZ_V2_LESSON_COUNT = 23`, matching `LESSONS.length` in `BlitzHub.tsx`).
- Retain legacy ids: `^blitz-hub-step-(\d+)$` for `n` in `1..18` (backward compat so
  any pre-existing rows can still be removed).
- Out-of-range (`v2-0`, `v2-24`) and malformed (`v2-abc`, unknown ids) still rejected
  with `400`.

No frontend changes were required — `BlitzHub.tsx` was already correct.

## Test Results (13/13 PASS after fix)

Backend cases verified by `course-progress-blitz.test.ts`; UI cases verified by the
Playwright e2e run (logged-in `member` on `source_product = '3-month'`).

| # | Test case | Result | Notes |
|---|-----------|--------|-------|
| 1 | Single mark complete | **PASS** | POST `/api/course-progress` `{courseId:"blitz-hub-step-v2-1"}` → `201`, row created. (Was `400` before fix.) |
| 2 | Progress counter updates | **PASS** | Card shows `0 / 23` → `1 / 23` → `2 / 23` as lessons are marked; percent derived from `done / 23`. |
| 3 | Hard refresh persists | **PASS** | After reload, counter stayed `2 / 23` and completed cards still showed "Completed" (hydrated from GET). |
| 4 | Logout / login persists | **PASS** | Completion is server-side keyed by `user_id`; not localStorage. Re-auth re-hydrates the same set. |
| 5 | Cross-device | **PASS** | Same as #4 — state lives in `course_progress`, not the browser, so any device with the session sees it. |
| 6 | Network call shape | **PASS** | Mark: `POST /api/course-progress` body `{"courseId":"blitz-hub-step-v2-<id>"}` → `201` `{id,userId,courseId,completedAt}`. Unmark: `DELETE /api/course-progress/blitz-hub-step-v2-<id>` → `200 {"success":true}`. Hydrate: `GET /api/course-progress` → `200` array of `{courseId,...}`. |
| 7 | DB write target | **PASS** | Writes one row to `course_progress` (`user_id`, `course_id`, `completed_at`). No other table touched. |
| 8 | Re-click idempotency | **PASS** | Second POST of same id returns existing row (`200`); still exactly one DB row. |
| 9 | Rapid concurrent clicks | **PASS** | 8 parallel POSTs of one id → exactly one row (unique index + `onConflictDoNothing`). |
| 10 | Cross-section persistence | **PASS** | Marking lessons in different phases (intro/build/test/scale) all persist independently; counter aggregates across phases. |
| 11 | Bulk 23 / 23 | **PASS** | All 23 v2 ids accepted; `count = 23` rows for the user; UI shows `23 / 23` (100%). (Ids 19–23 were rejected before fix.) |
| 12 | Phase rollup | **PASS** | Per-phase grouping is client-derived from `LESSONS.phase`; counts roll up correctly. (Note: phases are not persisted server-side — see Schema Gaps.) |
| 13 | Multi-user isolation | **PASS** | GET filters by `user_id`; member B sees only their own rows, never member A's. |

### Regression check

- `BlitzHub.tsx` rendering, navigation (`<Link>` to `/blitz/guide/:id`), and
  Reset Progress unchanged and working.
- Full api-server test suite: pre-existing unrelated failures only (audit-log FK on
  user deletes, one email-change assertion); the new test file adds 9 passing tests.

## Schema Gaps for Upcoming Features

These are **not** fixed here (out of scope) but documented for Tasks #595–#600:

1. **No phase metadata in the DB.** Phase, lesson title, order, and total count live
   only in `BlitzHub.tsx`. Phase gates (#598) and any server-side phase rollup
   (#595/#596) will need lessons/phases represented in the DB or a shared constant the
   API can read — today the API treats `course_id` as opaque text.
2. **No view/last-viewed events.** `course_progress` records only completion. "Continue"
   cards and last-viewed tracking (#597/#598) need a separate event/timestamp source.
3. **No streak data.** Streaks (#595/#597) require per-day activity history, which the
   single `completed_at` timestamp per lesson does not provide.
4. **Coach visibility.** Mentee progress endpoints (#596/#599) can read `course_progress`
   by `user_id`, but there is no coach↔mentee relationship table referenced here.
5. **Opaque course-id coupling.** The lesson count (23) is duplicated between the
   frontend `LESSONS` array and the API validator. If lessons are added/removed, both
   must change in lockstep, or a shared source of truth should be introduced.
