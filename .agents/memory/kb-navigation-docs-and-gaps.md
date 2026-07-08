---
name: KB Navigation Docs + nav-gap flags
description: Screenshot-drafted navigation walkthrough docs and advisory nav-gap flags from synthesis
---

- Navigation docs are a new `navigation` doc class riding the EXISTING staging→review→push-to-live→supersede pipeline; the human gate is absolute — vision drafting inserts staging rows at `needs_review`, never live.
- Nav-gap flags are (app, area)-keyed advisory rows: dismissal is sticky (later synthesis runs never reopen or touch a dismissed row), and publishing a covering nav doc auto-resolves + suppresses future detections for that (app, area). Never make these publish blockers.
- The app vocabulary is a fixed tiered list in code (kb-nav-vocabulary); detection requires an action verb OR a dense cluster of click-language terms near the app mention — plain app-name mentions must NOT flag. Change vocabulary + detector tests in lockstep.
- **Why:** admins asked for de-noised, actionable gap signals — a mention-count flagger drowned them; sticky dismissal exists because synthesis re-runs constantly.
- **How to apply:** any new doc class flowing through push-approved must copy its extra columns (like navApp/navArea) in ALL three write paths (update, insert, onConflictDoUpdate) or live rows lose them on supersede.
- Lucide's `Map` icon import shadows the global `Map` constructor — always import as `Map as MapIcon`.
