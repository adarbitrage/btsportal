---
name: Community post approval gate (trust-based auto-approval)
description: When community posts are created active vs pending, and what "good standing" means
---

Community posts use publish-then-moderate for trusted authors and an approval
gate for everyone else. On `POST /community/posts` the initial status is:
- `active` if the author is an admin OR "in good standing"
- `pending` otherwise (visible only to the author + admins; author sees a
  "pending review" indicator in `PostCard`)

**Good standing** = author has >= `GOOD_STANDING_MIN_APPROVED_POSTS` (currently 1)
previously `active` posts. It intentionally does NOT look at moderation history
(shadow_hidden/hidden counts).

**Why:** abuse is already covered by two other layers — `requireNotBanned`
middleware blocks banned members from posting at all, and the async moderation
engine shadow-hides flagged content regardless of standing. Tying standing to a
current shadow_hidden count would permanently demote an established member over
a single (often false-positive wordlist) flag and force every future post back
through manual admin review — the exact friction the gate is meant to remove.

**How to apply:** a brand-new member's first post is held `pending` until an
admin approves it (which makes it `active`); from then on they are trusted and
posts auto-publish. Members who already had `active` posts from the old
publish-then-moderate era are trusted immediately (smooth migration).

**Test gotcha:** because create only returns `active` for trusted authors,
DB-backed tests asserting `status:"active"` on create must first seed the
posting author a prior `active` post (otherwise they're a "new member").
