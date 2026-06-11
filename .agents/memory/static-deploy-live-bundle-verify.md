---
name: Verify a static deploy is serving current source
description: How to prove (or disprove) that the live static portal is running the latest code before chasing a phantom code bug.
---

# "I published the fix but it's still broken" — prove what's actually live first

When a user reports a published fix didn't take effect (especially on the **static** portal artifact: `serve = "static"`, Vite SPA), do NOT assume a code bug and start rewriting. Prove whether the live bundle already contains the fix:

1. **Deployment health** — `getDeploymentInfo()`: confirm `isDeployed` and especially `hasSuccessfulBuild: true`. A failed/in-flight build means prod still serves the previous bundle.
2. **Timeline** — compare the fix commit time (`git log --format=%cI`) and the publish-commit time against the live asset's `last-modified` header (`curl -sSI <prod-url>/`). If the publish/last-modified is *after* the fix commit, the fix shipped.
3. **Byte-identical proof (gold standard)** — the live `index.html` references a content-hashed bundle like `/assets/index-XXXX.js`. Rebuild locally (`pnpm --filter @workspace/portal run build`) and compare the produced hash to the live one. **Identical hash = the deployed JS is byte-for-byte the current source.** Vite hashes by content, so this is definitive.

If all three say the fix is live, the remaining cause is **client-side cache**, not code. Resolution is on the user's device: incognito window / different device (bypasses all cache) to confirm, then hard refresh or clear site data on the normal browser.

**Why:** A super_admin "missing nav items" report was chased as a logic/wiring bug across multiple sessions; the code and three bypass layers were correct the whole time. The hash-match check ended the loop instantly by proving prod served the fixed bundle.

**How to apply:** Run this 3-step check *before* touching code on any "published-but-still-broken" report for a static SPA deploy. Note: portal frontend and api-server deploy as separate artifact services (portal = static `dist/public`; api-server = node process); the api-server does NOT serve the portal build.
