---
name: Retiring a content-access page key
description: Pattern for removing a member-facing page from the ownership-gating system so everyone is denied.
---

To retire a member page from the content-access system:
1. Remove the entry from the registry (`GATEABLE_PAGES`). The resolver filters by registry keys, so the key is never in anyone's accessible set — `requirePageAccess` and `ContentAccessRoute` then fail closed for members AND admins on that key (admin bypass returns only registry keys).
2. Add the key to `RETIRED_PAGE_KEYS` in the content-access-map boot seed so the stale DB row (which admin-edits-win ON CONFLICT DO NOTHING would otherwise preserve forever) is deleted at boot — this is also how the fix reaches prod.
3. Remove the sidebar leaf and the portal-nav-map entry (AI assistant nav knowledge) in the same change.
4. Keep the route + server endpoint in place — they now uniformly 403; admin management endpoints under /admin/* with `content:manage` are unaffected.

**Why:** a lingering map row is ignored by the resolver but confuses forensics and future re-registration; and the seed never overwrites existing rows, so only an explicit delete works.

**How to apply:** any future request to hide a gateable page from all members.
