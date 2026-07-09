---
name: Email/SMS transport seam
description: lib/email-transport.ts owns every sgMail.send and twilioClient.messages.create call; dev suppression gate; test bypass via allowlist env vars.
---

# Email/SMS transport seam

The single seam for all outbound email and SMS lives in `lib/email-transport.ts`.

**Rule:** no file other than `email-transport.ts` may call `sgMail.send()` or `twilioClient.messages.create()` directly. The regression guard test (`src/__tests__/transport-seam-guard.test.ts`) enforces this on every test run.

**Dev suppression gate:**
- Suppresses ALL sends when `NODE_ENV !== "production"` by default.
- Escape hatches: `DEV_EMAIL_ALLOWLIST` and `DEV_SMS_ALLOWLIST` (comma-separated addresses or `"*"` for wildcard).
- `test-setup.ts` sets both to `"*"` so existing tests that mock `sgMail.send` pass through unchanged.

**Exports:**
- `gatedSendEmail(msg)` → `[ClientResponse, object] | { devSuppressed: true; to: string }`
- `gatedSendSms(client, params)` → `{ sid: string } | { devSuppressed: true; to: string }`
- `isDevEmailSuppressed(to)`, `isDevSmsSuppressed(to)` — helpers for tests
- `isDevSuppressedResult(result)` — type-guard

**Why:** callers that track a `communication_log` row must check for `devSuppressed` and write `status: "dev_suppressed"` (done in `sendEmailDirect` and `sendSmsDirect` in `communication-service.ts`). Alerter callers can ignore the return value — the console log is the only side-effect in dev.

**oncall-dispatcher.ts** keeps its `sgMail` import + `ensureSendGridInitialized()` because blast scripts import that function. Only the dispatcher's own `sgMail.send` call is replaced with `gatedSendEmail`.
