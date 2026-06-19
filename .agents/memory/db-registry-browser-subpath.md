---
name: Sharing a pure constant from @workspace/db with browser code
description: How to import a registry/constant owned by @workspace/db into the portal without dragging in the server-only barrel.
---

# Sharing a pure constant from @workspace/db with the browser

The `@workspace/db` barrel (`lib/db/src/index.ts`) is **server-only**: importing it
instantiates a pg `Pool` and throws when `DATABASE_URL` is absent. So the portal
(browser) must never `import ... from "@workspace/db"` just to get a plain constant.

**Pattern:** add a side-effect-free **subpath export** in `lib/db/package.json`
(`"./entitlement-registry": "./src/entitlement-registry.ts"`) that points at the
pure source module (it only imports `zod`, no pool). Browser code then imports
`@workspace/db/entitlement-registry`. Also add `@workspace/db` as a portal
dependency AND a `tsconfig.json` project reference, then `pnpm install`.

**Why:** keeps a single package-owned source of truth (e.g. `ENTITLEMENT_KEYS`)
usable by both server and browser without forking the list, and without the
browser pulling in server-only side effects.

**How to apply:** any time the portal needs a constant/registry that lives in
`lib/db`, expose it via a dedicated pure module + subpath export — never widen the
barrel or duplicate the constant. Verify with a portal production build (Vite must
resolve the subpath) in addition to typecheck.

Server code that needs both `db` and the constant can still import them together
from the barrel: `import { db, ENTITLEMENT_KEYS } from "@workspace/db"` (the barrel
re-exports the registry). Easy to forget the named import after moving a local copy.
