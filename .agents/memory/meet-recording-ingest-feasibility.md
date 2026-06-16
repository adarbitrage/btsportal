---
name: Google Meet recording + Gemini notes ingest feasibility
description: Account/topology + integration realities for linking 1-on-1 call recordings & AI notes into the portal (Task "Meet Recording & AI Summary Ingest")
---

# Meet recording & Gemini-notes ingest — feasibility map

Goal: auto-link each pack 1-on-1 call's Google Meet RECORDING + Gemini "Take
notes for me" summary/transcript into the portal, coach/admin-only. Status as of
2026-06-16: PAUSED by user pending where 1-on-1 recordings actually live.

## Hard platform constraint
- There is **no Google Meet REST API connector** on Replit. Available Google
  connectors: Drive, Calendar, Docs, Gmail, Sheets only. So the Meet REST API
  (conferenceRecords/recordings/transcripts) path is NOT available via the
  integration system.
- Viable path = **Google Drive connector + match by title/date**: Meet saves the
  recording (video) and the Gemini notes/transcript (Google Docs) into the
  meeting **organizer's** Drive. Scan that Drive, match files to a
  `session_pack_bookings` row by meeting title + scheduled time, store
  webViewLinks. Group/internal recordings in the same folder are excluded
  naturally because their titles don't match a booking.

## Confirmed by user
- Recording **and** Gemini "Take notes for me" are BOTH ON for the calls.
- The shared "Meet Recordings" folder the user first checked holds only GROUP
  coaching + internal company calls — **NOT** the 1-on-1s. Do not assume that
  folder is the source.

## The open topology question (decides the whole architecture)
GHL books each 1-on-1 by creating an event on **each coach's own calendar**
(coaches: Sasha, Bruce, Michael, Todd; sub-account JI6HzFwkNIr5VA2QUWUL), so the
Meet organizer is likely each coach individually → recordings probably land in
**each coach's own My Drive > "Meet Recordings"**, within the one @company
Workspace org. To confirm: have a coach open THEIR own Drive "Meet Recordings".

Two architectures follow:
1. **Centralized** (all 1-on-1s in one account's Drive) → single Google Drive
   OAuth connection (Replit connector). Easiest.
2. **Per-coach** (scattered across each coach's Drive, same org) → one personal
   OAuth can't reach all; need a Google **Workspace admin** service account with
   **domain-wide delegation** (Drive readonly) so the backend impersonates each
   coach. Heavier, admin-only setup, but one always-on credential reaches all.

## OAuth persistence (told user)
Replit Drive connection = OAuth refresh token, stored securely; backend mints
short-lived access tokens silently. User does NOT re-enter password at intervals
(unlike the browser Gmail re-prompt). Breaks only on password change, manual
revoke, or strict Workspace re-consent policy.

**Why this matters:** don't rebuild ingestion on the Meet API (no connector);
don't assume the existing shared folder; confirm organizer/Drive topology before
choosing connector vs service-account before writing any code.
