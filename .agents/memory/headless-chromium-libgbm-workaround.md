---
name: Headless chromium missing libgbm in this environment
description: Playwright's own downloaded chromium/chromium_headless_shell binary fails to launch here with a missing libgbm.so.1 error; use the nix-provided system chromium instead.
---

Running `@playwright/test`'s `chromium.launch()` with its bundled/downloaded browser fails with:

```
error while loading shared libraries: libgbm.so.1: cannot open shared object file: No such file or directory
```

**Why:** the Playwright-downloaded chromium build expects a system `libgbm` that isn't present in this container image, even when `@replit/vite-plugin-...`-style nix deps already include `pkgs.mesa` and `pkgs.chromium` for other purposes (e.g. screenshot tooling).

**How to apply:** when you need to drive a real browser from a script (e.g. Playwright login + screenshot flows outside the built-in `screenshot` tool), locate the nix-provided chromium binary with `which chromium` and launch with:

```js
await chromium.launch({ executablePath: '<path from which chromium>', args: ['--no-sandbox'] });
```

This sidesteps the missing-library issue entirely. Also note: the workspace dependency is `@playwright/test`, not the bare `playwright` package — `require('playwright')` will fail with `MODULE_NOT_FOUND` even though Playwright is installed.
