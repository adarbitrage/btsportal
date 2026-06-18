---
name: Prod schema changes go through Replit Publish, never agent DDL
description: How production schema is applied for this project and why agent-written prod migrations/boot-DDL are the wrong fix for a failing publish diff.
---

# Production schema = Replit Publish flow only

This project uses Replit-managed Postgres. Production schema is applied in exactly
ONE place: the **Publish flow**, which introspects dev + prod, computes a SQL diff,
surfaces renames/destructive alters for confirmation, and applies it to prod.
`scripts/post-merge.sh` and the api-server boot hooks only ever touch the **dev**
DATABASE_URL — they do NOT migrate prod.

**Rule (authoritative — `.local/skills/database/.../database-migrations-on-publish.md`):**
When a publish-time migration statement fails, do NOT "fix" prod with a custom
migration script, a deploy-build hook, or startup-time idempotent DDL in
`bootstrap-critical-prerequisites.ts`. The skill names the startup-time-DDL
"safer alternative" as explicitly wrong. The fix is: make dev correct → re-publish.

**Why:** the dev schema is the source of truth; prod is the platform's
responsibility. Parallel migration systems drift and are unsafe on every deploy.

**How to apply:** ensure the dev schema + dev DB are correct (they usually already
are), verify the feature in dev, then tell the user to re-publish and confirm any
destructive change in the Publish UI.

## The unify-coaches destructive transition (recurring incident)
The publish diff for the coaches unification fails on:
`ALTER TABLE "session_pack_bookings" DROP CONSTRAINT "session_pack_bookings_coach_id_session_pack_coaches_id_fk"`
→ "constraint does not exist". Cause: the diff drops `session_pack_coaches`
(cascading away the FK) AND explicitly drops the same FK; the table-drop runs
first, so the explicit drop then fails. Prod is full-old (session_pack_coaches +
old FK present; coach_away_periods missing; new FK absent) because this change has
never successfully published.

**Data-safety (verified read-only on prod):** `session_pack_bookings` has 0 rows,
so repointing/dropping the FK loses nothing; the 4 legacy `session_pack_coaches`
rows are superseded by the boot-seeded unified `coaches` roster
(coaching-roster.ts).

**Re-publish does NOT self-heal this one** — the generated diff is deterministic,
so it fails identically every time. The Publish UI offers two buttons:
- "Copy your development database schema & data to production" → DANGER: wipes ALL
  prod data (prod has real members — ~26 users, ~425 sessions, tickets, community
  posts). NEVER recommend this for this live portal.
- "Cancel deployment and retry once your schema conflicts are resolved" → safe.

**Can't dodge it dev-side:** `sessionPackCoachesTable` is just an alias
(`= coachesTable`) used across dozens of call sites, so re-declaring a real
`session_pack_coaches` table to stop the drop is not viable.

**The clean unblock (user runs it once on THEIR prod DB; agent can't — executeSql
prod is read-only):** drop the stale FK first, then republish —
`ALTER TABLE "session_pack_bookings" DROP CONSTRAINT IF EXISTS "session_pack_bookings_coach_id_session_pack_coaches_id_fk";`
After that, the publish diff no longer emits the colliding explicit drop (the
table drop's CASCADE handles it) and applies cleanly. Otherwise: Replit support.
Either way, the agent does NOT hand-migrate prod from app code.
