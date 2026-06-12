---
name: Turnstile signup captcha setup
description: How signup bot-protection (Cloudflare Turnstile) is wired for the portal — the two-key requirement, the .replit plaintext trap, and why enforcement is gated to production in code
---

# Turnstile signup captcha (BTS portal)

Captcha enforcement needs **two** values working together, not one:
- `TURNSTILE_SECRET_KEY` (backend) — `verifyCaptcha()` enforces only when this is
  set AND `NODE_ENV === "production"`. `isSignupChallengeEnforced()` reports
  *configuration* (secret present), not runtime enforcement.
- `VITE_TURNSTILE_SITE_KEY` (frontend, build-time) — Register/ForgotPassword
  render the widget only when set. If unset, the frontend sends **no** token.

**Trap (breaks ALL signups):** secret set but frontend has no sitekey → no
widget → no token → backend returns 400 `CAPTCHA_REQUIRED`. Set both in lockstep
or neither.

**`.replit` plaintext trap (security incident — do NOT repeat):** in this repo,
`setEnvVars(environment:"production"|"shared")` writes values into
`.replit` `[userenv.production]` / `[userenv.shared]` **in plaintext, and
`.replit` is git-tracked**. NEVER store a secret with `setEnvVars`. Secrets must
go to the global Secrets pane via `requestEnvVar({requestType:"secret"})` (the
user pastes them — the agent cannot write Secrets). Public values (the Turnstile
**site key**, PORTAL_URL) are fine in `[userenv.production]`.

**Why enforcement is gated to `NODE_ENV === "production"` in code:** Replit
Secrets are global (present in dev/test too). Without a gate, a global
`TURNSTILE_SECRET_KEY` would make the dev/test backend enforce captcha while dev
has no sitekey → dev signup/login/forgot all break, and non-captcha auth tests
(which post to register/login with no token) would 400. The gate (mirroring the
existing alerter pattern, `signup-challenge-alerter.ts` line ~167) keeps the
secret safe everywhere except the deployed app. **How to apply:** the three
captcha test files (`auth-{register,login,forgot-password}-captcha.test.ts`) set
`process.env.NODE_ENV = "production"` in `beforeEach` (restore in `afterEach`)
precisely because of this gate.

**Final state:** `TURNSTILE_SECRET_KEY` = global Secret; `VITE_TURNSTILE_SITE_KEY`
= `[userenv.production]` env var (public). Activation needs a **republish**
(production env vars + new Secret only load on publish); the agent cannot
republish.

**The widget:** No Turnstile widget existed in any Cloudflare account at first —
the task assumed one did. Widget "BTS Member Portal" lives in the **Cherrington
Media** account (id 00c31b5a8866ccae407c5098911662fa), domain
`portal.buildtestscale.com`, managed mode, sitekey `0x4AAAAAADg3k96t3Hwv0N5i`.
The secret is only shown at create-time / via `POST .../rotate_secret` (GET never
returns it); rotate (with `invalidate_immediately`) if a secret ever leaks.

**Cleanup:** the one-time Cloudflare creds (`CLOUDFLARE_GLOBAL_API_KEY`,
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_EMAIL`) are NOT used at runtime — the app only
needs the two Turnstile keys. `CLOUDFLARE_GLOBAL_API_KEY` is high-privilege;
remove it from Secrets once setup/rotation is done.
