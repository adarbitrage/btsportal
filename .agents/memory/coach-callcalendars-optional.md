---
name: Coach callCalendars defensive read
description: AdminCoach.callCalendars may be absent on older/mock payloads; reads must tolerate undefined
---
The admin coach editor derives per-callType calendar pairs from `coach.callCalendars`.
Always read it as `(coach.callCalendars ?? []).find(...)`, never `coach.callCalendars.find(...)`.

**Why:** the server now always returns the array, but pre-existing test mocks (e.g. CoachProfiles.crud.test.tsx) and any legacy payload omit it; an unguarded `.find` throws "Cannot read properties of undefined (reading 'find')" and crashes openEdit / the connections panel during render.

**How to apply:** any new code in CoachProfiles.tsx (or anything consuming AdminCoach) that reads callCalendars must coalesce to `[]` first. The two existing reads are calendarPair() and the connections panel.
