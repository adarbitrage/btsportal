---
name: Supported affiliate networks (MaxWeb/Affiliati removed)
description: Only Media Mavens & ClickBank are supported; why a maxweb label still lingers in dead code.
---

# Supported affiliate networks

Only **Media Mavens** (`media-mavens`) and **ClickBank** (`clickbank`) are supported across the BTS Member Portal. **MaxWeb** (`maxweb`) and **Affiliati** (`affiliati`) were removed by design from all live, member-facing surfaces (Blitz guide, BlitzHub, AffiliateNetworks, Advantage, seed data, DB rows) AND from the admin-only archive (`BlitzArchive.tsx`, `BlitzHubArchive.tsx`, `LessonLibraryArchive.tsx`) — user explicitly approved lifting the don't-touch-archive rule for network removal so the archive mirrors live.

**Why:** product decision to stop training/promoting those two named networks. The generic word "affiliate" stays (affiliate links, "Affiliate Networks" page title, commissions, affiliate arbitrage) — only the two NAMED networks were removed.

**How to apply:**
- Keep seed sources (`seed.ts`, `lib/seed-affiliate-networks.ts`) to those two slugs only.
- DB rows for `affiliati`/`maxweb` were deleted directly in dev; forward migration `0041_remove_maxweb_affiliati_networks.sql` handles prod (idempotent DELETE, apply via Replit Database pane). The historical applied migration `0007_affiliate_networks.sql` is left untouched (don't edit applied migrations).
- A `maxweb` label intentionally remains in `components/blitz/LessonLibrary.tsx` — that file is DEAD CODE (not imported anywhere; archive uses `LessonLibraryArchive`). It is left as-is to honor the standing "don't touch / don't re-add Lesson Library" rule. Do NOT "fix" this — it never renders.
- The archive's `LessonLibraryArchive.tsx` `NETWORK_LABEL` map had its `maxweb` entry removed (safe: `blitz-archive-lessons.json` only uses networkPath `clickbank`/`media-mavens`/`universal`). The archive's `tag-*` system uses only `mm`/`cb`/`cat`/`all` now.
