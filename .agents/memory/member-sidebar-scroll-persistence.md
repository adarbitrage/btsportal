---
name: Member sidebar scroll persistence
description: How the member (AppLayout) sidebar persists/resets its scroll offset, and the key behavioral nuance vs the admin layout.
---

# Member sidebar scroll persistence

The member sidebar (`Sidebar.tsx` `SidebarContent`) persists its scroll offset in
sessionStorage under `sidebar-scroll-top` (distinct from the admin layout's
`admin-sidebar-scroll-top`).

**"Back to Portal" does NOT leave the key null.** `collapseAdminFolder` removes the
key then sets `scrollTop = 0`. Because the in-place collapse keeps the sidebar
mounted, that programmatic reset fires a native scroll the save listener catches
and **re-writes `"0"`**. So after Back-to-Portal the persisted value is `"0"` (or
briefly null), never the old offset — functionally "return starts at top" either
way. This differs from the admin layout, whose Back-to-Portal navigates away and
unmounts, so its key genuinely stays removed.

**Why it matters:** when testing or "fixing" this, assert the functional guarantee
(resets to top: `null` or `"0"`, survives reload), not `toBeNull()`. To truly clear
the key you'd have to suppress the save listener during the reset (see follow-up).

**E2E note:** the login limiter is 20/IP/15min (`auth.ts`); repeated manual e2e
runs plus a reused long-lived API server (`reuseExistingServer: true`) accumulate
logins and 429 the login — start fresh servers to reset.
