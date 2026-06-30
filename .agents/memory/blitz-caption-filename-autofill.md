---
name: Blitz caption filename autofill
description: Transcript Cleaner auto-fills intake fields from Blitz caption filenames; the naming convention is a contract.
---

Blitz caption uploads to the Transcript Cleaner are auto-recognized by filename:
`blitz-lesson{NN}-{vv}-{slug}__{vidalyticsId}.ext`. A match auto-fills title +
transcript type (`blitz_video`) + in-lesson order + a provenance note; a
non-match leaves the upload unchanged (raw filename as source, no auto type).

**Naming is a contract.** `{NN}` is a Blitz SECTION id (1–23), `{vv}` is the
video's order within that lesson. If the convention ever changes, update the
parser regex AND its unit test in lockstep — they are the single source of the
format.

**Fill rule:** parse whenever the filename matches, then fill EACH field
independently and only when the caller left it blank. Never bail out of the
whole autofill just because one field (e.g. title) was pre-set — that was an
early bug; an explicit title must still allow type/order/provenance to fill.

**Title format decision:** resolved = `Lesson {NN} · {curriculum title} · {humanized slug}`;
unresolved lesson = `Lesson {NN} · {humanized slug}`. The curriculum title is
included on purpose so titles match the Blitz page (the explicit requirement);
the slug stays so multi-video lessons get distinct titles.
**Why:** the task example showed only "Lesson 11 · Clone Flexy Website" but that
was illustrative; matching the Blitz page label was the actual requirement.

**Robustness:** out-of-range/unknown lesson numbers and placeholder Vidalytics
ids (e.g. `VIDEO_ID_004`) must parse without error — the id is recorded verbatim
in provenance, the title falls back to the slug-only form.
