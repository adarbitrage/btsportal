---
name: Moderation pod-silent staleness threshold
description: The 2x-rolling-window staleness rule is duplicated in the frontend card and the on-call alerter; keep them in lockstep.
---

A moderation pod is judged "silent/stale" when it has **zero in-window failures**
but its most recent report (`lastAt`) is older than **2 × the configured rolling
window** (windowMinutes). This same rule lives in TWO places that must agree:

- Frontend card: `isPodStale` in `artifacts/portal/src/pages/admin/SystemHealth.tsx`
  (uses `health.serverTime` as "now").
- On-call alerter: `isPodSilent` in
  `artifacts/api-server/src/lib/moderation/failure-alerter.ts`
  (`evaluateModerationPodSilentAlert`).

**Why:** if the two formulas drift, the System Health page and the page-on-call
alert disagree about which pods are stale — an admin sees a red pod that never
paged, or gets paged for a pod the page shows as healthy. The 2× factor and the
`totalCount === 0 && lastAt && now - lastAt > 2*windowMs` condition were chosen
to mirror the dashboard exactly.

**How to apply:** any change to staleness math (the 2× factor, the totalCount
gate, or the windowMinutes source) must be made in BOTH functions in the same
change. Pod silence alerts fire/clear per-pod with a stable PagerDuty dedup key
`moderation-pod-silent:<instanceId>`; clear happens on resume (fresh lastAt /
in-window failure) OR when the pod's Redis key TTLs out (absent from the
aggregate). Throttle reuses `getNotificationThrottleMs()`
(MODERATION_FAILURE_NOTIFICATION_THROTTLE_MS), same as the failure alerter.
