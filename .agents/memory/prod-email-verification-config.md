---
name: Production email/verification config model
description: Why prod verification/reset emails silently skip, and the deploy-config model behind it
---

# Production transactional email config (BTS portal)

Replit **secrets are global** (shared dev+prod) but a published autoscale
deployment only picks up secret/env changes on a **republish**. So a secret
that "exists" in the workspace is NOT necessarily live in production until the
next Publish.

Two independent gates make verification/reset emails silently `skipped` (status
`skipped` in `communication_log`, never `sent`):
- `SENDGRID_API_KEY` missing → `error_message = "SendGrid not configured"`.
- `PORTAL_URL` missing in production → hard skip `portal_url_unconfigured`
  (only in NODE_ENV=production; dev uses the localhost default). Templates that
  reference `{{portal_url}}` refuse to ship a broken link.

**Fix order:** ensure `SENDGRID_API_KEY` secret exists → set `PORTAL_URL`
(production env var = the live portal origin, e.g. https://portal.buildtestscale.com)
→ **republish** so the deployment picks both up. `TURNSTILE_SECRET_KEY` (secret)
gates signup captcha the same way (unset = captcha disabled, fails open).

**Agent limits:** cannot set secrets (use requestEnvVar), cannot republish
(user clicks Publish), and prod DB is read-only (cannot force-verify stuck
members directly — must be done via admin force-verify endpoint or
`/api/auth/resend-verification` after republish).

**Why:** confirmed against the live comm log — 17 "SendGrid not configured"
skips, then 4 `portal_url_unconfigured` skips once SendGrid was added but
PORTAL_URL still absent. Zero verification emails ever sent in prod.
