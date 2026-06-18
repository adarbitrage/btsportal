---
name: Coach↔user link + Group Coaching soft-cancel
description: How coaches map to portal users, and the admin-scoping + reversible soft-cancel model for the coach Group Coaching surface.
---

# Coach ↔ user identity

- Coaches map to portal users via `coaches.userId` (nullable, unique FK → users).
  This column did NOT exist originally; older task plans claiming coaches already
  carry a userId are WRONG — verify the column before relying on it.
- The link is resolved on the idempotent boot seed: `RosterCoach.userEmail` →
  looked up → written to `coaches.userId`. The seed NEVER clobbers an existing
  link with null (only overwrites when a userId resolves).
- `resolveCoachIdForUser(userId)` is the lookup used by coach endpoints.

**Why:** coaches historically had email=null/userId=null; the only coach-role
user is the seeded SashaCoach. A coach surface needs a way to know "which coach
am I", so the link had to be added.

# Group Coaching admin-scoping pitfall

- On `GET /api/coach/group-calls`: an admin (`req.adminRole` / coaching:view)
  must NEVER be scoped to a resolved coachId — even if a coach row happens to be
  linked to the admin's user. Admins manage the WHOLE schedule and always get
  the all-coaches view with `coachId: null`. Only a plain coach is scoped.

**Why:** resolving coachId for every caller silently restricted an admin who
also had a linked coach row to just their own calls. Caught in code review.
**How to apply:** gate the coachId resolution behind `!isAdmin`; keep a test for
"admin WITH a linked coach row still sees all".

# Calendar coach-picker: key off `isAdmin`, not coachId

- `GET /api/coach/group-calls` returns `{ coachId, isAdmin, calls }`. The
  frontend MUST decide whether to show the admin coach-picker off `isAdmin`,
  NOT off `coachId === null` — because an UNLINKED plain coach also reports
  `coachId: null` (would 403 hitting `/admin/coaching/coaches`).
- Admins may scope to one coach via optional `?coachId=` (drives the picker);
  a plain coach is pinned server-side and the param is IGNORED for them — keep
  the "plain coach passing ?coachId stays on own calendar" anti-bypass test.
- Picker roster comes from `/admin/coaching/coaches` (sources `coachesTable`
  directly, so it includes coaches with no login).

**Why:** coachId-null is ambiguous between admin and unlinked-coach; an explicit
`isAdmin` flag disambiguates and prevents a non-admin from calling the admin
roster endpoint.

# Reversible soft-cancel for weekly group calls

- `coaching_calls.cancelledAt` + `cancelledBy` (both nullable). Cancel sets them,
  restore nulls them — fully reversible, no row deletion.
- Member-facing: list keeps cancelled occurrences (flagged `cancelled:true`),
  scrubs `meetLink`, attendance POST 409s on a cancelled call; dashboard preview
  filters cancelled out.
- Regen-safe: the weekly_qa seed skips existing upcoming `(coachId, scheduledAt)`
  slots regardless of cancelled status, so a cancelled occurrence is never
  recreated/un-cancelled by the seeder.
