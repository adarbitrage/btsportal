---
name: Front-end curriculum de-bundle + ownership gating
description: Pattern for serving course prose from gated endpoints instead of the JS bundle (7 Pillars / Quick-Start / Pillars-to-Blitz / Tips & Tricks), and its traps.
---

Pattern (mirrors the Blitz guide): page prose lives server-side in
`api-server/src/lib/curriculum-content.ts` with `{{brand.*}}` tokens, served by
`routes/curriculum.ts` — one `GET /curriculum/<pageKey>` per page behind
`requirePageAccess(pageKey)`. Client pages keep only JSX structure + styling/icon
arrays; prose arrives via `useCurriculumContent(pageKey)` (react-query,
staleTime Infinity) with brand substitution and `data-spa` anchor interception.

**Why / traps:**
- **Never sessionStorage-cache gated content.** A persisted copy can be replayed
  by a different (non-owner) account on the same browser, and ContentAccessRoute
  fails open on access-check errors. In-memory query cache only; every session
  revalidates against the gated endpoint.
- **Check PUBLIC_PATHS when gating a formerly public endpoint.** `/affiliate-networks`
  was in the auth middleware's PUBLIC_PATHS, so `requirePageAccess` saw no userId
  and returned 401 for everyone. Gating = remove from PUBLIC_PATHS + gate + update
  the legacy "public list" test to the new contract.
- Leak-guard test scans portal/src for distinctive prose phrases; pick phrases that
  don't appear in marketing blurbs (CoreTraining cards) or account-level Vidalytics
  ids reused across pages. Separate manual step: build + grep `dist/public/assets`.
- Course-progress family gating: valid static course ids are EXACT strings
  ("7-pillars", "quick-start", "finding-your-edge", "21-day-blitz", "live-coaching"),
  not prefixes — tests using suffixed ids get 400 before the gate.
- Any portal test rendering Blitz/curriculum pages now needs QueryClientProvider +
  mocked `authFetch` returning the guide/curriculum payload (content is no longer
  inline), and must `waitFor` the async injection.
