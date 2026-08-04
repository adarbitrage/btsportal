---
name: Content-access ownership gating
description: How ownership-gated nav + Blitz server enforcement works — funnel product group, boot-seeded map defaults, fail-closed middleware semantics.
---

- Registry `MAPPABLE_PRODUCTS` now has a third group `"funnel"` (the 4 YSE upsells incl. `yse_21_day_blitz`). Funnel columns are plain checkboxes in the admin matrix — they do NOT participate in mentorship copy-upward propagation. The admin UI (`ContentAccessMap.tsx`) and `admin-panel-api.ts` `ContentAccessProduct.group` union must stay in lockstep with the registry union.
- `content_access_map` defaults are boot-seeded (`seed-content-access-map.ts`, wired in app.ts) with INSERT … ON CONFLICT (page_key) DO NOTHING — **admin edits always win; never convert this to an upsert**. Policy: `blitz` → yse_21_day_blitz + 5 tiers; `partner-tools`/`prime-corporate`/`ad-credit`/`become-a-coach` → 5 mentorship tiers only (LaunchPad+, per owner decision 2026-08-04); everything else → 6 front-ends + 5 tiers. `vip` deliberately excluded everywhere.
- **Why fail-closed middleware double-checks the row**: `getAccessiblePageKeys` treats a missing map row as OPEN (nav launch semantics). `requirePageAccess` (used by all Blitz APIs) therefore also verifies the row EXISTS and denies members when it doesn't (admins/coaches pass) — otherwise a failed/late boot seed silently opens gated content.
- Nav-stricter-than-route is deliberate for pitch items (Private Coaching / Accountability Partner / Concierge hidden behind `coaching:group`; pages stay reachable by direct link and pitch). Such cases must be declared in `NAV_ONLY_GATING` in `member-nav-vs-route-gating.test.ts` or the drift guard fails.
- Adding a new GATEABLE_PAGES key ⇒ also decide its default slugs in `defaultSlugsForPageKey` and rebuild the registry dist (`tsc -b lib/content-access-registry --force`).
