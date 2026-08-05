---
name: KB ownership stamps must not match exact titles
description: seven-pillars owner_page_key stamp is keyed on normalized title identity; exact-title matching silently missed prod's ™-less variant.
---

The seven-pillars `owner_page_key` boot stamp matches docs by **normalized
title identity**: `regexp_replace(lower(title), '[^a-z0-9]+', '', 'g')`
compared against the normalized canonical list (exported
`SEVEN_PILLARS_TITLES` + `normalizeKbDocTitle` in
bootstrap-critical-prerequisites, locked by
kb-ownership-stamp-normalization.test.ts).

**Why:** the Aug 2026 publish proved exact-title matching is brittle across
environments — prod's copy of "The 7 Pillars of a Profitable Digital
Business" lacked the ™ character, so the security stamp never landed and the
doc stayed ungated. Corpora genuinely diverge between dev and prod (dev 37
blitz live stamps vs prod 12 is CORRECT — different corpus sizes, not a gap).

**How to apply:** any future stamp/repair that identifies KB docs must key on
a stable identifier (source marker, blitz_section anchor, slug, or normalized
title) — never exact title strings. Keep the TS normalizer and the SQL
regexp_replace in lockstep. Verify per-environment coverage against that
environment's actual corpus, not the other environment's counts.

Related one-time boot repairs from the same reconciliation:
`runSourceProductBackfillOnce` is marker-gated (`source_product_backfill_2026_08`
in system_settings, advisory-locked) precisely so reboots never re-clobber
later deliberate source_product edits — one-time backfills as perpetual boot
enforcement silently overwrite admin changes.
