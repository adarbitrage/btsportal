# YSE → BTS Grant-Product Integration Contract

**Version:** 1.1  
**Last updated:** 2026-05-18  
**Scope:** BTS-side receiver. YSE-side dispatch code lives in the YSE Replit. GHL and future callers use the same endpoint with a different `externalSource` value.

---

## Overview

When a customer completes a purchase on **yoursecondengine.com**, YSE calls this endpoint to:

1. Create the BTS user account (if new), with a temporary password sent by welcome email.
2. Grant each requested BTS product as an active entitlement.
3. Sync the contact to GHL and attribute affiliate commission (if applicable).

The endpoint is idempotent: retrying the same `externalSource + externalOrderId` pair returns the cached first-call response with no side effects.

---

## Endpoint

```
POST https://<YOUR_PORTAL_DOMAIN>/api/integrations/grant-product
```

> Replace `<YOUR_PORTAL_DOMAIN>` with the BTS production API domain (e.g. `portal.buildtestscale.com`). The operator will provide this.

---

## Authentication

All requests must carry a **secret-type BTS API key** with the `integrations:grant_products` scope.

```
Authorization: Bearer <BTS_API_KEY>
```

A BTS admin must create the key once via the admin API key UI (`POST /admin/api-keys`), selecting:

- **Type:** `secret`
- **Environment:** `live`
- **Permissions:** `integrations:grant_products`
- **Rate limit tier:** `elevated` (legitimate webhook-retry storms during recovery would burst past `standard`)

The plaintext key is shown **once** at creation and must be immediately stored as `BTS_API_KEY` in the calling system's Secrets. It begins with `bts_live_sk_`.

**Never commit the key to source control.** The plaintext key is intentionally **not** stored in this document — see "Where the key lives" below.

### One key per scope, not one key per caller

A single API key carrying the `integrations:grant_products` scope is sufficient to serve **all** callers (YSE, GHL, and any future external system that needs to grant products). Callers are distinguished at the payload level via `externalSource`, not at the key level — the scope is the trust boundary, not the caller identity.

**Default recommendation:** mint one shared key (e.g. "External Integrations — grant_products"). All callers send the same `Authorization` header; their `externalSource` value identifies which system the call came from.

**When to mint per-caller keys instead:**
- You need to revoke one caller's access without breaking the others (e.g. a vendor offboards).
- You want per-caller usage attribution in the `api_keys.last_used_at` / audit log.
- You want to apply different rate-limit tiers per caller.

If you mint per-caller keys, use descriptive names (`"YSE — grant_products"`, `"GHL Webhook — grant_products"`). Each key still carries the same single scope.

> **Note on current dev key:** The seeded dev row (`api_keys.id=5`, label `"YSE GHL Integration"`) is the per-scope shared key for the dev environment. The label is intentionally generic — it's the key for any system using this scope, not a YSE-only or GHL-only key. Re-label it on prod-mint if you prefer (e.g. `"External Integrations — grant_products"`).

### Where the key lives

- **Plaintext copy:** stored only as the `BTS_API_KEY` secret in each calling Replit (Secrets pane). The caller reads it from `process.env.BTS_API_KEY` at runtime.
- **BTS side:** only a bcrypt hash + prefix is persisted, in the `api_keys` table. The plaintext cannot be recovered from BTS; if it is lost, an admin must rotate the key (create a new one, update the caller's secret, then revoke the old row).
- **This document:** must **never** contain the plaintext key. If you arrived here looking for the key, retrieve it from the calling Replit's Secrets pane.

---

## Request

### Headers

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `Authorization` | `Bearer <BTS_API_KEY>` |

### Body (JSON)

```jsonc
{
  "externalOrderId": "yse_order_abc123",   // YSE's unique order ID — used for idempotency
  "externalSource": "yse",                  // Always "yse" for this integration
  "customer": {
    "email": "jane@example.com",            // Required
    "firstName": "Jane",                    // Optional
    "lastName": "Doe",                      // Optional
    "phone": "+15551234567"                 // Optional, E.164 format
  },
  "productSlugs": ["yse_front_end"],        // 1+ BTS product slugs to grant
  "purchasedAt": "2026-05-18T12:00:00Z",   // ISO 8601 datetime of purchase
  "metadata": {                             // Optional extra context
    "bts_ref": "affiliatecode123"           // Include for commission attribution
  }
}
```

### Field rules

| Field | Type | Required | Notes |
|---|---|---|---|
| `externalOrderId` | string | ✓ | Caller's unique order/event ID; idempotency key (combined with `externalSource`) |
| `externalSource` | string | ✓ | Caller's own identifier — see "externalSource convention" below |
| `customer.email` | string (email) | ✓ | Normalized to lowercase |
| `customer.firstName` | string | ✗ | |
| `customer.lastName` | string | ✗ | |
| `customer.phone` | string | ✗ | E.164 format if present |
| `productSlugs` | string[] (≥1) | ✓ | Must be valid BTS product slugs (see below) |
| `purchasedAt` | string (ISO 8601) | ✓ | |
| `metadata` | object | ✗ | Pass `bts_ref` here for commission attribution |

### externalSource convention

Callers pass their own short identifier for `externalSource`:

| Caller | `externalSource` value |
|---|---|
| YSE checkout (NMI charge handler in YSE Replit) | `"yse"` |
| GHL webhook (GHL order form → BTS) | `"ghl"` |
| Future integrations | pick a short, stable, lowercase identifier (`"thrivecart"`, `"stripe"`, etc.) |

**Important safety property — source namespacing.** Internally, BTS computes the idempotency key as `` `${externalSource}_${externalOrderId}` `` and stores it in `webhook_logs.external_id` (UNIQUE). This means an order `abc123` from YSE and a separately-tracked event `abc123` from GHL **do not collide** — they are stored as two distinct rows (`yse_abc123` and `ghl_abc123`), each with its own cached response and retry counter.

You should never need to "namespace" your own `externalOrderId` to avoid collisions with other callers — just send your own native order ID and let BTS namespace it for you via the source prefix.

> **Edge case to avoid:** Since the separator is `_`, do not pick an `externalSource` that ends with `_` or an `externalOrderId` that starts with one. The pair `("yse_", "order_1")` and the pair `("yse", "_order_1")` both produce `external_id = "yse__order_1"`. Stick to short alphanumeric source identifiers (`yse`, `ghl`, `thrivecart`, `stripe`) and this is a non-issue.

---

## Seeded YSE Products

The following product slugs are available for use in `productSlugs`:

| Slug | Name | Price | Entitlements |
|---|---|---|---|
| `yse_front_end` | YSE Front End | $67 | content:frontend, support:basic, chat:basic |
| `yse_affiliate_cmo_bump` | YSE Affiliate CMO Bump | $47 | content:frontend, support:basic, chat:basic |
| `yse_21_day_blitz` | YSE 21-Day Blitz | $297 | content:frontend, content:advanced, software:base, support:standard, chat:full |
| `yse_swipe_resource_bank` | YSE Swipe Resource Bank | $97 | content:frontend, support:basic, chat:basic |
| `yse_profit_maximizer_pass` | YSE Profit Maximizer Pass | $97 | content:frontend, content:advanced, support:standard, chat:full |

---

## Response

### 200 OK — Success

```jsonc
{
  "userId": 1042,
  "userCreated": true,          // true only when a new BTS account was created
  "grants": [
    {
      "productSlug": "yse_front_end",
      "productId": 9,
      "userProductId": 87,
      "alreadyGranted": false   // true if the user already had an active grant
    }
  ],
  "welcomeEmailQueued": true    // true only when userCreated is true
}
```

---

## Error Responses

All errors follow this shape:

```jsonc
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": { ... },         // optional; present on 400 and 404
    "requestId": "uuid"
  }
}
```

| HTTP Status | `code` | Cause |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Missing or invalid field (e.g. missing email, empty productSlugs) |
| `401` | `AUTHENTICATION_REQUIRED` / `INVALID_API_KEY` | No `Authorization` header, or invalid/revoked API key |
| `403` | `FORBIDDEN` | API key lacks `integrations:grant_products` scope, or is a publishable key |
| `404` | `NOT_FOUND` | One or more `productSlugs` are not recognized; `details.unknownSlugs` lists them |
| `500` | `INTERNAL_ERROR` | Unexpected server error; retry is safe (idempotency prevents double-grants) |

---

## Idempotency

The endpoint is **fully idempotent** on the combination of `externalSource` + `externalOrderId`.

- The first successful call processes the grant and caches the full response.
- Any subsequent call with the same `externalSource` + `externalOrderId` returns the cached response immediately, with **no side effects** (no duplicate user-product rows, no duplicate emails, no duplicate GHL tags).
- This means callers can safely retry on network errors, timeouts, or 5xx responses.

### How it's enforced (defense in depth)

1. **UNIQUE constraint** on `webhook_logs.external_id` makes a duplicate insert physically impossible.
2. **PostgreSQL transaction advisory lock** (`pg_advisory_xact_lock`) keyed off the external_id serializes concurrent calls with the same key, so two simultaneous retries can't both pass the cache check.
3. **Cached-response check inside the lock** — if a prior call already produced a `result`, that result is returned and no further work runs.

### Retry and backoff (server-side)

If a grant attempt fails after passing validation (e.g. transient DB hiccup, GHL sync error), BTS records it to `webhook_logs` with `status='failed'` and schedules a retry. A background worker (`yse-grant-retry`) re-runs `handleExternalGrantProduct` for any row whose `next_retry_at` has elapsed.

| Attempt | Delay after previous failure |
|---|---|
| 1 → 2 | 60 seconds |
| 2 → 3 | 5 minutes |
| 3 → 4 | 30 minutes |
| 4 → 5 | 2 hours |
| 5 → giving up | 6 hours |

After **5 total attempts**, the row stays as `status='failed'` with `next_retry_at=NULL` and is **not** retried automatically. An admin must replay it from the dashboard ("Retry now" button).

**Implication for callers:** Once a call returns 200, the grant is permanent — don't retry on a 200. If you receive a 500 or a network error, retry with the same payload; BTS will either succeed or queue the retry on its own side. Either way, **do not change `externalOrderId` between retries** — that would defeat idempotency and risk a double-grant.

---

## Worked Example

### Request

```bash
curl -X POST https://<YOUR_PORTAL_DOMAIN>/api/integrations/grant-product   -H "Authorization: Bearer <BTS_API_KEY>"   -H "Content-Type: application/json"   -d '{
    "externalOrderId": "nmi_order_55512",
    "externalSource": "yse",
    "customer": {
      "email": "jane.doe@example.com",
      "firstName": "Jane",
      "lastName": "Doe",
      "phone": "+15551234567"
    },
    "productSlugs": ["yse_front_end", "yse_affiliate_cmo_bump"],
    "purchasedAt": "2026-05-18T14:30:00Z",
    "metadata": {
      "bts_ref": "affiliatecode123"
    }
  }'
```

### Response (200 OK)

```json
{
  "userId": 1042,
  "userCreated": true,
  "grants": [
    {
      "productSlug": "yse_front_end",
      "productId": 9,
      "userProductId": 87,
      "alreadyGranted": false
    },
    {
      "productSlug": "yse_affiliate_cmo_bump",
      "productId": 10,
      "userProductId": 88,
      "alreadyGranted": false
    }
  ],
  "welcomeEmailQueued": true
}
```

---

## Operator Copy-Paste Block

Create the API key via the admin panel (Admin → API Keys → New Key) with scope `integrations:grant_products` and type `secret`. Then store the following in the YSE Replit's Secrets and chat:

```
BTS_API_KEY=<plaintext key shown once at creation>
BTS_GRANT_PRODUCT_URL=https://<YOUR_PORTAL_DOMAIN>/api/integrations/grant-product

Example payload:
{
  "externalOrderId": "{{ order.id }}",
  "externalSource": "yse",
  "customer": {
    "email": "{{ customer.email }}",
    "firstName": "{{ customer.first_name }}",
    "lastName": "{{ customer.last_name }}",
    "phone": "{{ customer.phone }}"
  },
  "productSlugs": ["yse_front_end"],
  "purchasedAt": "{{ order.created_at }}",
  "metadata": {
    "bts_ref": "{{ order.affiliate_code }}"
  }
}
```

---

## Side Effects (for reference)

When a grant is processed, BTS automatically:

1. **Creates the user account** (if new) with a temporary password and sends a welcome email.
2. **Grants each product** as an active `user_products` row with `external_source="yse"` and `external_order_id` set.
3. **Syncs to GHL**: for new members, creates the contact with `new_member` + `yse_signup` tags; for all members, applies product tags (`product_yse_front_end`, etc.) + `active_customer` tag and adds a grant note.
4. **Ensures an affiliate profile** exists if the user qualifies (based on entitlement keys).
5. **Records the grant** in `webhook_logs` with `event_type="external.grant_product"` for audit.

---

## Companion Endpoint — Revoke

For chargebacks, refunds, or any case where a previously-granted product needs to be pulled back, BTS exposes a sibling endpoint with the same authentication and scope:

```
POST https://<YOUR_PORTAL_DOMAIN>/api/integrations/revoke-product
```

### Body

```jsonc
{
  "externalOrderId": "yse_order_abc123",   // the original order's externalOrderId
  "externalSource": "yse",                  // the original order's externalSource
  "reason": "chargeback"                    // optional, free-form string for audit
}
```

The endpoint looks up the original grant by `(externalSource, externalOrderId)`, marks the matching `user_products` rows as revoked, removes the corresponding GHL product tags, and records the revocation in `webhook_logs`. Auth, scope, and error envelope are identical to `/grant-product`.

---

## Out of Scope

- YSE-side dispatch code (lives in the YSE Replit).
- Changes to existing ThriveCart or GHL webhook receivers.
- Direct database access from external callers.
- New GHL tag-triggered automations.

---

# Operator Prod-Prep Appendix

This appendix is for the BTS operator running the **production-prep dispatch** (a separate task from the BTS-side integration work). Everything below is what production needs before the YSE-side integration can call live.

## 1. Production schema migration — `webhook_logs`

Dev was prepared in this dispatch. **Prod still needs the same migration.** Apply this exact block in one transaction against the prod DB:

```sql
BEGIN;

-- Add idempotency retry columns
ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

-- Backfill attempts so existing terminal-state rows look correct in the dashboard
UPDATE webhook_logs
SET attempts = 1
WHERE attempts = 0 AND status IN ('processed', 'failed', 'revoked');

-- Add UNIQUE constraint required by the ON CONFLICT (external_id) upsert in
-- handleExternalGrantProduct. Without this, the handler crashes.
ALTER TABLE webhook_logs
  ADD CONSTRAINT webhook_logs_external_id_unique UNIQUE (external_id);

-- Partial index to make the retry-sweep scan cheap
CREATE INDEX IF NOT EXISTS webhook_logs_retry_idx
  ON webhook_logs (status, next_retry_at)
  WHERE status = 'failed' AND next_retry_at IS NOT NULL;

COMMIT;
```

### Pre-flight check (REQUIRED before running the above)

The UNIQUE constraint will fail if prod has any duplicate `external_id` values. Run this **first** and verify it returns zero rows:

```sql
SELECT external_id, COUNT(*) AS n
FROM webhook_logs
WHERE external_id IS NOT NULL
GROUP BY external_id
HAVING COUNT(*) > 1;
```

If it returns rows, **stop**. Do not auto-dedupe — bring the rows to the operator for inspection. (Dev was clean; prod is expected to be clean too, but verify before assuming.)

## 2. Production seed — YSE products

Apply the 5 YSE product rows to prod (slugs, prices, and entitlements are in the "Seeded YSE Products" section above). The seed script in `artifacts/api-server/src/seed.ts` already contains the idempotent block; running it against the prod DB inserts only the missing rows.

Verify after seeding that `yse_21_day_blitz` has `duration_days = NULL` (the product name is marketing-only; access is permanent).

## 3. Mint the production API key

Use the admin UI (or `POST /admin/api-keys` directly) against prod:

```jsonc
{
  "name": "External Integrations — grant_products",
  "type": "secret",
  "environment": "live",
  "permissions": ["integrations:grant_products"],
  "rateLimitTier": "elevated"
}
```

Capture the plaintext key from the response **once**. Store it as `BTS_API_KEY` in the YSE Replit's Secrets (and any other calling system's Secrets, per the "One key per scope" guidance above).

## 4. `user_products.expires_at` backfill (only if Blitz grants pre-date the fix)

The `yse_21_day_blitz` product was briefly seeded with `duration_days=21` (bug, since fixed). If any production `user_products` rows were granted with that bad value, their `expires_at` will be set to a 21-day-from-grant timestamp instead of `NULL`. Fix them with:

```sql
-- Inspect first
SELECT up.id, up.user_id, up.granted_at, up.expires_at, p.slug
FROM user_products up
JOIN products p ON p.id = up.product_id
WHERE p.slug = 'yse_21_day_blitz' AND up.expires_at IS NOT NULL;

-- If any rows returned and you confirm they should be permanent, clear:
UPDATE user_products
SET expires_at = NULL
WHERE product_id = (SELECT id FROM products WHERE slug = 'yse_21_day_blitz')
  AND expires_at IS NOT NULL;
```

(Skip this step entirely if the query returns zero rows.)

## 5. Production environment variables checklist

The api-server reads the following at startup. All must be set in the prod Replit Secrets before the YSE integration can function end-to-end:

| Variable | Purpose | Required for |
|---|---|---|
| `DATABASE_URL` | Prod Postgres connection string | All endpoints |
| `JWT_SECRET` | Session/auth signing | All endpoints |
| `SENDGRID_API_KEY` | Welcome emails to new YSE customers | `grant-product` (new-customer path) |
| `SENDGRID_FROM_EMAIL` | "From" address on welcome emails | `grant-product` (new-customer path) |
| `TELNYX_API_KEY` | Optional SMS notifications | `grant-product` (if SMS templates active) |
| `TELNYX_FROM_NUMBER` | Optional SMS sender | `grant-product` (if SMS templates active) |
| `GHL_CHERRINGTON_CLIENT_ID` | GHL OAuth (contact sync) | `grant-product` (GHL sync step) |
| `GHL_CHERRINGTON_CLIENT_SECRET` | GHL OAuth | `grant-product` (GHL sync step) |
| `FOLLOWUP_WORKER_ENABLED` | Set `"true"` to enable the retry worker | retry of failed grants |
| `NMI_*` (existing) | Existing NMI vars on BTS side — no change needed | unrelated to this integration |

The YSE Replit additionally needs:

| Variable | Purpose |
|---|---|
| `BTS_API_KEY` | The plaintext key minted in step 3 |
| `BTS_INTEGRATION_URL` | `https://<YOUR_PORTAL_DOMAIN>/api/integrations` — base URL the YSE code appends `/grant-product` and `/revoke-product` to |

## 6. Known migration debt — Drizzle out of sync

The dev DB has hand-applied schema changes (this dispatch's `webhook_logs` ALTERs, plus prior tasks #425 / #319 / #383 / #437) that are **not** captured in committed Drizzle migration files. This is because `drizzle-kit push` / `generate` is currently blocked by a pre-existing check-constraint violation on `vault_resources.tags` (tracked separately — needs the `vault_resources_tags_is_array` data fix before drizzle-kit can run cleanly).

**What this means for prod-prep:**
- **Do not** rely on `drizzle-kit push` to apply the prod schema. Use the raw SQL in section 1 above.
- After the prod-prep dispatch lands, follow-up work should unblock the vault constraint and regenerate the Drizzle migrations so the committed schema once again matches reality. Until then, schema changes must be hand-applied + documented (as this dispatch did).

---

## Change Log

- **1.1** (2026-05-18): Added externalSource convention + source-namespacing safety property. Added "One key per scope, not per caller" guidance. Added retry/backoff model. Added revoke companion endpoint. Added operator prod-prep appendix (prod ALTER plan, seed, API key mint, expires_at backfill, env vars, Drizzle gap note).
- **1.0** (2026-05-18): Initial draft.
