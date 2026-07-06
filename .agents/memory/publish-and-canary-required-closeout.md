---
name: Publish + canary is a required close-out for member-visible tasks
description: Standing directive — any task changing member-visible behavior is not done until it is published to production AND the served bundle is canary-verified, by default, without being asked.
---

# Publish + canary close-out (standing directive)

Any task that changes member-visible behavior (portal UI, member-facing API responses, emails/SMS members receive, anything a member can see or experience) is **not complete** until BOTH of the following happen:

1. **Published** — the change is deployed to production via the normal publish flow.
2. **Canary-verified** — the actually-served production bundle/response is checked to contain the change, not just "the deploy succeeded."

This applies **by default**, without the user needing to ask for it. A task that only merges the code (dev-only) but skips publish+canary is incomplete, even if all its acceptance criteria otherwise pass. Task #1696 slipped through this way (merged, never published or verified) — that gap is the reason this directive exists.

## Canary technique
Don't restate the recipe here — see [Verify a static deploy is serving current source](static-deploy-live-bundle-verify.md) for the concrete steps. Summary of the two tiers:
- **Fast canary:** content-hashed asset grep for a changed string/identifier introduced by the fix (`curl` the live hashed JS, `grep` for old vs new token).
- **Gold-standard canary:** rebuild locally and match the Vite content-hash of the live bundle byte-for-byte.

## How to apply
When planning or writing "Done looks like" for any task that touches member-visible behavior, include an explicit final step: "Publish to production" + "Canary-verify the served bundle/response reflects the change" (using the technique above). Treat this as a standard, expected part of the completion bar, not an optional extra — do not wait for the user to request it.
