---
name: Admin panel has its own separate sidebar/layout
description: /admin/* pages render AdminLayout (own sidebar), NOT AppLayout/Sidebar.tsx — they don't share nav/scroll/persistence code.
---

# Admin panel uses a separate layout from member pages

`/admin/*` pages each wrap themselves in `AdminLayout` (`src/components/layout/AdminLayout.tsx`), which has its **own** sidebar (the "ADMIN PANEL / Support Management" column with a static `adminNav` array — no permission filtering, no shared nav). Member pages use `AppLayout` -> `Sidebar.tsx`. The two sidebars share NO code.

**Why this matters:** any "sidebar" behavior request can target either of two completely different components. The member `Sidebar.tsx` is the long, permission-filtered tree with the inline admin *folder*; `AdminLayout` is the dedicated admin area. A clue: "Back to Portal" is an AdminLayout concept (its link -> `/`).

**Both layouts remount per navigation** — wouter `<Switch>` swaps the page component and each page re-wraps its own layout. So cross-nav state (like scroll offset) must persist via sessionStorage, not rely on a kept-mounted component.

## Independent sidebar scroll requires `h-screen`, not `min-h-screen`
For the `flex-1 overflow-y-auto` nav container to actually scroll on its own, the `aside` must be height-bounded (`h-screen`). With `min-h-screen` the aside grows to fit content and the inner `overflow-y-auto` never engages — the whole page scrolls (sidebar is `sticky top-0`) and every nav resets it to the top. The member `Sidebar.tsx` desktop aside is `h-screen` (works); AdminLayout was `min-h-screen` (broken) until fixed.

**How to apply:** when adding/locking sidebar scroll persistence, confirm WHICH layout the user sees, ensure the aside is `h-screen`, then persist scrollTop to sessionStorage (save on scroll, restore in useLayoutEffect on mount, clear on "Back to Portal"). E2E must force overflow with a short viewport (e.g. 1280x500) since the static admin nav fits a normal-height screen.
