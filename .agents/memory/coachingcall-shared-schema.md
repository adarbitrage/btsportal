---
name: Shared CoachingCall response schema
description: CoachingCall zod schema is shared across dashboard + coaching routes; required-field changes ripple to all of them.
---
The `CoachingCall` schema in `lib/api-spec/openapi.yaml` (regenerated into `@workspace/api-zod` as the item type of `ListCoachingCallsResponse`) is the SHARED response shape for:
- `GET /dashboard` → `upcomingCalls`
- `GET /coaching-calls`

**Why:** Adding a *required* property to that schema and only populating it in one route makes the other route's `ListCoachingCallsResponse.parse(...)` throw at runtime (HTTP 500 on every item) even though typecheck passes — the parse failure presents as "expected 500 to be 200" in tests, easily misread as unrelated DB drift.

**How to apply:** When changing the `CoachingCall` contract, update BOTH `routes/dashboard.ts` and `routes/coaching.ts` mappers in lockstep (or make the field optional). Call-level upgrade logic (entitlement→plan deep-link) is single-sourced in `artifacts/api-server/src/lib/coaching-upgrade.ts` (`CALL_ENTITLEMENT_TO_PLAN`, `getCallUpgradeUrl`) so both routes stay consistent — extend the map there, not inline.
