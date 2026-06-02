---
name: Moderation pod-silent staleness threshold
description: The 2x-rolling-window pod staleness rule is a single shared source (lib/moderation-shared) used by the dashboard card and the on-call alerter; pinned by api-server tests.
---

A moderation pod is judged "silent/stale" when it has **zero in-window failures**
but its most recent report (`lastAt`) is older than **2 × the configured rolling
window** (windowMinutes). The rule is now a **single source of truth** in
`lib/moderation-shared` (`isPodStale`, `staleThresholdMsForWindow`,
`STALE_WINDOW_MULTIPLIER`); both consumers import it, so it can no longer drift:

- Frontend card: `SystemHealth.tsx` calls shared `isPodStale` (uses
  `health.serverTime` as "now").
- On-call alerter: `isPodSilent` in `failure-alerter.ts` delegates to shared
  `isPodStale` (`evaluateModerationPodSilentAlert`).

**Why:** if the two formulas drift, the System Health page and the page-on-call
alert disagree about which pods are stale — an admin sees a red pod that never
paged, or gets paged for a pod the page shows as healthy. Collapsing to one
shared function makes drift impossible by construction.

**CI gate:** the validation `test` workflow only runs `@workspace/api-server`
tests (NOT lib or portal tests). So the contract is pinned in
`artifacts/api-server/src/__tests__/moderation-pod-staleness-rule.test.ts`
(imports the shared module, asserts the 2× factor + `totalCount===0` gate).
There's also a colocated `lib/moderation-shared/src/index.test.ts`, but that one
does NOT run in CI — keep the api-server copy as the real guard.

**How to apply:** change the staleness math in ONE place (`lib/moderation-shared`).
Pod silence alerts fire/clear per-pod with a stable PagerDuty dedup key
`moderation-pod-silent:<instanceId>`; clear happens on resume (fresh lastAt /
in-window failure) OR when the pod's Redis key TTLs out (absent from the
aggregate). Throttle reuses `getNotificationThrottleMs()`
(MODERATION_FAILURE_NOTIFICATION_THROTTLE_MS), same as the failure alerter.
