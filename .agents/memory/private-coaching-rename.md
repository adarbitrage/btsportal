---
name: Private Coaching rename (deferred, label-only)
description: Planned rename of the member-facing "1-on-1" coaching feature to "Private Coaching"; scoping rules and why it's deferred.
---

The member-facing coaching feature (badge said "1-ON-1") is to be renamed to **"Private Coaching"** to disambiguate it from the BTS Concierge VA, which also offers legitimate "1-on-1 calls".

**Status:** deferred by user decision. Do NOT rename until the in-flight Google-API recording/notes coaching task has merged. The badge itself was already removed (replaced by a larger, prominent session time on the card).

**Why deferred:** the recording/notes task edits the same coaching files (admin `PackSessions.tsx`, member `SessionBooking.tsx`, coach dashboard). A multi-file label rename done while that task is open in its isolated env = merge conflicts. The rename has no dependencies, so it's the ideal last change.

**Scope rules when it happens:**
- **Label-only.** Internal code + DB names stay (`session_pack_*`, `coaching_calls`, `coaching_credit_ledger`, `coaches`, coach flag `oneOnOneEnabled`). No schema/data migration needed — nothing in the data layer is named "1on1".
- **Keep URLs** (`/coaching/...`) unchanged so bookmarks/links don't break; change displayed text only.
- **EXCLUDE `Concierge.tsx`** — its "1-on-1" strings (VA calls, booking slug `1-on-1-call-with-...`) are the concierge's, NOT this feature. Never blind find-replace.
- UI files carrying the old label: Sidebar.tsx, SessionBooking.tsx, BookSessionPack.tsx, Coaching.tsx, CoachingRecruitment.tsx, PackCoachDashboard.tsx, PackCoachingAdminLayout.tsx, admin/PackSessions.tsx, admin/PackCoaches.tsx, lib/upgrade-plans.ts. Tests asserting the label: sidebar-nav.test.ts, Sidebar.coach.test.tsx.
