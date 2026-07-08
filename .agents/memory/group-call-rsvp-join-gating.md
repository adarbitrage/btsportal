---
name: Group-call RSVP/join gating
description: Where the RSVP cutoff, meet-link withholding, and joined_at stamping live and their invariants.
---

Group coaching calls are RSVP-gated:

- **Rule:** RSVPs close 1h before start (server 409 "RSVPs are closed"); the meet link is withheld by the API unless the member RSVP'd AND the join window (5 min before start) is open; POST /coaching-calls/:id/join stamps `joined_at` (COALESCE keeps the FIRST click) and returns the link.
- **Why:** Attendance tracking needs a deliberate RSVP + Join signal; leaking the meet link in the listing would let non-RSVP'd members join untracked.
- **How to apply:**
  - The meet-link withholding lives in TWO places that must stay in lockstep: the /coaching-calls list route AND dashboard `upcomingCalls` (shared CoachingCall zod schema — see coachingcall-shared-schema.md). Constants RSVP_CUTOFF_MS / JOIN_OPENS_BEFORE_MS exported from routes/coaching.ts; portal duplicates them for display only (server is the real gate).
  - Attendance rows have three independent stamps: registered_at (RSVP), joined_at (Join click), recording_viewed_at. Roster + admin member-detail Group Coaching card must exclude recording-only rows (both RSVP stamps null).
  - `joined` implies keeping the first timestamp — join is a conditional UPDATE gated on registered_at NOT NULL, never an upsert (a join must not create an RSVP).
