---
name: Member-timezone formatter + booking-confirmation forward-nav
description: How call times are rendered in the member's own timezone across the BTS Member Portal, and why booking-confirmation "Continue" buttons went dead.
---

A single shared formatter (portal `lib/member-timezone.ts`) renders a UTC instant (all `scheduled_at` columns are stored as `timestamptz`) in the member's own timezone with a DST-correct zone abbreviation. The abbreviation is derived per-date via `Intl.DateTimeFormat(..., { timeZoneName: "short" })` — never hardcoded ("CST" vs "CDT" depends on the specific date, not the zone name). Zone source is the member's profile `users.timezone` (set during the onboarding Profile step, exposed on the client auth/user object), falling back to the browser's zone if absent.

**Why:** a fixed "CST"/"CDT" string or a hardcoded UTC-offset badge on call times will silently be wrong across the DST boundary; deriving it live from the actual date is required for correctness.

**How to apply:** any new surface displaying a call/appointment time (dashboard, coaching, partner views, booking confirmations) should import the shared formatter rather than rolling its own `toLocaleTimeString`/offset math. Components that call this formatter typically need `useAuth()` for the member's timezone — tests rendering them need an `@/lib/auth` mock or they crash with "useAuth must be used within AuthProvider".

Separately: a booking-confirmation "Continue" button appeared dead because its click handler only refreshed auth state and never navigated, while the onboarding route guard only redirects forward when a member visits a step ahead of their current one — it does nothing when a member is sitting on a route matching a *past* step (which happens because the booking itself already advanced their step server-side). Fix pattern: after the auth refresh (and also right after a fresh booking succeeds), explicitly navigate to the route for the member's actual current onboarding step whenever it is ahead of the confirmation page's own step — don't rely on the guard to catch this case.
