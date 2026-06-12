---
name: Turnstile captcha fail-closed trap
description: Why a non-empty TURNSTILE_SECRET_KEY can still block all prod logins, and how to verify the key is actually valid.
---

# Turnstile captcha fail-closed trap

The api-server `verifyCaptcha` middleware enforces Turnstile ONLY when
`NODE_ENV==="production"` AND `TURNSTILE_SECRET_KEY` is non-empty (otherwise it
fails OPEN). Consequence: a *present but invalid* secret (e.g. a 1-char
placeholder) makes the server fail CLOSED — every login is rejected with
`CAPTCHA_INVALID` even though the browser widget shows "Success!".

**Why:** Both Turnstile keys have historically been set to junk 1-char
placeholders (first the site key, later the secret key). A non-empty secret is
NOT proof of a valid secret. The keys are a pair: the site key (build-time
`VITE_TURNSTILE_SITE_KEY`, inlined into the portal) and the secret key (runtime
`TURNSTILE_SECRET_KEY`, read by api-server) must come from the SAME Cloudflare
widget ("BTS Member Portal").

**How to apply:**
- Symptom "widget says Success! but app shows the red 'complete the challenge'
  message" = server-side secret problem, not client code. Client maps
  `CAPTCHA_INVALID`/`CAPTCHA_REQUIRED` → that red message.
- Verify the secret WITHOUT printing it: POST the secret + a dummy token to
  `https://challenges.cloudflare.com/turnstile/v0/siteverify`, write the result
  to a file and read it (the shell aliases words like "turnstile"/"siteverify",
  so don't trust raw stdout). HTTP 400 + `invalid-input-secret` = bad secret;
  HTTP 200 + `invalid-input-response` = secret is VALID (dummy token is expected
  to fail). Also log `secret.length` — a real Cloudflare secret is ~35 chars.
- Secret changes don't reach prod until a republish (prod captures env at deploy
  time).
