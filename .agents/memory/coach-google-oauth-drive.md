---
name: Per-coach Google Drive OAuth connection
description: How coaches connect their own Google Drive (per-coach OAuth, no Workspace admin) to feed the coaching-recording ingest.
---

# Per-coach Google Drive OAuth

Coaching-recording ingest can pull recordings/notes from EITHER a service account
(central or domain-wide-delegation) OR per-coach OAuth connections. The per-coach
path exists because the customer cannot use a Workspace super-admin (domain-wide
delegation needs one). Each coach logs into the portal and connects their OWN
Google account; the ingest searches every connected account's Drive and the
title+time matcher does the rest — there is intentionally NO booking→coach→drive
mapping (session_pack_coaches has no email/user link anyway).

**Why keyed by portal user, not coach row:** session_pack_coaches has no email or
user FK, and the coach dashboard has no per-coach ownership filtering. So
connections are stored per logged-in user (`coach_google_connections.user_id`,
unique) and the ingest just unions all active accounts' Drives.

**How to apply / gotchas:**
- The OAuth callback MUST be a PUBLIC route. The auth cookie is `sameSite:"strict"`,
  so the cross-site redirect back from accounts.google.com carries NO cookie. The
  callback identifies the user solely via an HMAC-signed (JWT_SECRET) expiring
  `state` issued at connect time. Never trust the callback without a valid sig.
- `/connect` is a same-origin top-level navigation, so the Strict cookie IS sent —
  it stays auth-gated and mints the signed state.
- Refresh tokens are encrypted at rest with app-secrets-crypto (encryptSecret).
  Always request `access_type=offline` + `prompt=consent` so Google re-issues a
  refresh token; if Google omits it on re-consent, keep the existing stored token.
- Needs secrets GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET. Redirect URI
  is `<base>/api/coach/google/callback` (base = OAUTH_PUBLIC_BASE_URL ||
  PORTAL_URL || https://REPLIT_DEV_DOMAIN). Register it EXACTLY in the Google
  client. The OAuth client should be "Internal" user type to avoid restricted-
  scope (drive.readonly) verification.
- A new table reaches prod via the gated post-merge push-force (drift test fails →
  push creates it); a plain new table needs no companion .sql.

## Member-facing recording plan (decided, not yet built)

Chosen approach for showing recordings to members: **folder-share**, NOT in-app
streaming.
- The coach manually sets their "Meet Recordings" Drive folder to
  "anyone with the link can view" ONCE. Drive permission inheritance means every
  future recording/transcript/Gemini-notes file dropped in inherits link-sharing.
- So our app stays on **drive.readonly** — it never calls a sharing API. Ingest
  just reads each file's viewable link; the member page links straight to Google's
  player. No streaming infra, no scope upgrade.
- Member surface (when built): expose recordingUrl + transcriptUrl + summaryUrl
  (Gemini notes) on the member's own past sessions (SessionBooking.tsx) by adding
  them to MEMBER_BOOKING_COLUMNS. Still EXCLUDE coachNotes. **No action items**
  member-facing (dropped from scope).
- Only ever surface per-FILE links to members, never the folder link (folder link
  would expose every client's recordings).
- **B (token-based in-app streaming, files stay private) is the reserved future
  upgrade** if they want real access control instead of anyone-with-link.
- Action items remain coach-entered only (Gemini does NOT generate our structured
  actionItems; its summary doc may contain prose next-steps but we don't parse it).

**Why:** customer wants the lightest path to launch; accepts anyone-with-link
(public-if-forwarded) tradeoff for now. Don't auto-build B or member action items
without an explicit ask.

## Session completion: recording = proof-of-happened (decided, not yet built)

Today a booking only becomes status="completed" (or "no_show") via a MANUAL
coach/admin action (admin-coaching-sessions.ts "mark completed"/"mark no-show"
routes set status + outcomeAt). Nothing auto-completes by date, and Google sends
NO attendance/join signal.

Decided behavior (option 3) — minimize manual coach marking:
- When the ingest links a **recording** to a booking, AUTO-mark that booking
  `completed` (the recording is proof the call happened). Set outcomeAt too.
- If a booking is **past** and NO recording ever appears, surface it to the coach
  as a **likely no-show to confirm** (don't auto-no_show — leave the refund/no_show
  decision to a human, since no-show triggers a session-credit refund).
- Keep the manual "mark completed/no-show" controls as the override/fallback.
- **Why this path:** rides entirely on the read-only Drive access already in scope;
  needs NO Meet/Admin Reports API and NO Workspace-admin (the thing the customer
  is avoiding). True join-level attendance (who/duration) was explicitly ruled out.
- Watch: only flip booked→completed (mirror the existing status guards); don't
  clobber cancelled/no_show; auto-complete must be idempotent on repeat ingest runs.
