---
name: Coach = full member access (per-gate bypass)
description: How coach (and admin) role gets full membership-feature access on the server without polluting product-derived entitlements.
---

Coaches (`users.role === "coach"`) and admins get the FULL member feature set
(entire membership menu + coaching menu) regardless of which products they own.

**Rule:** the bypass is enforced separately at EACH server access gate via the
shared helper `hasMemberAccessBypass(userId)` in `api-server/src/lib/entitlements.ts`
(returns `isAdminRole(role) || isCoachRole(role)`). It mirrors the frontend, which
already bypasses via `isAdminUser || isCoach` in `Sidebar.tsx`
(`filterNavByEntitlements(..., isAdminUser || isCoach)`) and `EntitlementRoute`
(`if (!isAdmin && !isCoach && !hasEntitlement)`).

**Why never fold it into `getUserEntitlements`:** entitlements are strictly
product-derived and feed tier/label/commission math (getHighestProductLabel,
support ticket tiers, commission tiers). Granting keys there would corrupt those
computations. Keep the gate bypass boolean-only at the call site.

**How to apply (gate-by-gate pattern):**
- Boolean OR at the lock check: `isAccessible = bypass || entitlements.has(key)`;
  `isLocked = !bypass && !entitlements.has(key)`.
- Tier features map bypass to the top sensible tier, NOT all keys:
  chat → `chat:full`; tickets → `ticketLimit = -1` (unlimited, relies on the
  existing `ticketLimit > 0` cap guard); tools → local `getToolEntitlements()`
  augments a COPY of the set with `software:base`+`software:expanded`.
- commissions → bypass in `requireCommissionAccess` (auto-creates affiliate
  profile for coaches; intended per "full membership").

**Already-bypassed before this work (don't re-fix):** `apps.ts`
(`requireActiveMember`) and `community.ts` (`getHasMemberBypass`) — both already
do admin||coach. `community.ts` still has its OWN local helper (not the shared
one) — harmless duplication, consolidate only if touching it anyway.

**Deliberately skipped:** `vault.ts` (Resource Library) — known-fragile
schema-drift `as any` casts (see api-server-schema-drift-casts) AND it's ungated
in the menu, so coaches already see it.

**Auth middleware does NOT attach role** (cookie path sets only userId/userEmail);
each gate does its own role lookup via the helper — chosen over modifying global
middleware to keep blast radius small.

**Deploy:** all of this is server-side enforcement; prod needs a republish to
take effect (frontend bypass was already present).
