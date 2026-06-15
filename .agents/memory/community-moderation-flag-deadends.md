---
name: Community moderation flags can be wired-but-dead
description: Admin toggle UI/route for a post flag can exist while the member feed never honors it, because the feed query doesn't select/order by it.
---

# Community moderation flags: admin toggle ≠ member effect

A post flag on `community_posts` (e.g. `is_pinned`, `is_featured`) can have a
fully wired admin path — a button in `CommunityModeration.tsx`, an
`adminApi` mutation, and a `PATCH /admin/community/posts/:id/<flag>` route in
`admin-community.ts` — and STILL do nothing visible to members.

**Why:** the member-facing feed is built by `listPosts()` / `getPostById()` in
`artifacts/api-server/src/storage/community.ts`. If those selects don't include
the flag (and the `orderBy` doesn't use it), the flag never reaches the client.
The frontend may already filter on it (e.g. CommunityFeed split pinned vs
regular), but it reads `undefined`, so nothing happens. Keyset pagination is
ordered by `createdAt`, so an OLD flagged post lands on a late page — a frontend
"filter the fetched pages" approach can never float it to the top. The fix must
be backend ordering: e.g. `isPinned DESC, createdAt DESC, id DESC`, with the
cursor extended to carry the flag so pagination stays correct.

**How to apply:** when a moderation toggle "doesn't work" for members, check the
feed storage selects/orderBy/cursor BEFORE the admin route. As of the pin fix,
`is_featured` is still a dead-end: admins can toggle Feature but no member
surface reads or orders by it.
