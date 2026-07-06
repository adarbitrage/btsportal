---
name: Publish + canary is a required close-out for member-visible tasks
description: Standing directive — any task changing member-visible behavior is not done until it is published to production AND the served bundle is canary-verified, by default, without being asked. Responsibility is SPLIT between task agents (canary spec only) and the main/merge flow (publish + run canaries).
---

# Publish + canary close-out (standing directive) — split responsibility

Any task that changes member-visible behavior (portal UI, member-facing API responses, emails/SMS members receive, anything a member can see or experience) is **not complete overall** until BOTH of the following happen:

1. **Published** — the change is deployed to production via the normal publish flow.
2. **Canary-verified** — the actually-served production bundle/response is checked to contain the change, not just "the deploy succeeded."

**Responsibility is split — this is the amendment (superseding the original single-actor wording):**

- **Isolated task agents cannot publish.** There is no Publish button in a task agent and `suggestDeploy()` no-ops there. A task agent's job is to merge correct code AND hand off a **canary spec** in its completion report: the exact strings/greps/screens that would prove the change is live on the served bundle (e.g. `served bundle contains "Meet Your Accountability Partner"`). Task agents must NOT claim "published" or attempt to publish.
- **The main agent / merge flow publishes.** After merging any member-visible task branch(es), the main agent triggers a production publish and runs ALL accumulated canary specs (from every merged-but-not-yet-canaried task) against the served bundle, reporting PASS/FAIL per item. Batching several merged tasks into ONE publish is fine and expected — one publish, all pending canaries verified together.
- This split exists because the original single-actor wording caused two failure modes: a member-visible change shipped merged-but-never-published (nobody's job to publish it), and separately, a task explicitly scoped to "publish + verify" got stuck because a task agent literally cannot publish, while another task deviated trying to work around the same wall.

## Canary technique
Don't restate the recipe here — see [Verify a static deploy is serving current source](static-deploy-live-bundle-verify.md) for the concrete steps. Summary of the two tiers:
- **Fast canary:** content-hashed asset grep for a changed string/identifier introduced by the fix (`curl` the live hashed JS, `grep` for old vs new token).
- **Gold-standard canary:** rebuild locally and match the Vite content-hash of the live bundle byte-for-byte.
- For assets served unhashed from `public/` (e.g. images), a hash-match/grep is not enough — verify via rendered live screenshots plus a cache-header / returning-visitor check, since a stale immutable cache can serve old assets even after a correct publish.

## How to apply
- **Task-agent plans:** a member-visible task's "Done looks like" should include "emit a canary spec in the completion report" — NOT "publish to production" or "canary-verify the served bundle." The task agent is done when code is merged and the canary spec is written down.
- **Main agent / merge flow:** after merging member-visible branch(es), publish and run every accumulated canary spec against the served bundle before considering the batch closed out. Treat this as a standard, expected part of the completion bar, not an optional extra — do not wait for the user to request it.
