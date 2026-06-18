---
name: Coach calendar-scope reconnect prompt
description: How the portal detects + prompts a Drive-only (pre-calendar-scope) coach Google connection to reconnect.
---
The `calendar.freebusy` scope was added additively to per-coach Google OAuth.
Connections made before that lack it, so group-call conflict detection silently
returns nothing (calendar-busy route catches CalendarScopeError → `{connected:false, needsReconnect:true}`).

Detection (independent of the live free/busy probe): `scopeHasCalendarAccess(scope)`
in `google-oauth.ts` does a whitespace-split EXACT match on the stored
`coach_google_connections.scope` (no substring matching). `getConnectionStatus`
returns `needsCalendarReconnect = connected && !scopeHasCalendarAccess(scope)`,
exposed on `GET /coach/google/status`.

UI: `GoogleDriveCard` in `PackCoachDashboard.tsx` (the /coach/sessions page) shows
an amber "Reconnect to enable calendar conflicts" callout + button when
needsCalendarReconnect. The reconnect button reuses `startGoogleConnect` — its
consent URL already sets `prompt=consent` + `include_granted_scopes:true`, so
reconnecting upgrades the grant and clears the flag.

**Why:** the only prior nudge was a small note in the Group Coaching day panel;
coaches never saw it where they manage the connection.
