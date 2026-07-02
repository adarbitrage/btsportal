---
name: Partner staff role pattern
description: How the "partner" staff role mirrors "coach" but deliberately withholds member entitlements
---

The `partner` role (accountability partners) mirrors the `coach` role end-to-end (role constant, `partners:view`/`partners:manage` permissions, `PartnerRoute`, sidebar section, `/partner` placeholder route, onboarding-bypass checks) EXCEPT it must never receive coach's member-content-access bypass.

**Why:** task requirement — partner content access must stay 100% product-derived, unlike coach which bypasses per-gate entitlement checks for member-facing content.

**How to apply:** when extending partner surfaces, do NOT touch `entitlements.ts` (`hasMemberAccessBypass`), `content-access-resolver.ts`, `apps.ts`, or `community.ts` coach-bypass branches for the partner role. Those files intentionally check `isCoachRole` only. If a future task wants partners to see some member content, that must be a new, explicit, separately-approved decision — not an accidental copy-paste of the coach bypass.
