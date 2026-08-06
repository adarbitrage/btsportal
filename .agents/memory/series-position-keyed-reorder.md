---
name: Reordering a position-keyed PDF series (Drive + Resource Hub)
description: How to reorder/extend a Creative Drive doc series when drive rows are keyed by sortOrder and hub curation rows are insert-if-absent
---

Drive file seeds key rows by (folderId, sortOrder) and update in place when the objectPath hash changes; Resource Hub curation seeds are insert-if-absent keyed by slug and NEVER update existing rows.

**Rule:** when a series is reordered/extended, re-rendering the PDFs repoints every drive row in place (names + files fix themselves, and hub `fileId`s stay correct automatically because they point at the position). Only the hub rows' display copy goes stale — repair it with a title-gated retitle block (UPDATE ... WHERE slug = X AND displayTitle = old-seed-title) alongside the existing `BLURB_REFRESHES` pattern, so admin edits always win and the repair is a permanent no-op afterwards.

**Why:** positional slugs (`foundations-copywriting-N`) mean a reorder changes what each slug's title should say, but nothing else; deleting/reinserting rows would lose admin edits and churn ids.

**How to apply:** any future insert/reorder in a `cw()`/`im()`-style curation series: update the spec for fresh envs + add title-gated retitles for existing envs + extend the pure-constant drift test (`copywriting-foundations-series.test.ts` pattern: assets dir ↔ seed inventory ↔ curation spec lockstep).

Also learned (Task #2095): the live "BTS Portal Navigation Map" AI doc can carry stale citations of retired Resource Hub PDFs in TWO separate sections — after retiring member-visible content, grep the live doc content for the retired asset's name variants, not just one sentence.
