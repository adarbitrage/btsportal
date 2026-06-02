---
name: /videoreview temp admin page
description: Temporary admin-only Blitz video review tracker; how it auto-filters and when/how to tear it down.
---

# /videoreview — temporary admin-only video tracker

`/videoreview` (portal `VideoReview.tsx`, route guarded by `AdminRoute` with
`content:manage`) is a TEMPORARY page that lists Blitz videos still needing
work: status **unreviewed** (no `data-status` attr) and **re-record**
(`data-status="needs-rerecord"`). Titles are click-to-play via the same
Vidalytics embed as the live Blitz lightbox.

## How removal works (user's standing instruction)
The page parses `blitzBodyHTML` (exported from `Blitz.tsx`) live and includes
only unreviewed + needs-rerecord slots. So to remove a video from
`/videoreview` after its replacement is uploaded, set that `.video-slot`'s
`data-status="ready"` in `Blitz.tsx` — it then drops off the list
automatically. No edit to `VideoReview.tsx` is needed for per-video removal.

**Why:** user asked (June 2026) that as new videos replace the unreviewed /
re-record ones and are marked ready, they be removed from `/videoreview`.
Marking ready === removing from the tracker.

## Full teardown (do when ALL videos are done)
Once nothing is unreviewed/needs-rerecord anymore, the user wants the whole
temporary apparatus deleted together:
- The `/videoreview` page: `VideoReview.tsx` + its route in `App.tsx` (and the
  now-unused `export` on `blitzBodyHTML` if nothing else consumes it).
- The Blitz video **status counter** (the `#vd-review-counter` useEffect block
  in `Blitz.tsx`, marked "REMOVE BEFORE GO-LIVE").
- The per-card status **tags**: all `data-status="..."` attrs on `.video-slot`
  elements plus the status badge CSS (the `.video-slot[data-status=...]::after`
  rules).
