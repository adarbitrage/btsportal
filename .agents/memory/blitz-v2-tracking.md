---
name: Blitz v2 restyle — in progress (content tracking)
description: ACTIVE PROJECT. A restyled /blitzv2 is being built as a duplicate of /blitz. How to keep its content in sync with the still-live original and how to promote it.
---

# ⚠ ACTIVE: Blitz v2 restyle in progress

**Initiated by user `sasha206`.** This is a deliberate, coordinated process — not stray scratch work. If you are another agent/contributor: do not delete `/blitzv2`, the `blitz-baseline/` snapshot, or this file, and do not promote/remove either Blitz version without coordinating with sasha206. A human-readable version of this notice is in `replit.md` under "Active Process: Blitz v2 Restyle".

We are building **`/blitzv2`** — a visually restyled (site-style: AppLayout/Card, Inter/Roboto, 7-Pillars tints) duplicate of the Blitz feature. The original **`/blitz` stays live and untouched** so the two can be compared side-by-side, then `/blitzv2` is promoted to `/blitz` and the old one deleted.

**This is purely a restyle — ALL functionality must stay identical** (deep-links, Media-Mavens-vs-ClickBank path switching, video lightbox, lesson library, progress tracking).

## Decisions locked in
- **Hub hero:** replace the navy branded hero with a standard simple icon+title header (branded version archived in `blitz-branded-design.md`).
- **Phase colors:** keep Build/Test/Scale color-coding, adapted to 7-Pillars-style tints.
- **Guide:** FULL restyle via the scoped stylesheet only (re-skin callouts/tables/badges); do NOT change the generated HTML markup or logic.
- **Fonts:** switch to site fonts (Inter/Roboto) everywhere; original display fonts archived in `blitz-branded-design.md`.
- **Progress:** v2 uses a SEPARATE progress key prefix while testing (NOT `blitz-hub-step-v2-`). ⚠ Consequence: progress will NOT carry over at promotion unless we switch v2 back to the original prefix `blitz-hub-step-v2-` at promotion time. Remember to flip it.
- **No temporary sidebar link** to v2 (navigate by typing `/blitzv2`).

## Content baseline (bulletproof)
Frozen snapshot of all content-bearing files at fork time lives in `blitz-baseline/` with a `MANIFEST.md`. Baseline commit `b5657da6` (2026-05-30). Before promoting, diff live originals vs the snapshot and port every content change (copy/lessons/videos) into v2. See the manifest for exact diff commands.

## Switchover plan (low-risk)
All portal links target the PATH `/blitz`, not component names (`Sidebar.tsx`, `Home.tsx`, App routes, in-guide deep-links). So promotion = repoint the 3 `/blitz` routes in `App.tsx` to the v2 components, port any content drift, flip the progress prefix back to `blitz-hub-step-v2-`, move final guide CSS into the generator, delete old files. v2's own internal links are driven by a single base-path constant (`/blitzv2`) → change to `/blitz`.

## Shared things NOT duplicated (auto-synced)
Backend `/api/blitz/lessons` + `blitz-seed.json` (Lesson Library content), progress storage. `LessonLibrary` component IS duplicated (shared import) so v2 can restyle it without touching the original.
