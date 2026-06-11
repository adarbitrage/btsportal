---
name: Portal app intro videos pipeline
description: Where the 7 app intro videos/posters live and the required web-optimized encode profile.
---

The 7 app intro videos live at `artifacts/portal/public/videos/<slug>.mp4` with posters
at `artifacts/portal/public/video-posters/<slug>.jpg`. Slugs: flexy, diytrax, metricmover,
pixelpress, gifster, scrapebot, cropbot. They are wired in `Apps.tsx` via
`overviewVideoUrl`/`overviewVideoPoster` (played by VidalyticsDialog as a plain `<video>`).

**Encode profile (keep consistent):** H.264, 1280x720, 60fps, CRF ~23, AAC 128k,
`-movflags +faststart`. This yields ~10–20 MB per clip.

**Why:** source/rebrand exports arrive as HEVC 1080p60 at ~15 Mbps (200–275 MB each) —
far too heavy to commit or stream. Always transcode down before replacing; never ship
the raw exports. `artifacts/portal/dist` is gitignored (rebuilt on deploy), so only the
`public/` source assets need updating.

**Drive-folder download trick (no API):** fetch the public folder HTML; file IDs appear
as 28–44 char tokens; filenames are embedded with escaped quotes (`\x22Name\x22`) inside
each file's record, so match name→id by scanning a ~4 KB window after each id. Download a
large file via the usercontent endpoint, following the virus-scan confirm form.
