# YSE → BTS Grant-Product Integration Contract

**Version:** 1.0  
**Last updated:** 2026-05-18  
**Scope:** BTS-side receiver. YSE-side dispatch code lives in the YSE Replit.

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

The plaintext key is shown **once** at creation and must be immediately stored as `BTS_API_KEY` in the YSE Replit's Secrets. It begins with `bts_live_sk_`.

**Never commit the key to source control.**

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
| `externalOrderId` | string | ✓ | YSE order ID; idempotency key (combined with `externalSource`) |
| `externalSource` | string | ✓ | Always `"yse"` |
| `customer.email` | string (email) | ✓ | Normalized to lowercase |
| `customer.firstName` | string | ✗ | |
| `customer.lastName` | string | ✗ | |
| `customer.phone` | string | ✗ | E.164 format if present |
| `productSlugs` | string[] (≥1) | ✓ | Must be valid BTS product slugs (see below) |
| `purchasedAt` | string (ISO 8601) | ✓ | |
| `metadata` | object | ✗ | Pass `bts_ref` here for commission attribution |

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
- This means YSE can safely retry on network errors, timeouts, or 5xx responses.

---

## Worked Example

### Request

```bash
curl -X POST https://<YOUR_PORTAL_DOMAIN>/api/integrations/grant-product \
  -H "Authorization: Bearer bts_live_sk_<your_key_here>" \
  -H "Content-Type: application/json" \
  -d '{
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

## Out of Scope

- YSE-side dispatch code (lives in the YSE Replit).
- Changes to existing ThriveCart or GHL webhook receivers.
- Direct database access from YSE.
- New GHL tag-triggered automations.
