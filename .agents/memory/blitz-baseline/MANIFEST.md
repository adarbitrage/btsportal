# Blitz content baseline — FROZEN SNAPSHOT

**Frozen on:** 2026-05-30 · **Baseline commit:** `b5657da66bd18a44a147ba7750438ccd0a794bdf`

## Why this exists
We are building a restyled **Blitz v2** (`/blitzv2`) as a duplicate while the original `/blitz` stays live and may keep receiving **content** edits (copy, lessons, linked videos). These frozen copies let us detect EXACTLY what content changed in the original after the fork, so every change is ported into v2 before we promote v2 to `/blitz`.

## Frozen files (original path → snapshot copy)
| Original path | Snapshot | Role |
|---|---|---|
| `artifacts/portal/src/pages/Blitz.tsx` | `Blitz.tsx` | Guide page (GENERATED). Content + linked videos live in the injected HTML. |
| `artifacts/portal/src/pages/BlitzHub.tsx` | `BlitzHub.tsx` | Hub page. `LESSONS` array = hub lesson titles/desc/links. |
| `artifacts/portal/src/components/blitz/LessonLibrary.tsx` | `LessonLibrary.tsx` | Library UI (content comes from backend, not here). |
| `artifacts/portal/src/lib/blitz-api.ts` | `blitz-api.ts` | API client for library. |
| `attached_assets/blitz_main_caterpillar_110_1778523623764.html` | same name | GUIDE SOURCE. Generator input. Real source of guide content/videos. |
| `artifacts/api-server/src/scripts/build-blitz-from-html.ts` | `build-blitz-from-html.ts` | Generator (SRC=_110_ html → OUT=Blitz.tsx). |
| `artifacts/api-server/src/data/blitz-seed.json` | `blitz-seed.json` | Lesson Library content (DB seed). SHARED backend — v2 auto-syncs, no porting needed; frozen for reference only. |

## How to detect + port content changes (do this before promoting v2)
1. Diff each live original against its snapshot, e.g.:
   - `diff .agents/memory/blitz-baseline/Blitz.tsx artifacts/portal/src/pages/Blitz.tsx`
   - `diff .agents/memory/blitz-baseline/BlitzHub.tsx artifacts/portal/src/pages/BlitzHub.tsx`
   - `diff .agents/memory/blitz-baseline/blitz_main_caterpillar_110_1778523623764.html attached_assets/blitz_main_caterpillar_110_1778523623764.html`
   (or `git diff b5657da6 -- <path>`)
2. For the **guide**: content changes normally arrive via the SOURCE HTML (`_110_`) + regenerate. So a diff of the source HTML shows true content changes; ignore the regenerated styling churn in `Blitz.tsx`.
3. Port every non-styling change (copy, lessons, video IDs/links, anchors) into the v2 files. Do NOT port the old styling.
4. **Lesson Library** content needs no porting — both versions read the same backend.

## After promotion (v2 becomes /blitz)
- Move v2's final guide stylesheet into the GENERATOR (`build-blitz-from-html.ts`), or the next regen reverts the styling.
- Re-freeze a new baseline and update `../blitz-v2-tracking.md`.
