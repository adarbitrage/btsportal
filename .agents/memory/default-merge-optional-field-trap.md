---
name: Optional-field default merge trap
description: Adding a new optional field with a shipped default via `{...default, ...stored}` merge can silently apply to pre-existing saved rows.
---

When a per-key/per-row settings pattern reads a "shipped default merged with DB override" (`{ ...defaultContentFor(key), ...storedRow }`), adding a **new optional field** to the default breaks backward compatibility for every already-saved row that predates the new field.

The bug: spreading `default` first means any field the stored row doesn't explicitly set (because it was saved before the field existed) still falls through to the default. This makes a "purely additive" feature retroactively change the behavior of existing configured rows — the opposite of additive.

**Why:** discovered adding an optional `thumbnailUrl`/`thumbnailLinkUrl` pair to an email pitch-content settings row. The shipped default for one block included a placeholder thumbnail (to exercise the feature end-to-end). Any pre-existing saved row for that block — which has no thumbnail keys at all — still inherited the default's thumbnail through the merge, violating "no thumbnail configured = renders exactly as before."

**How to apply:** when adding a new optional field with a non-empty default to a default-merged settings/content shape:
- If a stored row exists at all, that new field must resolve from the stored row ONLY (explicitly copy `stored.newField` into the merged result, never let it fall through from `default`).
- The default's value for the new field should apply ONLY when there is no stored row whatsoever (fresh/never-configured key).
- Add a regression test asserting that a stored row saved without the new field renders it as unset/absent, not as the default.
