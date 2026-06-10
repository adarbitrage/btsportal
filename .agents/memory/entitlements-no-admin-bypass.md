---
name: entitlements have no admin bypass (3 gating layers)
description: Why admin/super_admin staff with no purchased products lose member features, and the three independent layers that each need their own admin bypass.
---

Entitlements are derived ONLY from purchased products (`user_products` → `products.entitlement_keys`, via `getUserEntitlements` in api-server). There is NO role-based grant: an admin/super_admin with `source_product=NULL` and no `user_products` has an EMPTY entitlement set, exactly like a free member.

Member features are gated by entitlement in THREE independent layers — fixing one is not enough, each needs its own admin bypass:
1. **Sidebar visibility** — `filterNavByEntitlements` (sidebar-nav.ts). Pass `bypassEntitlements = isAdminUser`.
2. **Client route guard** — `EntitlementRoute` (App.tsx). Most member pages use plain `ProtectedRoute` and are NOT route-gated; only `/coaching/one-on-one` and the `/community/members*` sub-routes use `EntitlementRoute`. Bypass with `isAdminRole(user?.role) || isAdminRole(member?.role)`.
3. **Server-side guards** — these actually 403 the data even if the page loads: `requireCommunityAccess` (community.ts, ~17 call sites) and `requireActiveMember` (apps.ts). Bypass via the role lookup (`getIsAdmin` / `isAdminRole`). Without this, the nav item shows but the page is broken (403 on every call).

**Why:** the fix for "admin can't see/use member nav" is cross-cutting; a nav-only fix leaves a visible link that 403s. Keep the bypass keyed on the `isAdminUser`/`isAdminRole` staff boundary (all admin roles), NOT super_admin only.

**Do NOT** "fix" this by granting admins entitlements in `getUserEntitlements` — that resolver also feeds tier label (`getHighestProductLabel` → "Lifetime"), support ticket limits, edit windows, and commission logic, so it would mislabel/over-grant admins everywhere. Keep entitlements product-truth; add admin bypasses at the consumer layers instead.

**Still graceful, not bypassed:** `/coaching/one-on-one` status returns `eligible:false` for zero-entitlement admins (shows an ineligible state, not a crash) — left as-is intentionally; revisit only if staff need to actually book.
