---
name: Your Purchases nav ownership
description: How the member sidebar "Your Purchases" folder derives its children from product grants.
---

The old Training folder / "7 Pillars" leaf became a "Your Purchases" folder whose leaves carry `ownedProductSlugs` and are filtered by `filterNavByOwnedProducts` (admin/coach bypass, empty folder vanishes).

**Decisions:**
- Labels + ownership sets are code-owned (`PURCHASE_OWNER_SLUGS` in sidebar-nav.ts), never free-text from the API.
- ALL mentorship-tier slugs count as owners of both entries ("Your Second Engine" → /core-training/pillars-to-blitz, "The Blitz™" → /blitz) so tier members keep today's visibility; front-end group slugs own the YSE entry, `yse_21_day_blitz` owns Blitz.
- Free/no-grant members now lose these nav entries (intentional — the folder lists what they bought); content-access + entitlement filters still stack on top.
- Front-end-only members still get the flattened nav (buildFrontendOnlyNav), so they see "Your Second Engine" as a flat leaf, not a dropdown — by design.

**Why:** the nav map label change ripples into the assistant link normalizer (canonical label per path) and the nav-map version hash → KB re-review; renaming a sidebar label means updating map + normalizer tests together.
