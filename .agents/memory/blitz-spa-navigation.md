---
name: Blitz SPA navigation (no plain anchors)
description: Why internal nav in the portal Blitz feature must use wouter <Link>, not plain <a>.
---

In `artifacts/portal`, internal navigation between in-app routes must use wouter `<Link>`, never a plain `<a href>`.

**Why:** The app runs inside Replit's proxied preview iframe and wouter is configured with `base={import.meta.env.BASE_URL.replace(/\/$/,"")}` (App.tsx). A plain `<a>` triggers a full document reload, which does not share the SPA pushState document/history. Mixing a full-reload navigation (hub CTA) with SPA pushState (section pager/header) corrupts the iframe back-stack: pressing Back lands on a stale entry that renders the full guide (`/blitzv2/guide`, where `useRoute("/blitzv2/guide/:lessonId")` fails to match -> isSectionView=false) instead of the previous section.

**How to apply:** For in-app links use `<Link href="/blitzv2/guide/N">` with a BASE-RELATIVE path (wouter prepends the base automatically). Do NOT build hrefs with `${import.meta.env.BASE_URL}...` for `<Link>` (that double-applies the base). Plain `<a>` is only for external URLs. `<Button asChild><Link>...</Link></Button>` is the established wrapper pattern. Note: v1 `BlitzHub.tsx` still uses the old plain-`<a>` pattern (untouched original).
