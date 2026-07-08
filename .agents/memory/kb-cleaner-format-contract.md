---
name: KB cleaner format contract + screener repair
description: Canonical transcript layout enforcement, glued inline-label repair fingerprint, and why the repair sweep may legitimately find 0 rows.
---

# Cleaner format contract + screener glued-turn repair

- Canonical cleaned-call layout: BARE speaker label on its own line (`Coach` / `Coach:` both tolerated by the screener's `BARE_LABEL_LINE`), speech below, blank line between turns.
- The drift the safety nets guard against: inline colon dialogue glued mid-line (`Coach: text Member: text …`). Fingerprint = a parsed bare-label turn body carrying ≥3 inline `Coach:`/`Member:`/`VA:` labels.
- **Why the boot sweep can report 0:** an own-line `Coach:` (colon form) label is NOT drift — it parses as a bare label. When auditing "glued" reports, count mid-line labels (`[^\n](Coach|Member|VA): \S`) before assuming the fingerprint is broken. The shared dev DB corpus was already normalized when the sweep first ran; the sweep stays as an idempotent no-op safety net.
- **How to apply:** any change to the cleaner's output layout must update BOTH the cleaner's normalize/enforce pass (transcript-cleaner.ts) and the screener's parser/repair (kb-value-screener.ts) in lockstep, plus the boot sweep fingerprint (kb-format-repair.ts).
- Exact-duplicate screenings are represented as a kept row with `dedup_status='exact_duplicate'`, 0 exchanges, and `duplicate_of_source_id` set — that is valid handled state, not a stale empty screening (stale = `unique` + 0 exchanges).
