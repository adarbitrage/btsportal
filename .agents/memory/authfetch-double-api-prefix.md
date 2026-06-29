---
name: authFetch double /api prefix + content-access remount loop
description: portal authFetch already prepends BASE_URL+api; a doubled /api 404 turned the content-access guard into a flickering remount loop
---

Portal `authFetch(path)` (src/lib/auth.tsx) builds the URL as `${import.meta.env.BASE_URL}api${path}`, i.e. it ALREADY adds the `/api` segment. Callers must pass the path WITHOUT a leading `/api` (e.g. `authFetch("/content-access/me")`, not `authFetch("/api/content-access/me")`). A doubled `/api/api/...` returns 404.

**Why it was nasty:** the doubled-URL 404 left the `useContentAccess` react-query in an errored, no-data state. Such a query is permanently stale, so `refetchOnMount` re-fired on every remount. The `ContentAccessRoute` guard gates render on `accessLoading`, which flipped pending↔settled at network-RTT cadence (~126ms), unmounting/remounting `BlitzHub` in a loop. Symptom: a permanent, *twitching* loading spinner on `/blitz` (and all ContentAccessRoute pages) — looked like a hang, was actually a fast mount/unmount cycle. Diagnosis required a real authenticated browser (cookie-injected Playwright via system chromium) counting per-URL request fires; isolated endpoint timing tests all returned 200 fast and hid it.

**Prevention guardrails in place (don't remove):** (1) `authFetch` throws in DEV if the path starts with `/api` (the footgun fails loudly before shipping); (2) the `ContentAccessRoute` spinner gate is `accessLoading && !accessError` so an errored content-access query can never drive the spinner loop again; (3) an e2e smoke test (member-content-gated-pages-render) logs in as a member, loads /blitz, and asserts both the page renders and the Training nav is present.

**Nav fail-open parity:** the guard fails OPEN on content-access error (renders the page), but `Sidebar`'s `filterNavByContentAccess` got an empty Set on the 404 and hid all content-gated nav → members lost the Training menu (admins bypassed via `isAdminUser||isCoach`). Fix: pass `isAdminUser || isCoach || accessError` as the bypass so nav fail-opens too. **How to apply:** any consumer of `useContentAccess().accessiblePageKeys` for gating must also honor `isError` as fail-open, matching the route guard.
