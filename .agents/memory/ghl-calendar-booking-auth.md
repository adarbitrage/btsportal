---
name: GHL calendar/booking auth realities
description: How GHL calendar reads vs writes actually authenticate, and why booking into coach calendars is blocked
---

# GHL calendar / booking integration — auth map

Findings from probing the live GHL API for the 1-on-1 coaching "book a real GHL
calendar" feature.

## The raw `GHL_API_KEY` is effectively dead for real work
- v1 (`rest.gohighlevel.com/v1`) → `401 "Api key is invalid."`
- v2 `/calendars/{id}` and `/contacts` → `401 "Invalid JWT"`
- v2 `/calendars/{id}/free-slots` → **200 with real data**.
- **Lesson:** `free-slots` is a public/booking-widget endpoint; it returns
  availability even for a junk token. Do NOT treat a successful free-slots call
  as proof the token is valid. It is not.

## Real GHL writes go through the agency OAuth flow
- `artifacts/api-server/src/lib/ghl-agency-client.ts`: decode
  `GHL_CHERRINGTON_AGENCY_JWT` (base64 JSON `{apiKey, companyId,...}`) →
  POST `services.msgsndr.com/oauth/authorize` (Bearer apiKey, `userType=Location`
  + `location_id`) → exchange code at `services.leadconnectorhq.com/oauth/token`
  with `GHL_CHERRINGTON_CLIENT_ID/SECRET`.
- The client's hardcoded `COMPANY_SCOPE` only covers locations/users. But the
  OAuth app DOES grant broader scopes on request: minting a Location token with
  `contacts.readonly contacts.write calendars.readonly calendars/events.readonly
  calendars/events.write` succeeds (token came back with those scopes).
- Contact create (201) works with such a token. Appointment create needs a
  `contactId` in the same location.

## The blocker: coach calendars live in an unknown location
- `GHL_LOCATION_ID` = `V9lvEVW1AOJzvuEeWsF1` (the portal's CRM location).
- Booking coach calendar `BdBxOw8kL1aF7VfJR5cc` against a token scoped to that
  location → `400 "Calendar does not belong to this location"`.
- The calendar's owning location is NOT `V9lvEVW1AOJzvuEeWsF1`, and is NOT under
  the Flexy/Cherrington agency by the obvious guess (candidate id 404'd on
  authorize).
- **To book into a coach calendar you need a location-scoped OAuth token for the
  location that OWNS that calendar.** Either that location is under the
  Cherrington agency (then the existing OAuth app can mint for it once we know
  its id), or it's a standalone GHL account needing its own credential
  (Private Integration Token with contacts + calendars/events write scopes).

**Why this matters:** the 1-on-1 "book a real GHL calendar" feature can READ
availability today, but cannot WRITE bookings until we know the calendars' home
location and have valid write creds for it.

## RESOLVED: coach calendars location + roster (confirmed by The Master)
- Coach calendars live in GHL sub-account `JI6HzFwkNIr5VA2QUWUL`, which IS under
  the Cherrington/Flexy agency — so the existing agency OAuth mints a
  location-scoped write token for it (no new secret). One location token covers
  ALL coaches. End-to-end book + Google-Meet-link + delete VERIFIED working.
- Booking needs a `contactId` in that same sub-account; GHL auto-attaches the
  coach's Google Meet link to the created appointment.
- **Confirmed 1-on-1 coach roster (FIRST NAMES ONLY — portal never shows
  surnames):**
  - Sasha → `BdBxOw8kL1aF7VfJR5cc`
  - Bruce → `0feHbG6YfH2apzvdmR3U`
  - Michael → `JF7LYxF5KRQImZpvSrHo`
  - Todd → `JiTLouUKzGeYrsPtEmK5`
- Other calendars in the sub-account are NOT 1-on-1 coaches (Robin, Mark Blyn's
  Personal, Mentee Kick-Off Call, TCE Launchpad Onboarding Call, sandy test).
- Still on hold (user's call): credits/packs + payment processor (ThriveCart vs
  WooCommerce) — "save for later".
