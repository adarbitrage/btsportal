---
name: Community reaction normalizer lockstep
description: client post/comment normalizers must both map viewerHasReacted->hasReacted, plus a Playwright data-attr gotcha
---

# Community reaction "reacted" state normalization

The community API returns the viewer's reacted flag as `viewerHasReacted` (for
posts, feed posts, and comments). The portal client UI reads `hasReacted`. The
mapping happens in the client normalizers (`artifacts/portal/src/lib/community-api.ts`).

**Rule:** `normalizePost` and `normalizeComment` must BOTH map
`hasReacted ?? viewerHasReacted ?? false` (and `reactionCount`). They are
separate functions and drift easily.

**Why:** `normalizePost` previously only did `...p` and never mapped
`viewerHasReacted`, while `normalizeComment` mapped it correctly. Result: after
optimistically liking a POST, the `onSettled` refetch returned `viewerHasReacted`
which the normalizer dropped, so the reacted highlight silently reverted to
un-reacted on both the detail page and the feed. The count still updated (it's a
separate spread field), so it was easy to miss.

**How to apply:** any new community endpoint/normalizer that surfaces a viewer
reaction must map `viewerHasReacted -> hasReacted`. Guarded by the E2E spec
`artifacts/portal/tests/e2e/community-reactions.spec.ts`.

## Playwright gotcha: boolean-false data attributes
React omits a `data-*` attribute entirely when its value is boolean `false`, so
`toHaveAttribute("data-reacted", "false")` fails (attribute is absent → null).
Stringify it in the component: `data-reacted={hasReacted ? "true" : "false"}`.
