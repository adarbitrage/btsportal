# Coordinated BTS + Machine Publish Checklist

**Status: PUBLISH ON HOLD.** Do not publish until the user explicitly signals the single coordinated BTS + Machine deploy (post-Tapfiliate). This checklist gates that publish.

## Context

Everything in the recent enforcement arc was built **dev-only** under the deploy hold and ships together in this one publish:

- Ownership-gated navigation (content_access_map–driven sidebar + `requirePageAccess`)
- Blitz enforcement hardening
- KB ownership filter (`owner_page_key` gating of Blitz/seven-pillars docs in retrieval)
- Front-End Curriculum Enforcement + Direct Edge removal (course prose de-bundled to gated server endpoints; `/affiliate-networks` removed from PUBLIC_PATHS; Direct Edge page/route/card/access-map row deleted)

Also riding the same publish: the 5-brand Machine grant wiring fix (merged-but-not-live, the original reason for the hold).

Walk the items in order. Pre-publish items are 1–6; item 7 is the post-publish canary; item 8 is optional cleanup.

---

## Pre-publish

### 1. Browser spot-check as a front-end-only test account

The one acceptance item verified only by automated tests, never eyeballed in a browser.

- Log into the **dev portal** as a member holding exactly one front-end product (e.g. `yse_front_end`) and no membership tier. (A temp member can be created and granted via the DB; clean up after — see `.agents/memory/chat-e2e-temp-member.md` for the pattern.)
- Visit all four de-bundled pages: `/core-training/seven-pillars`, `/core-training/quick-start`, `/pillars-to-blitz`, `/core-training/tips-and-tricks` (confirm exact routes in the portal router if these drift).
- Verify each renders identically to the pre-de-bundle design: full prose present (fetched from `/api/curriculum/<pageKey>`), **brand substitution applied** (no raw `{{brand.*}}` tokens anywhere), styling/icons intact.
- Verify the **Vidalytics embed plays on 7 Pillars** (Vidalytics needs its JS loader; a blank box = regression).
- Also confirm a **no-product** account gets the locked/denied experience on the same four pages and on `/affiliate-networks` (no prose flash, no console 500s — 403s with `CONTENT_NOT_OWNED` are expected).

### 2. Verify the four solitary-upsell holders in prod

Enforcement will lock out anyone holding ONLY an upsell product with no front-end product.

- Read-only prod query (database skill, `environment: "production"`): find users whose only active `user_products` grant is one of `yse_21_day_blitz`, `yse_affiliate_cmo_bump`, `yse_swipe_resource_bank`, `yse_profit_maximizer` — i.e. no active front-end product (`yse_front_end`, `backroad`, `offmarket`, `reserve_income`, `silent_partner`, `test_like_mad`) and no membership tier (`launchpad`, `3month`, `6month`, `1year`, `lifetime`).
- As of the last dev-time check there were **four** such holders, believed to be test accounts. Confirm each is a test account (email pattern / purchase history).
- If any is a **real buyer**, grant them the appropriate front-end product **before** publishing (via the normal admin grant path, not raw SQL) so enforcement doesn't lock a paying customer out of curriculum.

### 3. Purge direct-edge course-progress rows in prod

Direct Edge was removed entirely. Dev had **zero** rows; prod may not.

- Pre-flight (read-only prod): `SELECT COUNT(*) FROM course_progress WHERE course_id = 'direct-edge';` — **record the count**.
- Delete those rows. Note: the agent cannot write to prod directly — use the established seam (idempotent boot-time data repair in `app.ts`, or an OPS_API_KEY-gated ops endpoint hit via a throwaway console workflow; see `.agents/memory/prod-db-data-fixes-via-startup-hooks.md` and `prod-ops-call-secret-workflow.md`).
- Also delete any prod `content_access_map` row with `page_key = 'direct-edge'` if present (dev had 1; the dev row is already gone).

### 4. Run the sourceProduct backfill against prod (own deliberate step)

Prod members still carry old hardcoded origins from before per-member brand substitution.

- Pre-flight (read-only prod): count members whose `source_product` (users table — confirm exact column) is NULL or the legacy hardcoded value — **state the count first**.
- Then run the backfill via the same prod-write seam as item 3. This must be its own deliberate, logged step — not silently bundled into another repair.
- Post-check: re-run the count; verify the four curriculum pages substitute the right brand for a spot-checked member of a non-default brand.

### 5. Fresh eyeball on the two known-failing workflow runs

The `test` and `db-drift` workflows have known **environment-timeout** flake modes. Immediately before publishing:

- Re-run both workflows (`test`, `db-drift`) and read the failures fresh. Do **not** wave off a failure as "the known timeout" without reading it — a real regression introduced at publish time could hide behind the same red X.
- Both should be green (or failing only with the previously characterized environment timeout, freshly re-confirmed as such) before proceeding.

### 6. Confirm owner_page_key columns + boot stamps land in prod

Two additive columns ride this publish: `ai_live_documents.owner_page_key` and `kb_staging_docs.owner_page_key` (dev drift baseline already updated for both).

After the publish boots prod:

- Confirm both columns exist in prod (read-only prod query against `information_schema.columns`). They land via the boot DDL / Publish schema flow — **never** via `drizzle-kit push --force`.
- Confirm the idempotent boot stamps ran:
  - Blitz corpus docs stamped `owner_page_key = 'blitz'`.
  - The six seven-pillars docs stamped `owner_page_key = 'seven-pillars'` — **2 live** (`ai_live_documents`) + **4 staging** (`kb_staging_docs`). (Dev reference IDs: live 10508/10528, staging 1269/1362/1398/1491 — prod IDs will differ; match by title.)
- `SELECT owner_page_key, COUNT(*) FROM ai_live_documents GROUP BY 1;` (and same for staging) is a quick sanity read.

---

## Post-publish canary (required — publish is not done without it)

### 7. No-product canary + owner citation check

With a **no-product prod account** (test account with zero grants), verify **403/denied** across the five gated endpoint families:

1. **Blitz APIs** — guide body endpoint (`/api/blitz/guide`), and course-progress reads/writes for Blitz including the **legacy course-progress IDs** (`21-day-blitz` and `blitz-hub-step-v2-*`).
2. **The four curriculum page-body endpoints** — `/api/curriculum/seven-pillars`, `/quick-start`, `/pillars-to-blitz`, `/tips-and-tricks`.
3. **`/api/affiliate-networks`** — 401 logged out, 403 `CONTENT_NOT_OWNED` for the no-product member (it is no longer public).
4. **Gated course-progress writes** — POST/PATCH progress for any gated course family is rejected fail-closed.
5. **KB retrieval** — the assistant (`/api/chat`) returns **no gated docs** to the no-product account: ask a Blitz-specific and a seven-pillars-specific question; answers must not cite or quote the stamped docs, and prompts must not leak Blitz section names.

Then with an **owner** account (front-end product holder): verify the assistant **does** cite seven-pillars docs, and the Blitz owner sees Blitz docs.

Admin/coach bypass sanity: an admin account can still open all four pages and the affiliate-networks list.

### 8. Optional cleanup: re-file the nav-map doc

The pre-existing `kb-nav-grounding-determinism` test failure is caused by the real nav-map doc being filed as the wrong class. Re-file it (`doc_class` back to `overview`) via the admin review UI or a targeted staging-row update, then re-run the test to confirm it clears. Nav grounding intentionally orders `navigation > overview` — see `.agents/memory/kb-filed-placement-authoritative.md`.

---

## Standing cautions (outlive this publish)

- **XSS-via-innerHTML on curriculum pages.** The four de-bundled pages render server-supplied HTML with `dangerouslySetInnerHTML`. This was judged acceptable **only** because the content is server-side constants (`api-server/src/lib/curriculum-content.ts`) with zero user or DB input. **If curriculum content ever becomes DB-stored or admin-editable, HTML sanitization becomes mandatory at that moment** — do not port the constants to a DB table without adding it.
- **Coaching-seed still mentions Direct Edge.** `artifacts/api-server/src/data/coaching-seed.json` contains three historical transcript summaries listing "Direct Edge" as an available training. The course no longer exists. **If that corpus is ever re-seeded or re-synthesized, scrub those references first**, or the AI pipeline will resurface a dead course to members.
