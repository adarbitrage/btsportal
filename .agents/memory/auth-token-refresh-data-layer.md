---
name: Auth token 401 refresh in the data layer
description: Why "reload fixes the page but in-app navigation doesn't" maps to access-token expiry, and where the silent refresh lives.
---

# Access-token expiry & the data-layer refresh

Access tokens are short-lived (15-minute JWTs); the long-lived `refresh_token`
(httpOnly, rotated server-side) is what mints new ones. There are now **two**
places a fresh access token gets minted:

1. **App boot** — `AuthProvider.refreshAuth()` runs once on mount (`/auth/me`,
   then `POST /auth/refresh` on failure). This is why a **hard reload** always
   recovers a stale session.
2. **The shared `customFetch`** (`lib/api-client-react/src/custom-fetch.ts`) —
   on any `401`, it makes a **single-flight** `POST <prefix>/api/auth/refresh`
   (URL derived from the failing request so base-path/origin is preserved),
   then **replays the original request once**. Auth routes (`/api/auth/*`) and
   `Request`-object inputs are skipped.

**Why:** React Query is configured `retry:false`. Before fix #2 existed, once
the 15-min token expired, every generated-hook query 401'd and surfaced as an
error with no recovery — most visibly the Apps page, whose error card literally
says "Could not load apps. Please refresh the page." So the classic symptom
"page won't load on in-app nav but a browser refresh fixes it" is the
signature of access-token expiry with no live refresh path, **not** a routing,
chunk-loading, or page-specific bug.

**How to apply:**
- If a user reports a page that "only loads after refresh," suspect token
  expiry first; reproduce by aging/expiring the `access_token` cookie, not by
  clicking around with a fresh login (a just-logged-in e2e never reproduces it).
- Keep the refresh as raw `fetch` (never recurse through `customFetch`) and keep
  `/api/auth/*` excluded, or you reintroduce a refresh→401→refresh loop.
- A failed refresh deliberately surfaces the original 401 (true re-login case);
  don't swallow it.
- Replaying after a 401 is safe for mutations: a 401 is rejected by auth
  middleware before the handler runs, so nothing double-executes. The only
  unsafe replay is a non-string/stream `init.body`, which orval callers don't
  produce.
