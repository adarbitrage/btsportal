---
name: Production SMS / Twilio config model
description: Why prod SMS silently disables, the AC-SID gate, and the secret-propagation/verification limits
---

# Production SMS (Twilio) config (BTS portal)

The comms service builds the Twilio client at module import. It only
initializes when `TWILIO_ACCOUNT_SID` **starts with "AC"** (the real Account
SID) AND `TWILIO_AUTH_TOKEN` is set. A common misconfig is putting an API Key
SID ("SK...") or the auth token into the `TWILIO_ACCOUNT_SID` slot — the client
stays `null`, all SMS are skipped, and you get the log warning
`TWILIO_ACCOUNT_SID does not start with "AC"`.

`twilio(SID, token)` only validates the SID **format** at construction; it does
NOT authenticate against Twilio servers. So "no AC warning + client built" only
proves the format is right, not that SID+token are a matching, active pair —
that surfaces as an auth error at first real send.

**Fix order:** set `TWILIO_ACCOUNT_SID` (starts with AC) + matching
`TWILIO_AUTH_TOKEN` + `TWILIO_PHONE_NUMBER` (E.164) as secrets → **republish**
so the deployment picks them up → send a test SMS and confirm a `sent` row in
`communication_log` (channel = sms).

**Agent limits / gotchas:**
- Secrets are global (shared dev+prod) but a published deployment only picks up
  changes on a **republish** (same model as the email/portal-url config).
- Cannot set secrets (use requestEnvVar) and cannot republish (user clicks
  Publish), so the prod test-SMS verification is necessarily user-side.
- The `bash` shell tool and the JS code-execution sandbox do **NOT** receive
  Replit secrets — only spawned **workflow** processes do. So you can't read or
  validate secret values from bash/sandbox; verify via the running workflow's
  logs (e.g. absence of the AC warning after a restart) instead.

**Why:** confirmed against the live deployment log (the AC warning was present
in prod) while restoring SMS after the email-verification fix.
