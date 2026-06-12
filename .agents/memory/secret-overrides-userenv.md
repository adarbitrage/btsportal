---
name: Secret overrides userenv (Turnstile sitekey)
description: A global Replit Secret silently overrides a same-named .replit [userenv.*] value; how a stray VITE_TURNSTILE_SITE_KEY broke login.
---

A global encrypted Replit **Secret** takes precedence over a same-named key in
`.replit [userenv.*]` (the plaintext, git-tracked env). If both define the same
variable, the Secret value wins everywhere (dev AND prod).

**Incident:** Login showed "Please complete the challenge" with no widget and
Sign In stayed disabled. Root cause was a stray global Secret
`VITE_TURNSTILE_SITE_KEY = "H"` overriding the correct public sitekey
(`0x4AAAAAADg3k96t3Hwv0N5i`) that lives in `.replit [userenv.production]`. The
Turnstile widget rendered with sitekey "H", failed to load
(`TurnstileError 3589 "Invalid input for parameter sitekey, got H"`), so the
submit button never enabled.

**Why it's a trap:** the sitekey is *public* and correctly lives in userenv, so
nothing in code or `.replit` looks wrong. The override is invisible unless you
list Secrets (`viewEnvVars` with secrets:true).

**How to apply:**
- If a value defined in `[userenv.*]` behaves wrong at runtime, check for a
  same-named **Secret** shadowing it before touching code.
- The agent **cannot delete Secrets** — the user must remove the bad Secret via
  the Secrets tab. Deleting via `deleteEnvVars` only removes a shared env var,
  not the Secret (silent no-op).
- Public values (like a Turnstile *site* key) belong in userenv; never also put
  them in Secrets. Secret *secret* keys (TURNSTILE_SECRET_KEY) belong only in
  Secrets, never in `.replit` (plaintext, git-tracked).
- Frontend renders the Turnstile widget only when `VITE_TURNSTILE_SITE_KEY` is
  present; since it's intended to live only in `[userenv.production]`, dev should
  render no widget. A widget appearing in dev means a stray global override.
