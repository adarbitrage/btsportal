# Production Secrets & Launch-Readiness Checklist

Completed: 2026-06-11

## Secrets configured

| Secret | Source | Status |
|--------|--------|--------|
| `JWT_SECRET` | Generated (48-byte random, base64url) | ✅ Set |
| `UNSUBSCRIBE_SECRET` | Generated (32-byte random, base64url) | ✅ Set |
| `SESSION_SECRET` | Previously set | ✅ Already present |
| `TURNSTILE_SECRET_KEY` | User-supplied (Cloudflare dashboard) | ✅ Set |
| `VITE_TURNSTILE_SITE_KEY` | User-supplied (Cloudflare dashboard, build-time) | ✅ Set |
| `THRIVECART_WEBHOOK_SECRET` | User-supplied (ThriveCart webhook settings) | ✅ Set |
| `REDIS_URL` | User-supplied (Upstash, `rediss://` TLS scheme) | ✅ Set |
| `SENDGRID_API_KEY` | User-supplied (SendGrid API key, Mail Send permission) | ✅ Set — health reports `sendgrid: configured` |
| `TAPFILIATE_API_KEY` | User-supplied (Tapfiliate Settings → API) | ✅ Set — affiliate link resolution enabled |

## Smoke test results (2026-06-11, dev environment)

### JWT_SECRET — no insecure default
- API server boot log: `[Admin] JWT_SECRET not set` warning **absent**
- Confirms `JWT_SECRET` is a real non-default value

### Captcha enforcement (TURNSTILE_SECRET_KEY)
```
POST /api/auth/register  (no captchaToken in body)
→ 400 {"code":"CAPTCHA_REQUIRED","message":"Captcha challenge is required."}
```
- Backend correctly rejects registration without a Turnstile token

### ThriveCart webhook signature verification
```
POST /api/webhooks/thrivecart  (x-thrivecart-signature: <bad value>)
→ 200 {"received":true}  (ACK sent per ThriveCart requirement)
→ API log: "[Webhook] Invalid signature — rejecting event processing"
```
- Event processing aborted on bad signature; forged events are rejected

### Redis connectivity (Upstash TLS)
```
GET /api/v1/health
→ {"services":{"redis":{"status":"healthy","latencyMs":0,...}}}
```
- Shared Redis is connected; rate limiting and BullMQ queues use it

### Email delivery (SENDGRID_API_KEY)
```
GET /api/v1/health
→ {"services":{"sendgrid":{"status":"configured"}}}
```
- SendGrid key loaded; outbound email (verification, password reset, ops
  alerts, marketing) will now deliver instead of being skipped

### Affiliate links (TAPFILIATE_API_KEY)
- Key set; boot shows no `TAPFILIATE_API_KEY is not configured` error
- Media Mavens products with an assigned Tapfiliate program now resolve
  per-user referral URLs instead of returning a `503`

### API server boot — clean
- No `JWT_SECRET not set` warning
- No `TURNSTILE_SECRET_KEY is not set` warning
- No `UNSUBSCRIBE_SECRET` defaulted log
- No `SendGrid not configured` warning
- Server listening on port 8080

## Out of scope (deferred)

- **On-call alert channel** — no `PAGERDUTY_INTEGRATION_KEY`, `OPS_ALERT_EMAIL`,
  or `OPS_ALERT_SLACK_WEBHOOK_URL` configured yet (user chose "skip for now").
  Follow-up task created to wire this up.

- **Turnstile widget on portal forms** — `VITE_TURNSTILE_SITE_KEY` is set as a
  build-time secret, but the widget component is not yet rendered on Login,
  Register, or ForgotPassword pages. Browser console reports Turnstile error
  code 3589 (widget not initializing). Follow-up task created.

## Confirmed defaults acceptable

| Config | Default value | Confirmed OK |
|--------|---------------|--------------|
| `FROM_EMAIL_TRANSACTIONAL` | `noreply@buildtestscale.com` | ✅ |
| `FROM_EMAIL_MARKETING` | `team@buildtestscale.com` | ✅ |
| `FROM_NAME_DEFAULT` | `Build Test Scale` | ✅ |
| `GHL_OAUTH_REDIRECT_URI` | `https://theinvisibleaffiliate.com` | ✅ |
| `PORTAL_URL` | `https://portal.buildtestscale.com` (production env var) | ✅ |
