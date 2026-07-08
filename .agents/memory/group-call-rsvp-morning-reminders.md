---
name: Group-call RSVP morning-of reminders
description: How the RSVP-driven coaching reminder pass works, the coaching email opt-out seam, and the env-flag kill switches for feedback/recording passes.
---

# Rule
Group coaching-call comms are RSVP-driven, not entitlement blasts:
- `processCoachingCallReminders(now?)` sends ONE morning-of email+SMS per RSVP: call within (now, now+24h], call day == today in the MEMBER's timezone, local hour >= 7, and the RSVP (`coaching_call_attendance.registered_at`) landed on a PRIOR local day. Day-of RSVPs get nothing.
- Email is gated on `users.coaching_email_opt_in` (default true) at the send seam; SMS on master `smsOptIn` + `coachingSmsOptIn` + phone. Dedup keys: `coaching_rsvp_reminder_{email|sms}_{callId}_{userId}`.
- One-click coaching-only unsubscribe: `GET /api/email/unsubscribe-coaching?email&token` (same HMAC scheme as marketing unsubscribe, lives in `unsubscribe-token.ts`, re-exported by communication-service). Flips ONLY coachingEmailOptIn, enumeration-safe, in PUBLIC_PATHS. Account page has the matching toggle.
- `processSessionFeedbackPrompts` and `processRecordingReadyNotifications` (group) are OFF unless `SESSION_FEEDBACK_PROMPTS_ENABLED` / `GROUP_RECORDING_READY_ENABLED` === "true".

**Why:** Blanket 24h/1h blasts to every entitled member caused reminder fatigue; the user wanted comms only for members who actually RSVP'd, early on the call day.

**How to apply:**
- Any test exercising these passes must pass a FIXED `now` and seed attendance rows with prior-day `registeredAt`; suites for the flagged passes must set the env flags true (and restore them).
- Don't resurrect the entitlement blast; if a new coaching comm is added, gate its email on coachingEmailOptIn at the send seam and include `coaching_unsubscribe_url`.
