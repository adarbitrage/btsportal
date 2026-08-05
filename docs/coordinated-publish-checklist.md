# Coordinated BTS + Machine Publish Checklist

**Status: PUBLISH OCCURRED — hold RETIRED.** A human-initiated publish shipped this entire arc on **August 5, 2026 at ~18:00 UTC** (snapshot commit `2aba113e`, tree identical to `b1f7dae8`). The owner has confirmed pre-launch status with zero customers; publishes are now **deliberate acts after checks, not forbidden ones**. This document is retained as the walked record plus the remaining punch list.

## What shipped in that publish

- Ownership-gated navigation (content_access_map–driven sidebar + `requirePageAccess`)
- Blitz enforcement hardening
- KB ownership filter (`owner_page_key` gating of Blitz/seven-pillars docs in retrieval)
- Front-End Curriculum Enforcement + Direct Edge removal
- Front-End Welcome page + FE-Intensive booking (schema live, feature dormant until admin sets calendar settings)
- The 5-brand Machine grant wiring fix (BTS side now live)

---

## Walked items — results (post-publish reconciliation, Aug 5 2026)

### 1. Browser spot-check as a front-end-only test account — ⏳ PUNCH LIST
Not performed pre-publish. Carried forward below (follow-up #2067 covers the six-brand eyeball).

### 2. Solitary-upsell holders in prod — ✅ CLEAR
Prod query (Aug 5): **zero** users hold only upsell products with no front-end product/tier. Nobody is locked out.

### 3. Direct-edge purge in prod — ✅ FIXED VIA BOOT REPAIR
Prod pre-flight: `course_progress` direct-edge rows = **0**; one stale `content_access_map` row (`page_key='direct-edge'`) remained. An idempotent boot repair (`runDirectEdgeResidueCleanup`) now purges both on every boot — the prod row disappears on the next publish's boot.

### 4. sourceProduct backfill — ✅ MECHANISM LANDED (dev done; prod on next publish boot)
Now a **one-time, marker-gated boot repair** (`runSourceProductBackfillOnce`, marker `source_product_backfill_2026_08` in system_settings) so later deliberate `source_product` edits are never clobbered by reboots. Dev run: pre-flight 112 NULL, 1450 rows reconciled. Prod pre-flight (Aug 5): 23 NULL + 1 legacy `yse` of ~35 users; runs and logs counts on the next publish's boot.

### 5. Fresh eyeball on test/db-drift — ✅ RECONFIRMED
Post-publish: `db-drift` 5/5 green; portal `test` run had 3 failures, all 20s environment timeouts. All three (Account.adminCancelledBanner, blitz-section-view, MemberDetail.impersonation) **re-run clean on a quiet box** — confirmed flakes, no regression.

### 6. owner_page_key columns + boot stamps in prod — ⚠️ MECHANISM BUG FOUND & FIXED
Both columns landed in prod ✅. Blitz stamping is **complete for prod's corpus** (all 12 blitz-anchored live docs stamped; prod staging has zero `blitz_section_import` rows, so 0 staging stamps is correct — dev's 37/29 counts reflect dev's larger corpus, not a prod gap). The seven-pillars stamp **missed prod's one seven-pillars doc** (staging id 7, "The 7 Pillars of a Profitable Digital Business" — no ™), because the stamp matched exact titles. **Fixed:** the stamp now matches **normalized title identity** (lowercase, non-alphanumerics stripped; `regexp_replace(lower(title), '[^a-z0-9]+','','g')`), full-title equality only. Prod self-heals on the next publish's boot. Prod has no seven-pillars live docs — nothing else to stamp there.

### 6b. frontend-welcome access-map row in prod — ✅ CONFIRMED
Row exists with all 15 slugs.

### FE-intensive schema in prod — ✅ CONFIRMED
`fe_intensive_bookings` exists, 0 rows, config settings unset → dormant by design.

---

## Punch list (remaining)

1. ~~Republish + verify~~ ✅ **DONE Aug 5 ~19:36 UTC.** Boot log confirmed: direct-edge cleanup removed 1 access-map row / 0 progress rows; sourceProduct backfill pre-flight 23 NULL → 33 rows updated, marker recorded; prod queries verified 0 NULL / 0 legacy `yse`, staging doc id 7 stamped `seven-pillars`, Blitz 12 live stamps intact, direct-edge rows 0/0.
2. ~~Post-publish canary (item 7)~~ ✅ **DONE Aug 5.** 29/29 effective (28 hard passes; the one scripted "failure" — raw `{{brand.*}}` in the frontend-welcome API body — is the designed contract: substitution is client-side in `useCurriculumContent`). All five gated families 403 for a zero-grant member (+401 logged out), FE owner 200s + still denied Blitz, admin bypass 200s. **Caveat:** the positive "assistant cites seven-pillars" check cannot pass in prod yet — prod's `ai_live_documents` has ZERO seven-pillars docs (only staging id 7 is stamped, unpublished to live). Gate correctness proven via stamp + denial paths; citation check becomes possible once that doc is pushed to live.
3. ~~Fresh full `test` run~~ ✅ **DONE Aug 5** — 137 files / 783 tests, all green on a quiet box.
4. **Six-brand Welcome browser eyeball** (follow-up #2067) — read Welcome copy under all six front-end brands; no raw `{{brand.*}}` tokens *in the rendered portal UI* (API body intentionally carries tokens).
5. **EXTERNAL — owner action:** confirm **The Machine's own deploy** landed to pair with the 5-brand grant wiring now live on the BTS side. Outside this workspace's visibility.
6. ~~KB content item~~ ✅ **DONE Aug 5 (runtime, no deploy needed).** Staging doc 7 approved + pushed through the standard `push-approved` flow (it was the only approved row — exactly 1 pushed, live corpus 27 → 28). Live doc id 6373 carries `owner_page_key=seven-pillars`. Positive citation canary now PASSES: the FE-owner probe gets a grounded 7-Pillars answer with the `/core-training/7-pillars` portal link; zero-grant chat still 403; FE-owner Blitz probe still leaks nothing; blitz guide still 403 for non-owners.

## Retired: GrandfatherBackfill (Aug 5, 2026 — owner decision)

The grandfather backfill was **removed entirely without ever being armed**. Rationale (owner, pre-launch): all 25 current prod members are test or team accounts — there is nothing to grandfather — and every future member onboards through the normal tiered flow. Removed: the boot hook + every-boot pre-flight announcement (`bootstrap-critical-prerequisites.ts` step 14), `lib/grandfather-backfill.ts`, the CLI script + package scripts, the runbook, and its three test files. The `users.grandfathered` column and the onboarding-grant-repair logic that *respects* grandfathered rows remain untouched. The `grandfather_backfill_armed` setting was never set in prod; no marker exists; nothing was ever written.

---

## Post-publish canary (required — publish is not done without it)

### 7. No-product canary + owner citation check

With a **no-product prod account** (test account with zero grants), verify **403/denied** across the five gated endpoint families:

1. **Blitz APIs** — guide body endpoint (`/api/blitz/guide`), and course-progress reads/writes for Blitz including the **legacy course-progress IDs** (`21-day-blitz` and `blitz-hub-step-v2-*`).
2. **The curriculum page-body endpoints** — `/api/curriculum/seven-pillars`, `/quick-start`, `/pillars-to-blitz`, `/tips-and-tricks`, **and `/frontend-welcome`**. Also one FE-owner 200 check: an account holding a front-end product gets a 200 with substituted brand copy from `/api/curriculum/frontend-welcome`.
3. **`/api/affiliate-networks`** — 401 logged out, 403 `CONTENT_NOT_OWNED` for the no-product member.
4. **Gated course-progress writes** — POST/PATCH progress for any gated course family is rejected fail-closed.
5. **KB retrieval** — the assistant (`/api/chat`) returns **no gated docs** to the no-product account: ask a Blitz-specific and a seven-pillars-specific question; answers must not cite or quote the stamped docs, and prompts must not leak Blitz section names.

Then with an **owner** account (front-end product holder): verify the assistant **does** cite seven-pillars docs, and the Blitz owner sees Blitz docs.

Admin/coach bypass sanity: an admin account can still open all four pages and the affiliate-networks list.

### 8. Optional cleanup: re-file the nav-map doc

The pre-existing `kb-nav-grounding-determinism` test failure is caused by the real nav-map doc being filed as the wrong class. Re-file it (`doc_class` back to `overview`) via the admin review UI or a targeted staging-row update, then re-run the test to confirm it clears. Nav grounding intentionally orders `navigation > overview` — see `.agents/memory/kb-filed-placement-authoritative.md`.

---

## Sign-offs & known items (Welcome page, Aug 2026)

- **Routing predicate ratified by owner:** `vip` counts as a mentorship tier, so vip + front-end lands on **Home**; `machine` (and other non-mappable slugs like `ad-spend-funding`, `vip_arbitrage`) is invisible to the predicate, so machine + front-end lands on **Welcome**. Both confirmed intended.
- **Known cosmetic item (future email-copy pass):** ~18 email templates in `seed-templates.ts` link `{{portal_url}}/dashboard` with CTAs like "Go to Dashboard" / "Check Your Progress"; FE-only members clicking them now land on the Welcome letter. Behavior is correct; only the email wording is a mismatch for that cohort.

## Standing cautions (outlive this publish)

- **XSS-via-innerHTML on curriculum pages.** The four de-bundled pages render server-supplied HTML with `dangerouslySetInnerHTML`. This was judged acceptable **only** because the content is server-side constants (`api-server/src/lib/curriculum-content.ts`) with zero user or DB input. **If curriculum content ever becomes DB-stored or admin-editable, HTML sanitization becomes mandatory at that moment** — do not port the constants to a DB table without adding it.
- **Coaching-seed still mentions Direct Edge.** `artifacts/api-server/src/data/coaching-seed.json` contains three historical transcript summaries listing "Direct Edge" as an available training. The course no longer exists. **If that corpus is ever re-seeded or re-synthesized, scrub those references first**, or the AI pipeline will resurface a dead course to members.
