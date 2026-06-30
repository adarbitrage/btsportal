---
name: Blitz caption dynamic cross-lesson linking
description: How captioned-video uploads derive their Blitz lesson links live from guide content, keyed by a clean Vidalytics id.
---

Blitz caption uploads (Transcript Cleaner) link to EVERY Blitz lesson the video
appears in, derived LIVE from the guide — adapts automatically when content,
videos, or ids change. Explicit user requirement: never freeze the lesson list.

**Single source of truth:** the Blitz body HTML lives in
`lib/blitz-curriculum/src/blitz-body-html.ts` (`BLITZ_BODY_HTML`); `Blitz.tsx`
re-exports it as `blitzBodyHTML`. A regex parser
(`lib/blitz-curriculum/src/blitz-video-map.ts`) builds a memoized
video-id→lessons map from it: a slot's lesson = the numeric prefix of the
preceding `mod-badge` span; the id = `data-vidalytics-id`.
`getBlitzLessonsForVideo(id)` / `getKnownVidalyticsIds()` are the public API.

**Why store only the clean id (not the lesson list) on the doc:** the lessons
are derived on demand so they stay live. The provenance note IS a snapshot at
intake (acceptable) but the structured `vidalytics_id` column is the durable key.

**Safety net (`sanitizeVidalyticsId`):** filenames get mangled (spaces→underscores,
appended upload timestamp `__id_<ms>`, parentheticals, trailing junk). Reconcile
the captured token against the known-id set: exact → space-normalized → longest
known id that is a prefix → else leading `[A-Za-z0-9_]` run. So a dirty filename
still resolves to the exact clean id whenever the real id is in the guide.

**How to apply:** when adding new Blitz videos, nothing extra is needed — the map
re-derives. If you ever re-enable the disabled `build-blitz-from-html.ts`
generator (gated by `ALLOW_BLITZ_REGEN`), note it would clobber the hand-edited
guide; keep the HTML as the single source.
