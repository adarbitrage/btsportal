---
name: Blitz v2 restyle — COMPLETED (promoted to canonical /blitz)
description: The restyled Blitz v2 has been promoted to the canonical /blitz; the old Blitz is archived admin-only at /blitz-archive. Record of how the switch landed.
---

# ✅ DONE: Blitz v2 promoted to canonical /blitz

The restyled Blitz v2 (formerly `/blitzv2`) is now the canonical **`/blitz`**. The original Blitz was retired to admin-only **`/blitz-archive`** (gated by `AdminRoute` + `permission="content:manage"`), fully separated. `/blitzv2` routes were removed.

## How it landed (decisions that future work must stay consistent with)
- **Progress prefix:** the live hub uses `blitz-hub-step-v2-<id>` (the ORIGINAL prefix) so existing member progress carried over. The archive hub was given an isolated `blitz-archive-hub-step-<id>` so the admin backup never shares progress with live.
  **Why:** continuity for real members; isolation so admins browsing the archive can't mutate live progress.
- **Archive is frozen & decoupled:** the archive lesson library reads a static JSON snapshot (`artifacts/portal/src/components/blitz/blitz-archive-lessons.json`, 94 lessons) via `LessonLibraryArchive.tsx` — no API calls. Live DB edits can never alter the backup. Regenerate intentionally only with `snapshot-blitz-archive-lessons.ts`.
- **Regenerator disabled:** `build-blitz-from-html.ts` is gated behind `ALLOW_BLITZ_REGEN` (hard-throws otherwise) because its OUT is the now-hand-maintained live `Blitz.tsx`. See `blitz-guide-generated.md`.
- **Temp review tools KEPT:** user chose to keep the in-guide video review-counter (`TEMP: REMOVE BEFORE GO-LIVE`) for now in both `Blitz.tsx` and `BlitzArchive.tsx`. Remove before go-live when the user says so.
- **Archive deletion:** user intends to delete `/blitz-archive` (and its files/JSON/routes) before launch.

## Known content-parity gap (open decision)
The live v2 guide has **no Lesson Library feature** — only the archive guide does. This was flagged to the user. If wanted on live, add it intentionally in `Blitz.tsx` (the live-API `components/blitz/LessonLibrary.tsx` still exists), not by re-enabling the regenerator.
