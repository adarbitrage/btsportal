---
name: Private Coaching rename (DONE) + coaches roster pitfalls
description: The member-facing "1-on-1" coaching feature was fully renamed to "Private Coaching"; scope boundaries, the /coaches null-bio trap, and the unused generated private-coaching client.
---

The member-facing private-coaching feature (badge once said "1-ON-1") is now renamed to **"Private Coaching"** to disambiguate it from the BTS Concierge VA (which legitimately offers "1-on-1 with a VA"). This was done as a FULL rename, not label-only.

**Status:** DONE. User-facing strings, openapi paths (`/coaching/one-on-one|sessions` → `/coaching/private/*` with Private operationIds/schema names), regenerated api-zod + api-client-react, and code comments all renamed.

**Scope boundaries — LEAVE UNTOUCHED (intentional):**
- `Concierge.tsx` — its "1-on-1 with a VA" strings + booking slug are the concierge's, not this feature. Never blind find-replace.
- KB `.txt` content; the `coaching:1on1:*` entitlement KEYS; demo content in `seed.ts`; knowledgebase-pipeline strings.
- Coaching.tsx header "1-on-1 sessions with the BTS Concierge team" (Concierge wording stays).

**The /coaches null-bio 500 trap (regression-prone):**
- Unified `coachesTable` made `bio`/`specialties` NULLABLE (private-only + not-yet-filled group coaches have none). The boot seed (`coaching-roster.ts seedCoachRoster`) inserts coaches WITHOUT bio/specialties → they are null in DB.
- But `ListCoachesResponseItem` (api-zod) types `bio`/`specialties` as non-null `zod.string()`. So `GET /coaches` doing `ListCoachesResponse.parse(rawRows)` THROWS → 500 → empty coach grid.
- **Fix in place:** the `/coaches` route coalesces `bio`/`specialties` to `""` before parse. **How to apply:** if you re-add fields to the coach contract or change the seed, keep nullable DB columns coalesced in the route OR make the zod contract `.nullish()` and regenerate. The frontend grid already guards with `coach.bio && (...)`.

**Unused generated private-coaching client (don't be fooled by spec drift):**
- The session-pack / private-coaching frontend pages do NOT use `@workspace/api-client-react`. They use custom hooks (`@/lib/session-packs-api`, `@/lib/coach-pack-api`, `@/lib/session-coaching-admin-api`) that fetch literal `/api/coaching/sessions/*` paths matching the express routes in `coaching-sessions.ts`.
- The regenerated client's `/api/coaching/private/*` hooks are effectively DEAD code. **Why this matters:** openapi now says `/coaching/private/*` while the server serves `/coaching/sessions/*` — this drift is HARMLESS at runtime (nobody calls the generated private hooks). Do NOT "fix" it by renaming the server routes unless you also rewrite the working custom hooks (regression risk for no benefit).
