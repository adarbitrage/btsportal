# Machine → Portal Purchase Receiver Contract

**Version:** 1.0
**Last updated:** 2026-05-22
**Scope:** Portal-side receiver for The Machine's YSE front-end purchases ($27–$297). Sender code lives in The Machine's repo (`getthemachine.com`).

---

## Overview

When a customer completes a YSE front-end purchase on The Machine's funnels (workshop / ebook / Your Second Engine), The Machine POSTs the order to this Portal endpoint. Portal then:

1. Creates the Portal user account (if new), with a temporary password sent by welcome email.
2. Grants the `yse_front_end` product as an active entitlement.
3. Syncs the contact to GHL and attributes affiliate commission (if `tap_ref` was passed).

The endpoint is **idempotent**: a retry of the same `order_number` returns a `deduped: true` response with no side effects.

This receiver is a thin alias over the existing `handleExternalGrantProduct` flow that already powers the YSE/GHL integration. It reuses the same webhook-logs idempotency, never-downgrade behavior, email-keyed merge, and one-shot welcome email.

---

## The Five Things to Configure on the Sender

1. **URL:** `POST https://portal.buildtestscale.com/api/integrations/machine-purchase`
2. **Auth header:** `X-Machine-Webhook-Secret: <secret>` — value comes from `MACHINE_PORTAL_SHARED_SECRET`
3. **Request body:** see "Request" below
4. **Entitlement granted (hard-coded):** product slug `yse_front_end` (grants `content:frontend`, `support:basic`, `chat:basic`). The Machine does **not** pick the product — every successful purchase grants `yse_front_end`.
5. **Secret env var name:** `MACHINE_PORTAL_SHARED_SECRET` (must be identical on both Replits; do **not** reuse `PORTAL_WEBHOOK_SECRET` or `BTS_API_KEY`).

---

## Endpoint

```
POST https://portal.buildtestscale.com/api/integrations/machine-purchase
```

---

## Authentication

```
X-Machine-Webhook-Secret: <plaintext shared secret>
```

The header value is compared timing-safe against `process.env.MACHINE_PORTAL_SHARED_SECRET` on Portal. Length-equalized buffers are used so `crypto.timingSafeEqual` never throws and the comparison does not leak secret length.

- Missing or wrong header → **401** with `{ "error": { "code": "INVALID_SECRET" } }` and no row written.
- `MACHINE_PORTAL_SHARED_SECRET` not configured on Portal → **503** on every request and a loud startup log line. The endpoint never silently accepts.

The secret is plaintext on both sides; rotate by setting a new value in Portal's secrets, deploying the sender with the same new value, and removing the old.

---

## Request

### Headers

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-Machine-Webhook-Secret` | `<plaintext shared secret>` |

### Body (JSON)

```jsonc
{
  "order_number": "tm_ord_abc123",        // string, required, idempotency key
  "email": "jane@example.com",            // string, required
  "first_name": "Jane",                   // string, optional
  "last_name": "Doe",                     // string, optional
  "phone": "+15551234567",                // string E.164, optional
  "funnel_slug": "yse-workshop",          // "yse-workshop" | "yse-ebook" | "your-second-engine"
  "product_ids": ["wsh_001"],             // string[], Machine-side ids, stored in metadata only
  "total_cents": 2700,                    // integer, optional, stored in metadata
  "occurred_at": "2026-05-18T12:00:00Z",  // ISO 8601, required — original order timestamp
  "tm_click_id": "tmc_xyz",               // optional, stored in metadata
  "tap_ref": "affiliatecode123"           // optional, forwarded as metadata.bts_ref for commission attribution
}
```

### Field rules

| Field | Type | Required | Notes |
|---|---|---|---|
| `order_number` | string | ✓ | Idempotency key. Stored as `webhook_logs.external_id = "machine_<order_number>"`. |
| `email` | string (email) | ✓ | Normalized to lowercase. Drives merge-by-email. |
| `first_name` | string | ✗ | |
| `last_name` | string | ✗ | |
| `phone` | string | ✗ | E.164 format recommended. |
| `funnel_slug` | enum | ✓ | One of `yse-workshop`, `yse-ebook`, `your-second-engine`. |
| `product_ids` | string[] | ✗ | Machine-side product ids; stored as metadata only. Does NOT affect what gets granted. |
| `total_cents` | integer | ✗ | Stored as metadata. |
| `occurred_at` | string (ISO 8601) | ✓ | Original order timestamp. |
| `tm_click_id` | string | ✗ | Stored as metadata. |
| `tap_ref` | string | ✗ | Forwarded as `metadata.bts_ref` for affiliate commission attribution. |

---

## Responses

### 201 Created — First-time buyer

```json
{
  "received": true,
  "userId": 1042,
  "userCreated": true,
  "welcomeEmailQueued": true
}
```

Portal created a new member account, granted `yse_front_end`, queued exactly one welcome email containing a temp password, and queued a GHL `create_contact` sync.

### 200 OK — Existing-member merge

```json
{
  "received": true,
  "merged": true,
  "userId": 1042,
  "userCreated": false,
  "welcomeEmailQueued": false
}
```

The email already maps to an existing Portal user (paying or otherwise). Portal attached the `yse_front_end` grant to that account and **kept every other entitlement the user already held** (never-downgrade). **No welcome email and no password reset is sent on this path** — the existing member's login continues to work unchanged.

### 200 OK — Deduped retry

```json
{
  "received": true,
  "deduped": true,
  "userId": 1042
}
```

A prior delivery of the same `order_number` was already processed. No new rows, no new email, no new GHL sync. Safe to receive any number of times.

### 401 Unauthorized — Bad secret

```json
{ "error": { "code": "INVALID_SECRET" } }
```

No further detail returned, no `webhook_logs` row written.

### 400 Bad Request — Validation error

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "funnel_slug is required and must be one of: yse-workshop, yse-ebook, your-second-engine",
    "details": { "funnel_slug": "must be one of: yse-workshop, yse-ebook, your-second-engine" }
  }
}
```

### 500 Internal Server Error

Standard error envelope. Safe to retry (idempotency on `order_number` prevents double-grants).

### 503 Service Unavailable

```json
{ "error": { "code": "SERVICE_UNAVAILABLE" } }
```

`MACHINE_PORTAL_SHARED_SECRET` is not configured on Portal. The Machine should treat this like a transient outage and retry; Portal operators will see a loud startup log line.

---

## Idempotency

- Internal key: `webhook_logs.external_id = "machine_<order_number>"` (UNIQUE constraint).
- First delivery: full processing, response cached in `webhook_logs.result`.
- Subsequent deliveries with the same `order_number`: cached response is returned with `deduped: true` and no side effects.
- Cross-source safety: `machine_abc` and `yse_abc` are distinct keys — no collision with the existing YSE/GHL integration.

---

## Never-downgrade contract

When the incoming `email` maps to an existing Portal user who already holds any other entitlement (e.g. `1year`, `lifetime`, `yse_21_day_blitz`), Portal:

- Adds `yse_front_end` to their account.
- Leaves every other `user_products` row untouched (status, expiry, source).
- Does **not** queue a welcome email.
- Does **not** reset their password or invalidate their existing login.

---

## Merge-by-email guarantee

User lookup is keyed solely on `email` (lowercased, trimmed). If two Machine orders use different `order_number` values but the same `email`, both grants attach to the same Portal account — they do not create duplicate users.

---

## Retry expectations

The Machine should retry on any non-2xx response with **exponential backoff up to 5 attempts**. Portal's idempotency guarantees:

- A retry after a 5xx that succeeded silently on Portal returns `deduped: true` on the second attempt.
- A retry after a 5xx that genuinely failed on Portal re-runs the grant and returns 201 or 200.
- Do **not** mutate `order_number` between retries — that would defeat idempotency and risk a double-grant.

After 5 failed attempts, The Machine should surface the failed delivery to its own dashboard for manual replay rather than retrying forever.

---

## Probe

Before flipping the production kill switch on the sender, fire one probe:

```bash
curl -X POST https://portal.buildtestscale.com/api/integrations/machine-purchase \
  -H "X-Machine-Webhook-Secret: $MACHINE_PORTAL_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "order_number": "tm_probe_'$(date +%s)'",
    "email": "probe+'$(date +%s)'@machine.test",
    "first_name": "Probe",
    "last_name": "Tester",
    "funnel_slug": "yse-workshop",
    "product_ids": ["probe_001"],
    "total_cents": 100,
    "occurred_at": "'$(date -u +%FT%TZ)'"
  }'
```

Expect a 201 with `userCreated: true` and `welcomeEmailQueued: true`. Then immediately re-send the identical request and confirm 200 with `deduped: true` and the same `userId`. Confirm in the Portal admin that the new member appears with the `yse_front_end` entitlement granted.

---

## Out of scope

- The outbound tier-signup webhook from Portal to The Machine (The Machine will retire/rewrite its own receiver before re-enabling).
- New role enum values — buyers land as plain `member`; the cohort signal is the `yse_front_end` grant itself.
- A staging URL — The Machine points dev at production and gates live sends behind a kill switch on its side.
- Backfill execution — The Machine will run the historical backfill itself against this endpoint once it's live.
