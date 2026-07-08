---
name: KB navigation grounding
description: How truth-doc synthesis is grounded in the live portal nav map (shared lib, screen, versioning, drift scan, drift guard)
---

- Portal nav map is a shared lib `@workspace/portal-nav-map` (member routes ONLY; `isStaffRoutePath` rejects /admin,/coach,/partner but must not false-match /coaching,/partner-tools). It renders into the synthesis consolidate prompt AND the seeded Operations navigation doc.
- **Two-way drift guard** in portal tests: MEMBER_NAV leaves (minus `requiredPermission`-gated ones like /dm) ⊆ map paths, and map paths ⊆ sidebar ∪ `NAV_MAP_ONLY_PATHS` (currently just /support). Adding a sidebar page WITHOUT updating the nav map fails the portal test gate — that's intentional.
- Legacy-location handling: crosswalk `kind:"location"` entries drive both the prompt rules and a deterministic post-draft screen (`applyNavigationScreen`) that appends `> ⚠️ NAVIGATION CONFLICT (for reviewer):` blockquotes. Marker mirrored as `NAV_CONFLICT_PREFIX` in kb-review-risk with a lockstep test (same pattern as SOURCE CONFLICT).
- Screen is idempotent: skips lines already containing the marker AND phrases already flagged in the body.
- **Versioning/drift**: `computeNavMapVersion()` (FNV-1a content hash) stamped on every synthesized draft (`kb_staging_docs.nav_map_version`); boot scan (`runNavigationDriftScan`, after seedOperationsKb) diffs the last stored snapshot in `kb_nav_map_versions` and flags — ADVISORY only, never edits content — pending truth drafts (append `navigation_drift` riskFlag) + live docs (flaggedStaleAt/flaggedReason). Additions never invalidate docs; first run baselines silently.
- **Why:** truth docs told members to visit portal locations that no longer exist (e.g. "Ask the Masters"); uncertain legacy mappings must be adjudicated by a human, never silently rewritten.
- **How to apply:** any sidebar rename/move → update the shared lib map (the guard forces it) and the drift scan handles doc re-review automatically on next boot.
