# BTS Blitz — Progress Tracking Audit + Enhancements

**Context:** The "Mark as Complete" feature exists on The Blitz curriculum page but may not be fully working. Need a Replit-led audit, then five layered enhancements: Continue Where You Left Off, Phase Gates (80% threshold), Coach Visibility Dashboard, Last-Viewed Tracking, and Streak/Cadence Display.

**Skipped (deferred):** Section notes, spaced review nudges.

---

## Dependency Graph

```
TIER 0:              Task 1 (Audit + fix existing Mark Complete)
TIER 1 (parallel):   Task 2 (Backend extension: schema, last-viewed, streaks)
                     Task 3 (Coach dashboard backend)
TIER 2 (parallel):   Task 4 (Dashboard widgets — Continue + Streak)
                     Task 5 (Blitz page: phase gates + last-viewed tracking)
                     Task 6 (Coach dashboard frontend)
TIER 3:              Task 7 (Routing + nav + seed)
```

Task 1 is gating — nothing else starts until the audit is complete and existing bugs are fixed.

---

## Task 1: Audit + Fix Existing Mark Complete (GATING)

### What This Does
Test the live Mark Complete feature end-to-end, document findings, fix any broken behavior. This task is sequential — must complete and verify before any other task starts.

### Required Test Cases
Run each test case as a real user (test member account on a 3-Month+ tier). Document each as PASS / FAIL with notes.

1. **Single mark:** Click "Mark as Complete" on Section 1. Does the button visually update to a checked/completed state immediately?
2. **Progress counter:** Does "Your Progress" update from `0/23` to `1/23` and the bar fill ~4%?
3. **Hard refresh:** Reload the page. Does Section 1 still show complete? Counter still `1/23`?
4. **Logout/login:** Sign out, sign back in. Does Section 1 still show complete?
5. **Cross-device:** Log into the same account in an incognito window or different browser. Does the same state appear?
6. **Network call:** With DevTools open, click Mark Complete. Capture the request URL, method, payload, response status, response body. Document the endpoint.
7. **DB write:** After the click, query the database directly. Is a row inserted/updated? Which table? Which columns?
8. **Re-click (idempotency):** Click Mark Complete on an already-complete section. Does it un-mark (toggle off), no-op silently, or error?
9. **Rapid clicks:** Click Mark Complete 5 times in rapid succession on the same section. Any race condition? Duplicate rows? Error toast?
10. **Cross-section:** Mark sections 1, 3, and 5 complete (skip 2 and 4). Verify each persists. Verify counter shows `3/23`.
11. **Bulk progress:** Mark all 23 sections complete. Does counter show `23/23` and "100% complete"?
12. **Phase rollup:** With all "Introduction" phase sections complete, does any phase-level indicator update? (May not be wired yet — note current state.)
13. **Multi-user isolation:** Mark sections complete on User A. Log into User B's account. User B's progress should be independent (0 complete).

### Schema Audit
Document the current data model:
- Which table tracks completion? (`blitz_section_progress`? `user_progress`? Other?)
- Columns and types — paste the actual `\d table_name` output.
- Foreign keys — is `user_id` indexed? Is there a unique constraint on (user_id, section_id) to prevent duplicates?
- Are sections mapped to phases at the schema level? Is there a `phase_id` on `blitz_sections` or equivalent?

### Findings Report Format
Output to the chat (or a markdown file in the repo `docs/audit-mark-complete.md`) with this structure:

```
## Test Results
1. Single mark — PASS / FAIL — [notes]
2. Progress counter — PASS / FAIL — [notes]
... (all 13)

## Schema State
[current tables, columns, constraints]

## Bugs Found
- [Specific bug with file:line if known]
- [...]

## Proposed Fixes
- [What needs to change]

## Schema Gaps for Upcoming Features
- [What's missing for phase gates, last-viewed, streaks, etc.]
```

### Fix Phase
After the report, fix every FAIL and any P0 bugs surfaced. Do NOT add new features in this task — those come in Tasks 2–7. Just make the existing flow rock solid.

### Acceptance Criteria
- All 13 test cases PASS after fixes.
- Audit report committed to repo for reference.
- No regressions on existing Blitz page functionality.

### Implementation Notes
- If the feature was using only local state / localStorage and never persisted server-side, that IS the bug — wire it up to a real backend persistence layer.
- If a `blitz_section_progress` table doesn't exist, create it with: `id, user_id, section_id, completed_at, created_at, updated_at` + unique constraint on `(user_id, section_id)`.

---

## Task 2: Backend Extension — Last-Viewed + Streaks + Phase Metadata

### What This Does
Extends the progress system with:
- Last-viewed event tracking (where the user was when they left, not just what they completed)
- Daily + weekly streak computation
- Phase metadata so phase gates can be enforced

### Files Created
- `shared/schema/blitz-progress-extended.ts` — new tables for events + streaks
- `server/services/blitz/progress.ts` — event recording + streak computation
- `server/services/blitz/continueResolver.ts` — figures out where user left off
- `server/routes/blitz-progress.ts` — new endpoints

### Files Modified
- `shared/schema.ts` — add exports
- `shared/schema/blitz-sections.ts` (or equivalent — verify naming during audit) — add `phase_id` column if not already present
- `server/index.ts` — register new routes

### Schema Additions
**`blitz_phases`** (only if not already in the schema — verify in audit)
- `id, slug (unique), name, sort_order, color (varchar, default 'gray'), created_at`
- Seed: `introduction`, `phase_1_build`, `phase_2_test`, `phase_3_scale` (agent: confirm against the actual Blitz structure during seeding)

**`blitz_progress_events`** (new — granular event log)
- `id, user_id, section_id, event_type (enum: viewed|completed|uncompleted), occurred_at (default now), video_position_seconds (int nullable), scroll_position_pct (int 0-100 nullable)`
- Index: `(user_id, occurred_at DESC)` for fast "last activity" queries.
- Index: `(user_id, section_id, occurred_at DESC)` for per-section history.

**`user_daily_activity`** (computed/denormalized for fast streak lookups)
- `user_id, activity_date (date), event_count (int)` + composite PK `(user_id, activity_date)`
- Upserted whenever a `blitz_progress_events` row is inserted.

### Endpoints

**`POST /api/blitz/events`** (auth required)
Body: `{ section_id, event_type: 'viewed' | 'completed' | 'uncompleted', video_position_seconds?, scroll_position_pct? }`
- Inserts into `blitz_progress_events`.
- Upserts `user_daily_activity` for today.
- If event_type=`completed`: also upsert `blitz_section_progress` (the table from Task 1).
- If event_type=`uncompleted`: delete from `blitz_section_progress`.
- Returns 204.

**`GET /api/blitz/continue`** (auth required)
Returns: `{ section: { id, name, phase, sort_order }, position: { video_position_seconds?, scroll_position_pct? } | null, status: 'new' | 'in_progress' | 'returning' }`
- `new`: user has no progress events at all → returns Section 1.
- `in_progress`: most recent event is `viewed` (not yet completed) → returns that section with saved position.
- `returning`: most recent event is `completed` → returns the *next* section in order (or "Blitz complete!" if they're done).

**`GET /api/blitz/streak`** (auth required)
Returns: `{ daily_streak: int, longest_daily_streak: int, weeks_active_last_4: int, weeks_active_last_12: int, weekly_heatmap: [{ date, count }, ...] }`
- `daily_streak`: consecutive days back from today (or yesterday if no activity today) where `user_daily_activity` has a row.
- `weeks_active_last_4`: count of distinct weeks (ISO week) in last 4 with at least 1 activity.
- `weekly_heatmap`: array of last 84 days (12 weeks) for rendering a GitHub-style activity grid.

**`GET /api/blitz/phase-status`** (auth required)
Returns: `{ phases: [{ id, slug, name, completion_pct, unlocked: bool, sections_completed, sections_total }, ...] }`
- Phase is `unlocked` if it's the first phase (Introduction always unlocked) OR the previous phase's `completion_pct >= 80`.
- Admins/coaches always see `unlocked: true` on every phase (override).

### Dependencies
- Task 1 complete (existing progress table verified/created).

### Acceptance Criteria
- Posting a `viewed` event with `video_position_seconds: 145` is queryable as the user's last position.
- `/api/blitz/continue` correctly returns Section 1 for a brand-new user, the in-progress section for someone who watched but didn't finish, and the next section after the last completed.
- `/api/blitz/streak` returns `daily_streak: 3` after a user completes a section on 3 consecutive days, drops to 0 if they miss a day.
- `/api/blitz/phase-status` shows Phase 1 locked until Introduction phase hits 80%.

### Implementation Notes
- Streak edge case: if user marks complete at 11:59pm and again at 12:01am, both days count (correct — different `activity_date`).
- Don't compute streaks on the fly from the events table — it's expensive at scale. Use the denormalized `user_daily_activity` table.
- Phase gates: admins and coaches bypass via role check, never see locked UI.

---

## Task 3: Coach Visibility Dashboard — Backend

### What This Does
Aggregated read endpoints for the coach progress dashboard. All coaches see all mentees (no ownership scoping).

### Files Created
- `server/routes/coach-dashboard.ts` — endpoints
- `server/services/coachDashboard.ts` — aggregation logic

### Files Modified
- `server/index.ts` — register `/api/coach/dashboard`

### Endpoints
All require role `coach` or `admin`.

**`GET /api/coach/dashboard/mentees?status=&search=&sort=&cursor=`**
Returns paginated list:
```json
{
  "mentees": [
    {
      "user_id": 42,
      "name": "Jake Rivera",
      "email": "jake@...",
      "tier": "3-Month Mentorship",
      "joined_at": "2026-04-15T...",
      "last_active_at": "2026-05-26T...",
      "current_section": { "id": 7, "name": "Choose Your Affiliate Network", "phase": "Phase 1 — Build" },
      "blitz_completion_pct": 26.1,
      "daily_streak": 3,
      "status": "active"
    }
  ],
  "next_cursor": "..."
}
```

**Status computation:**
- `active`: completed at least 1 section in last 7 days
- `stuck`: logged in within 14 days but no completions in 7+ days
- `dormant`: no login activity in 14+ days
- `new`: joined within last 7 days, hasn't completed anything yet
- `completed`: 100% through the Blitz

Filters: `status` (one of the above), `search` (name or email substring), `sort` (`last_active`, `completion_pct`, `daily_streak`, `joined_at` — desc by default, prefix with `-` for asc).

**`GET /api/coach/dashboard/mentee/:userId`**
Returns full progress detail for one mentee:
- All fields from the list endpoint
- Per-phase breakdown (completion_pct per phase)
- Recent activity timeline (last 20 events from `blitz_progress_events`)
- Section-by-section completion status

**`GET /api/coach/dashboard/summary`**
Returns aggregated counts:
```json
{
  "total_mentees": 247,
  "by_status": { "active": 89, "stuck": 32, "dormant": 78, "new": 18, "completed": 30 },
  "median_completion_pct": 24.5,
  "needs_attention_count": 32  // = stuck count
}
```

### Dependencies
- Task 2 complete (events + streaks data available).

### Acceptance Criteria
- A coach can list all mentees and filter to status=`stuck`.
- The mentee detail page returns a complete activity timeline.
- Summary endpoint returns correct counts that sum to `total_mentees`.

### Implementation Notes
- Heavy reads — cache `/summary` for 60s.
- `current_section` resolved via the same logic as `/api/blitz/continue` (reuse the resolver).

---

## Task 4: Dashboard Widgets — Continue Where You Left Off + Streak

### What This Does
Two new widgets on the member Dashboard page:
1. Hero "Continue" card at the top
2. Streak display in a stat tile

### Files Created
- `client/src/components/dashboard/continue-card.tsx`
- `client/src/components/dashboard/streak-widget.tsx`
- `client/src/hooks/useBlitzContinue.ts`
- `client/src/hooks/useBlitzStreak.ts`

### Files Modified
- `client/src/pages/dashboard.tsx` — wire in the two new components at the top of the page

### Frontend Behavior

**Continue card (full-width hero, top of dashboard):**
- For `status: 'new'`: "Ready to start? Begin with **Section 1 — What Is Affiliate Arbitrage?**" + "Start the Blitz" button.
- For `status: 'in_progress'`: "Pick up where you left off — **Section 5: Select Your Offer**" + "Resume" button (deep-links to that section with `?position={seconds}` if applicable).
- For `status: 'returning'`: "Next up — **Section 6: Set Up Your Affiliate Link**" + "Continue" button.
- For Blitz-complete users: hide the card entirely OR show a "You finished the Blitz! Revisit any section →" link to the Blitz overview.

**Streak widget:**
- Two stat tiles side by side:
  - 🔥 Current Streak — "3 days" (large) — "Longest: 12 days" (small)
  - 📅 Weekly Cadence — "Active 3 of last 4 weeks" (large) — small 12-week heatmap below (GitHub-style green dots)
- If `daily_streak === 0`: friendly nudge — "Complete a section today to start your streak."

### Dependencies
Depends on: Task 2.

### Acceptance Criteria
- Continue card resumes correctly to the in-progress section.
- Clicking "Resume" with `video_position_seconds: 145` opens the video player seeked to that timestamp (or just opens the section if no video — agent uses best judgment).
- Streak widget updates within 5s of a new completion (TanStack Query refetch).
- Heatmap shows the last 12 weeks with intensity scaled to event count per day.

---

## Task 5: Blitz Page — Phase Gates + Last-Viewed Tracking

### What This Does
Adds the locked-state UI to phase pills/sections, and instruments the section pages to send view events.

### Files Modified
- `client/src/pages/blitz.tsx` (or wherever the curriculum overview lives) — render phase headers with locked state
- `client/src/pages/blitz/section.tsx` (the individual section page) — instrument scroll + video position events
- `client/src/components/blitz/section-card.tsx` — add locked overlay for sections in locked phases

### Files Created
- `client/src/hooks/useTrackBlitzView.ts` — debounced event sender
- `client/src/components/blitz/phase-gate-overlay.tsx` — the locked-section UI

### Frontend Behavior

**Phase gates UI:**
- Phase pill at the top of each phase section shows a small lock icon + "Locked — Complete 80% of [Previous Phase Name] to unlock" when locked.
- Section cards within a locked phase render at 40% opacity with a lock icon overlay. "Go to Section" and "Mark as Complete" buttons disabled.
- Hovering a locked section shows a tooltip: "Unlocks when you complete [X] more sections in [Previous Phase]."
- Admins/coaches: always see all sections unlocked, no locked UI.

**Last-viewed tracking on section pages:**
- On mount: POST `/api/blitz/events` with `event_type: 'viewed'`.
- On video playback (if section has a video): debounced POST every 15 seconds with current `video_position_seconds`. Also POST on pause and on unmount.
- On scroll (if no video — text-heavy section): debounced POST every 10 seconds with `scroll_position_pct`. Also POST on unmount.
- Don't send a `viewed` event more than once per minute per section (debounce).

### Dependencies
Depends on: Task 2.

### Acceptance Criteria
- A user with 0% Introduction completion sees Phase 1 sections as locked.
- After they complete enough Introduction sections to hit 80%, Phase 1 unlocks (next page load or via cache invalidation).
- Opening a section page sends a `viewed` event visible in the database.
- Scrolling 50% down a text section sends a `scroll_position_pct: 50` event within 10s.
- Returning to a section the user previously viewed: video starts at the saved timestamp; text section scrolls to saved position.

### Implementation Notes
- Debounce events client-side — don't spam the API. Worst case: 1 event per 15s per section.
- Sending too many events isn't a correctness problem, just a perf concern. The `/api/blitz/events` endpoint should be cheap.
- Locked section "Mark as Complete" button: render as disabled with no click handler — defense in depth (Task 2's phase-status endpoint is the source of truth, but UI shouldn't even try).

---

## Task 6: Coach Dashboard Frontend

### What This Does
New page accessible to coaches + admins showing all mentees' progress with filters and a detail view.

### Files Created
- `client/src/pages/coach/dashboard.tsx` — list page
- `client/src/pages/coach/mentee.tsx` — detail page (`/coach/mentees/:userId`)
- `client/src/components/coach/mentee-row.tsx`
- `client/src/components/coach/status-pill.tsx` — colored pill for active/stuck/dormant/new/completed
- `client/src/components/coach/summary-tiles.tsx`
- `client/src/components/coach/activity-timeline.tsx` (for the detail page)
- `client/src/hooks/useCoachDashboard.ts`

### Files Modified
None (routing in Task 7).

### Frontend Behavior

**List page (`/coach/dashboard`):**
- Top: 4 summary tiles — Total Mentees | Active | Stuck (Needs Attention) | Dormant
- Filter chips below: All / Active / Stuck / Dormant / New / Completed (clicking filters the table)
- Search input — name or email
- Sortable columns: Name, Tier, Joined, Last Active, Current Section, Completion %, Streak, Status
- Default sort: status `stuck` first, then by `last_active_at` desc within each group
- Click row → navigates to mentee detail
- Empty state per filter (e.g., "No stuck mentees right now 🎉")

**Detail page (`/coach/mentees/:userId`):**
- Header: mentee name + email + tier + status pill
- Stats row: completion %, current section, daily streak, days since last active
- Per-phase progress bars (Introduction, Phase 1, Phase 2, Phase 3)
- Section-by-section grid showing complete/in-progress/not-started
- Activity timeline (last 20 events) — "Completed Section 3 • 2 days ago", "Viewed Section 4 • 1 day ago", etc.
- No write actions in v1 (no "Send message" or "Assign deadline" buttons yet — defer)

### Dependencies
Depends on: Task 3.

### Acceptance Criteria
- A coach loading the dashboard sees all mentees regardless of any assignment relationship.
- Filtering to "Stuck" shows only mentees matching that status.
- Detail page activity timeline reflects the last 20 events accurately.

---

## Task 7: Routing + Nav + Seed

### Files Modified
- `client/src/App.tsx` — add routes:
  - `/coach/dashboard`
  - `/coach/mentees/:userId`
- Admin/coach sidebar component — add "Coach" nav group with one item: "Mentee Progress" (visible if `user.role === 'coach' || user.role === 'admin'`).

### Files Created
- `server/seed/blitz-phases.ts` — seeds the four phases (Introduction, Phase 1 — Build, Phase 2 — Test, Phase 3 — Scale).

### Seed Logic
**Replit agent: confirm the actual phase names from the live Blitz curriculum during this task before seeding.** The screenshot suggests "INTRODUCTION" and "PHASE 1 — BUILD" exist; verify Phase 2 and Phase 3 names and section-to-phase mappings against the live content. After seeding `blitz_phases`, run an UPDATE to set `blitz_sections.phase_id` for every existing section based on its position in the curriculum.

### Acceptance Criteria
- Coach routes render for coaches and admins; 404 (or redirect) for members.
- Nav group hidden for members.
- Seed runs idempotently.
- All 23 Blitz sections have a `phase_id` set after seed.

---

## Out of Scope (Future)

- Coach actions (send message, assign deadline, manual phase unlock) — list/read only in v1
- Section notes / personal highlights (skipped intentionally)
- Spaced review nudges / re-watch prompts (skipped intentionally)
- Email/SMS digest summarizing weekly progress
- Cohort comparison ("67% of members who started when you did have reached Phase 2")
- Member-facing badge collection / achievements
- Auto-mark-complete based on watch % threshold
- Multiple Blitz version support (handles only the current Caterpillar Edition v4.0)
