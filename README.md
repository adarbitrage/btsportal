# Build Test Scale (BTS) Member Platform

A pnpm monorepo containing the BTS member portal (`artifacts/portal`), the API
server (`artifacts/api-server`), and a component preview sandbox
(`artifacts/mockup-sandbox`). For an architectural overview, see
[`replit.md`](./replit.md).

This README covers operator-facing configuration that is easy to miss in
production. Add new entries here whenever a feature ships with a "silently
disabled when env var is missing" fallback.

## Environment variables

### Signup bot challenge (Cloudflare Turnstile)

The signup form uses [Cloudflare Turnstile](https://www.cloudflare.com/application-services/products/turnstile/)
to block automated account creation. It is wired up in two places:

- `artifacts/api-server/src/middleware/captcha.ts` — verifies the token
  server-side against `https://challenges.cloudflare.com/turnstile/v0/siteverify`.
- `artifacts/portal/src/pages/Register.tsx` — renders the widget on the
  Register page when a site key is configured.

| Variable | Where it is read | Required in production |
| --- | --- | --- |
| `TURNSTILE_SECRET_KEY` | `artifacts/api-server` (server-side verification) | **Yes** |
| `VITE_TURNSTILE_SITE_KEY` | `artifacts/portal` (widget rendering) | **Yes** |

Both must be set together. They come as a pair from the Turnstile dashboard:

1. Sign in to the Cloudflare dashboard and open **Turnstile**.
2. Click **Add site**, enter a friendly name, and add the production hostname(s)
   that will serve the portal (you can list multiple, including any preview
   domains).
3. Choose a widget mode — **Managed** is the recommended default.
4. Cloudflare will generate a **Site Key** (public, used by the browser) and a
   **Secret Key** (private, used by the API server). Copy both.
5. Set them as environment variables / secrets in the production deployment:
   - `VITE_TURNSTILE_SITE_KEY` → the Site Key (this gets baked into the portal
     bundle at build time, so the portal must be **rebuilt** after changing it).
   - `TURNSTILE_SECRET_KEY` → the Secret Key (read at runtime by the API
     server, so a restart is enough).

#### ⚠️ Dev-only bypass

If `TURNSTILE_SECRET_KEY` is **not** set, the captcha middleware logs a
one-time warning and lets every signup request through without verification.
This is intentional so that local development, automated tests, and ephemeral
preview environments do not require a real Turnstile key pair — but it means a
production deployment that forgets to set the secret will silently ship with
**no bot protection on the signup form**.

Likewise, if `VITE_TURNSTILE_SITE_KEY` is unset in the portal build, the
Register page will not render the widget at all, so users will see no challenge.

**Always set both variables in production.** A quick way to confirm the server
is enforcing the challenge: hit `POST /auth/register` without a `captchaToken`
and verify the response is `400 CAPTCHA_REQUIRED`. If you instead get a normal
signup response (or the generic enumeration-resistant confirmation), the
secret is missing.
