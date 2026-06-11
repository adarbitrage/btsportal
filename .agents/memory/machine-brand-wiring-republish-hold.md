---
name: Machine brand-wiring republish hold
description: Why the merged Machine front-end brand grant fix is intentionally NOT live in prod, and the condition for releasing it.
---

# Machine brand-wiring: merged-but-intentionally-not-live

The BTS portal changes that make Machine brand buyers receive their own product
(the 5 front-end brands: `backroad`, `offmarket`, `reserve_income`,
`silent_partner`, `test_like_mad`) are **merged to the codebase but deliberately
NOT republished to production**. The receiver fix only takes effect on republish,
so until then prod brand purchases still fall back to `yse_front_end`.

**Why:** There is zero brand traffic today, so "merged but not live" is safe. The
plan is ONE coordinated republish of **both** codebases (BTS portal + The Machine)
done together once The Machine's final phase (Tapfiliate) is built — a single
coordinated deploy avoids intermediate half-synced states between the two systems.

**How to apply:**
- Do NOT republish the API server on your own to deliver the brand-wiring /
  grant-resolution changes. Leave them merged and waiting.
- Wait for the user's explicit signal for the coordinated republish.
- When that happens, republish both codebases together, then run the production
  YSE byte-identical parity check (confirm YSE purchases are unaffected).
